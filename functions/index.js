// Cloud Functions v2 — callable endpoints for invite acceptance + owner bootstrap.
//
// Deploy: `npx firebase-tools deploy --only functions --project the-1p-leadership`

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const OWNER_EMAIL = 'the1percentnation@gmail.com';

/**
 * acceptInvite({ code })
 * - Validates invite exists + status=pending.
 * - Validates seatsUsed < seatCount.
 * - Atomically (transaction): marks invite accepted, increments seatsUsed, creates/updates
 *   users/{uid} with { companyId, role: 'user' }.
 */
exports.acceptInvite = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const code = (request.data && request.data.code || '').toString().trim();
  if (!code) throw new HttpsError('invalid-argument', 'Missing invite code.');

  const db = admin.firestore();

  // Find the invite across all companies. Invite doc id == code (see admin.js).
  // We do a collectionGroup query to locate it in one hop.
  const snap = await db.collectionGroup('invites')
    .where('code', '==', code)
    .limit(1)
    .get();

  if (snap.empty) throw new HttpsError('not-found', 'Invite code not found.');
  const inviteRef = snap.docs[0].ref;
  const invite = snap.docs[0].data();
  if (invite.status && invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Invite is ${invite.status}.`);
  }

  const companyId = invite.companyId || inviteRef.parent.parent.id;
  const companyRef = db.collection('companies').doc(companyId);
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const [companySnap, userSnap, inviteSnap] = await Promise.all([
      tx.get(companyRef),
      tx.get(userRef),
      tx.get(inviteRef)
    ]);
    if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');
    if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite not found.');
    const c = companySnap.data();
    const i = inviteSnap.data();

    if (i.status && i.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Invite is ${i.status}.`);
    }
    const seatCount = Number(c.seatCount || 0);
    const seatsUsed = Number(c.seatsUsed || 0);
    if (seatsUsed >= seatCount) {
      throw new HttpsError('resource-exhausted', 'No seats remaining.');
    }

    tx.update(inviteRef, {
      status: 'accepted',
      acceptedByUid: uid,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(companyRef, {
      seatsUsed: seatsUsed + 1
    });

    const email = (request.auth.token && request.auth.token.email) || null;
    const displayName = (request.auth.token && request.auth.token.name) || null;
    const userPatch = {
      companyId,
      role: userSnap.exists && userSnap.data().role === 'owner' ? 'owner' : 'user',
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (!userSnap.exists) {
      userPatch.email = email;
      userPatch.displayName = displayName;
      userPatch.tier = 'team';
      userPatch.createdAt = admin.firestore.FieldValue.serverTimestamp();
      tx.set(userRef, userPatch);
    } else {
      tx.set(userRef, userPatch, { merge: true });
    }

    // Mirror into companies/{cid}/members/{uid} so admins can list the roster
    // without needing `list` permission on the top-level users collection.
    const memberRef = companyRef.collection('members').doc(uid);
    tx.set(memberRef, {
      uid,
      email: email || (userSnap.exists ? userSnap.data().email : null),
      displayName: displayName || (userSnap.exists ? userSnap.data().displayName : null),
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { ok: true, companyId };
});

/**
 * bootstrapOwner()
 * - Callable by the authenticated user whose email == OWNER_EMAIL.
 * - Sets custom claim role='owner' on that user.
 */
exports.bootstrapOwner = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const email = (request.auth.token && request.auth.token.email || '').toLowerCase();
  if (email !== OWNER_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the bootstrap owner email can claim ownership.');
  }
  await admin.auth().setCustomUserClaims(uid, { role: 'owner' });
  // Mirror into the Firestore user doc for convenience.
  await admin.firestore().collection('users').doc(uid).set({
    email,
    role: 'owner',
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, note: 'Sign out and back in (or refresh token) for the claim to take effect.' };
});
