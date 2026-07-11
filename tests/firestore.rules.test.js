/**
 * Firestore security-rules unit tests.
 *
 * Run with the Firestore emulator:
 *   cd tests && npm install
 *   npm test           # wraps `firebase emulators:exec --only firestore ...`
 *
 * These tests encode the security contract the audit relies on. The most
 * important suite is "courses / modules (paid content gate)" — it proves that
 * unauthenticated and non-enrolled users CANNOT read paid lesson content, and
 * that enrolled users and admins CAN. If someone loosens the modules read rule
 * back to `if true`, these tests fail.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');

const {
  doc, getDoc, setDoc, updateDoc, collection, getDocs
} = require('firebase/firestore');

let testEnv;

const OWNER_UID = 'owner_uid';
const OWNER_EMAIL = 'the1percentnation@gmail.com';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'the-1p-leadership-test',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
});

after(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

// Helper contexts
function owner() {
  return testEnv.authenticatedContext(OWNER_UID, { role: 'owner', email: OWNER_EMAIL }).firestore();
}
function user(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}
function anon() {
  return testEnv.unauthenticatedContext().firestore();
}

// Seed docs with rules DISABLED (admin-equivalent).
async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}

describe('courses / modules (paid content gate)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'courses/paid-course'), { title: 'Paid', status: 'live', price: 197 });
      await setDoc(doc(db, 'courses/paid-course/modules/1'), { title: 'Lesson 1', html: '<p>secret paid content</p>', published: true });
      // An enrolled member and a non-enrolled member.
      await setDoc(doc(db, 'users/enrolled_uid'), { role: 'user', tier: 'individual', enrolledCourseSlugs: ['paid-course'] });
      await setDoc(doc(db, 'users/free_uid'), { role: 'user', tier: 'individual', enrolledCourseSlugs: [] });
      await setDoc(doc(db, 'users/admin_uid'), { role: 'admin', tier: 'individual' });
    });
  });

  it('course DOC (marketing metadata) is publicly readable', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'courses/paid-course')));
  });

  it('DENIES unauthenticated read of module content', async () => {
    await assertFails(getDoc(doc(anon(), 'courses/paid-course/modules/1')));
  });

  it('DENIES a signed-in but NON-ENROLLED user reading module content', async () => {
    await assertFails(getDoc(doc(user('free_uid'), 'courses/paid-course/modules/1')));
  });

  it('DENIES listing the modules collection when non-enrolled', async () => {
    await assertFails(getDocs(collection(user('free_uid'), 'courses/paid-course/modules')));
  });

  it('ALLOWS an enrolled user to read module content', async () => {
    await assertSucceeds(getDoc(doc(user('enrolled_uid'), 'courses/paid-course/modules/1')));
  });

  it('ALLOWS an admin to read module content (preview)', async () => {
    await assertSucceeds(getDoc(doc(user('admin_uid'), 'courses/paid-course/modules/1')));
  });

  it('ALLOWS the owner to read module content', async () => {
    await assertSucceeds(getDoc(doc(owner(), 'courses/paid-course/modules/1')));
  });

  it('DENIES a non-admin creating/updating module content', async () => {
    await assertFails(setDoc(doc(user('enrolled_uid'), 'courses/paid-course/modules/2'), { title: 'x' }));
  });
});

describe('users — privilege field freeze', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice'), { role: 'user', tier: 'individual', companyId: null, enrolledCourseSlugs: [], statsPoints: 0 });
    });
  });

  it('lets a user update their own non-privileged fields', async () => {
    await assertSucceeds(updateDoc(doc(user('alice'), 'users/alice'), { displayName: 'Alice', bio: 'hi' }));
  });

  it('DENIES self-escalation to role:admin', async () => {
    await assertFails(updateDoc(doc(user('alice'), 'users/alice'), { role: 'admin' }));
  });

  it('DENIES self-granting a paid course (enrolledCourseSlugs)', async () => {
    await assertFails(updateDoc(doc(user('alice'), 'users/alice'), { enrolledCourseSlugs: ['paid-course'] }));
  });

  it('DENIES self-assigning a companyId', async () => {
    await assertFails(updateDoc(doc(user('alice'), 'users/alice'), { companyId: 'acme' }));
  });

  it('DENIES creating a doc pre-set to role:admin', async () => {
    await assertFails(setDoc(doc(user('bob'), 'users/bob'), { role: 'admin', tier: 'individual' }));
  });

  it('DENIES reading another user document', async () => {
    await assertFails(getDoc(doc(user('bob'), 'users/alice')));
  });

  it('DENIES writing another user document', async () => {
    await assertFails(updateDoc(doc(user('bob'), 'users/alice'), { displayName: 'hacked' }));
  });
});

describe('users subcollections — private to self', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice'), { role: 'user' });
      await setDoc(doc(db, 'users/alice/progress/1'), { done: true });
      await setDoc(doc(db, 'users/alice/purchases/sess_1'), { courseSlug: 'x', amount: 197 });
    });
  });

  it('DENIES another user reading progress', async () => {
    await assertFails(getDoc(doc(user('bob'), 'users/alice/progress/1')));
  });

  it('ALLOWS self reading own progress', async () => {
    await assertSucceeds(getDoc(doc(user('alice'), 'users/alice/progress/1')));
  });

  it('DENIES client writes to purchases (server-only)', async () => {
    await assertFails(setDoc(doc(user('alice'), 'users/alice/purchases/sess_2'), { amount: 0 }));
  });

  it('DENIES another user reading purchases', async () => {
    await assertFails(getDoc(doc(user('bob'), 'users/alice/purchases/sess_1')));
  });

  it('ALLOWS self listing own purchases (billing UI depends on this)', async () => {
    await assertSucceeds(getDocs(collection(user('alice'), 'users/alice/purchases')));
  });
});

describe('posts — community feed scope', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users/alice'), { role: 'user', companyId: 'acme' });
      await setDoc(doc(db, 'users/carol'), { role: 'user', companyId: 'other' });
      await setDoc(doc(db, 'posts/global1'), { authorUid: 'z', companyId: null, text: 'hi', likeCount: 0, commentCount: 0 });
      await setDoc(doc(db, 'posts/acme1'), { authorUid: 'z', companyId: 'acme', text: 'team', likeCount: 0, commentCount: 0 });
    });
  });

  it('ALLOWS reading a global post', async () => {
    await assertSucceeds(getDoc(doc(user('alice'), 'posts/global1')));
  });

  it('DENIES reading another company\'s post', async () => {
    await assertFails(getDoc(doc(user('carol'), 'posts/acme1')));
  });

  it('DENIES creating a post with a forged authorUid', async () => {
    await assertFails(setDoc(doc(user('alice'), 'posts/x'), { authorUid: 'someone_else', companyId: 'acme', text: 't', likeCount: 0, commentCount: 0 }));
  });

  it('DENIES a non-owner creating a GLOBAL post', async () => {
    await assertFails(setDoc(doc(user('alice'), 'posts/x'), { authorUid: 'alice', companyId: null, text: 't', likeCount: 0, commentCount: 0 }));
  });
});

describe('server-only collections', () => {
  it('DENIES client reads/writes to rateLimits', async () => {
    await assertFails(getDoc(doc(user('alice'), 'rateLimits/x')));
    await assertFails(setDoc(doc(user('alice'), 'rateLimits/x'), { count: 0 }));
  });

  it('DENIES client access to communityInvites', async () => {
    await assertFails(getDoc(doc(user('alice'), 'communityInvites/tok')));
  });

  it('DENIES client access to chatbotKnowledge', async () => {
    await assertFails(getDoc(doc(user('alice'), 'chatbotKnowledge/e')));
  });

  it('DENIES non-owner reading bugReports', async () => {
    await seed(async (db) => { await setDoc(doc(db, 'bugReports/r1'), { status: 'open' }); });
    await assertFails(getDoc(doc(user('alice'), 'bugReports/r1')));
  });
});

describe('affiliates — linked-only reads', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'affiliates/CODE1'), { uid: 'alice', email: 'alice@x.com', clicks: 5, totalCommission: 100 });
    });
  });

  it('ALLOWS the linked affiliate to read their record', async () => {
    await assertSucceeds(getDoc(doc(user('alice', { email: 'alice@x.com' }), 'affiliates/CODE1')));
  });

  it('DENIES an unrelated user reading an affiliate record', async () => {
    await assertFails(getDoc(doc(user('mallory', { email: 'm@x.com' }), 'affiliates/CODE1')));
  });

  it('DENIES the affiliate tampering with money fields', async () => {
    await assertFails(updateDoc(doc(user('alice', { email: 'alice@x.com' }), 'affiliates/CODE1'), { totalCommission: 999999 }));
  });
});
