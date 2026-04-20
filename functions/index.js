// Cloud Functions v2 — callable endpoints + Firestore triggers + HTTP webhook.
// Includes SendGrid email features: transactional emails (invite, welcome),
// 1-on-1 contact emails, campaign broadcast, and the SendGrid Event Webhook.
//
// Deploy: `npx firebase-tools deploy --only functions --project the-1p-leadership`

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const OWNER_EMAIL = 'the1percentnation@gmail.com';

// SendGrid identity
const FROM_EMAIL = 'the1percentnation@gmail.com';
const FROM_NAME_DEFAULT = 'The One Percent Nation';
const REPLY_TO = 'the1percentnation@gmail.com';
const APP_BASE_URL = 'https://the-1p-leadership.web.app';

// Secret: SendGrid API key. Webhook verification key is optional and read
// lazily at runtime via the Secret Manager client — this avoids requiring
// SENDGRID_WEBHOOK_KEY to exist at deploy time.
const sendgridKey = defineSecret('SENDGRID_API_KEY');

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function textToHtml(text) {
  if (!text) return '';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br/>');
}

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

async function assertCompanyAdmin(db, companyId, request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const companySnap = await db.collection('companies').doc(companyId).get();
  if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  const adminUids = (companySnap.data() && companySnap.data().adminUids) || [];
  if (!isOwnerClaim && !adminUids.includes(uid)) {
    throw new HttpsError('permission-denied', 'Not an admin of this company.');
  }
  return { uid, isOwner: !!isOwnerClaim, company: companySnap.data() };
}

/**
 * acceptInvite({ code })
 */
exports.acceptInvite = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const code = (request.data && request.data.code || '').toString().trim();
  if (!code) throw new HttpsError('invalid-argument', 'Missing invite code.');

  const db = admin.firestore();

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
 * deleteContact({ companyId, contactId })
 */
exports.deleteContact = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const companyId = (request.data && request.data.companyId || '').toString().trim();
  const contactId = (request.data && request.data.contactId || '').toString().trim();
  if (!companyId || !contactId) {
    throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
  }

  const db = admin.firestore();
  await assertCompanyAdmin(db, companyId, request);
  const companyRef = db.collection('companies').doc(companyId);

  const contactRef = companyRef.collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) {
    return { ok: true, deleted: 0, note: 'Contact already gone.' };
  }

  async function deleteCollection(colRef) {
    let deleted = 0;
    while (true) {
      const snap = await colRef.limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
    return deleted;
  }

  const notesDeleted = await deleteCollection(contactRef.collection('notes'));
  const actsDeleted = await deleteCollection(contactRef.collection('activities'));
  await contactRef.delete();

  return { ok: true, deleted: notesDeleted + actsDeleted + 1 };
});

/**
 * deleteUser({ uid })
 *
 * Fully removes a user from the platform — Firestore user doc + subcollections
 * (progress, capstone, enrollments) + Firebase Auth account + company roster
 * entry. Decrements the company's seatsUsed and strips the user from adminUids.
 *
 * Permission: caller must be the bootstrap owner (custom claim role=owner), or
 * an admin of the target user's company (uid in companies/{cid}.adminUids).
 *
 * Refuses to delete self or the bootstrap owner account.
 */
exports.deleteUser = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const targetUid = (request.data && request.data.uid || '').toString().trim();
  if (!targetUid) throw new HttpsError('invalid-argument', 'Target uid is required.');

  if (callerUid === targetUid) {
    throw new HttpsError('failed-precondition', 'Cannot delete your own account here.');
  }

  const db = admin.firestore();
  const targetUserRef = db.collection('users').doc(targetUid);
  const targetUserSnap = await targetUserRef.get();

  // If the user doc is already gone, still try to clean up Auth as a best-effort.
  if (!targetUserSnap.exists) {
    const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
    if (!isOwnerClaim) {
      throw new HttpsError('permission-denied', 'User not found and caller is not owner.');
    }
    try { await admin.auth().deleteUser(targetUid); } catch (e) {}
    return { ok: true, deleted: 0, note: 'User doc already gone.' };
  }

  const targetData = targetUserSnap.data() || {};
  const targetCompanyId = targetData.companyId || null;
  const targetEmail = (targetData.email || '').toLowerCase();

  if (targetEmail === OWNER_EMAIL.toLowerCase()) {
    throw new HttpsError('failed-precondition', 'Cannot delete the bootstrap owner account.');
  }

  // Permission: owner OR admin of the target's company.
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  let isCompanyAdmin = false;
  if (!isOwnerClaim && targetCompanyId) {
    const compSnap = await db.collection('companies').doc(targetCompanyId).get();
    if (compSnap.exists) {
      const adminUids = (compSnap.data() && compSnap.data().adminUids) || [];
      isCompanyAdmin = adminUids.includes(callerUid);
    }
  }
  if (!isOwnerClaim && !isCompanyAdmin) {
    throw new HttpsError('permission-denied', 'You do not have permission to delete this user.');
  }

  async function deleteCollection(colRef) {
    let deleted = 0;
    while (true) {
      const snap = await colRef.limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
    return deleted;
  }

  const progressDeleted = await deleteCollection(targetUserRef.collection('progress'));
  const capstoneDeleted = await deleteCollection(targetUserRef.collection('capstone'));
  const enrollDeleted  = await deleteCollection(targetUserRef.collection('enrollments'));

  // Remove from company roster + decrement seat + strip from adminUids.
  if (targetCompanyId) {
    const companyRef = db.collection('companies').doc(targetCompanyId);
    const memberRef = companyRef.collection('members').doc(targetUid);
    try { await memberRef.delete(); } catch (e) { /* best-effort */ }
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(companyRef);
        if (!s.exists) return;
        const c = s.data() || {};
        const newUsed = Math.max(0, (c.seatsUsed || 0) - 1);
        const adminUids = (c.adminUids || []).filter((u) => u !== targetUid);
        tx.update(companyRef, { seatsUsed: newUsed, adminUids });
      });
    } catch (e) { /* best-effort */ }
  }

  await targetUserRef.delete();

  try {
    await admin.auth().deleteUser(targetUid);
  } catch (e) {
    if (e && e.code !== 'auth/user-not-found') {
      console.warn('[deleteUser] auth.deleteUser failed:', e.message);
    }
  }

  return {
    ok: true,
    deleted: progressDeleted + capstoneDeleted + enrollDeleted + 1
  };
});

/**
 * bootstrapOwner()
 */
exports.bootstrapOwner = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const email = (request.auth.token && request.auth.token.email || '').toLowerCase();
  if (email !== OWNER_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the bootstrap owner email can claim ownership.');
  }
  await admin.auth().setCustomUserClaims(uid, { role: 'owner' });
  await admin.firestore().collection('users').doc(uid).set({
    email,
    role: 'owner',
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, note: 'Sign out and back in (or refresh token) for the claim to take effect.' };
});

// ────────────────────────────────────────────────────────────────
// Email: invite on create
// ────────────────────────────────────────────────────────────────

/**
 * onInviteCreated — Firestore trigger on companies/{companyId}/invites/{inviteId}.
 * Sends an invite email via SendGrid and records emailStatus on the invite doc.
 */
exports.onInviteCreated = onDocumentCreated(
  { document: 'companies/{companyId}/invites/{inviteId}', secrets: [sendgridKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const invite = snap.data();
    const companyId = event.params.companyId;

    if (!invite || !invite.email) {
      try { await snap.ref.update({ emailStatus: 'skipped', emailError: 'No recipient email' }); } catch (e) {}
      return;
    }

    try {
      sgMail.setApiKey(sendgridKey.value());

      let companyName = 'the team';
      try {
        const cSnap = await admin.firestore().collection('companies').doc(companyId).get();
        if (cSnap.exists) companyName = cSnap.data().name || companyName;
      } catch (e) {}

      const code = invite.code || snap.id;
      const link = `${APP_BASE_URL}/invite.html?code=${encodeURIComponent(code)}`;

      const subject = `You're invited to join ${companyName} on 1P Leadership`;
      const textBody =
        `You've been invited to join ${companyName} on The 1P Leadership dashboard.\n\n` +
        `Click the link below to accept your invite and get started:\n${link}\n\n` +
        `If the link doesn't work, paste it into your browser.\n\n— The One Percent Nation`;

      const htmlBody = `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:0 auto;">
          <h2 style="color:#CC1B1B;margin-bottom:8px;">Welcome to 1P Leadership</h2>
          <p>You've been invited to join <strong>${companyName}</strong> on The 1P Leadership dashboard.</p>
          <p><a href="${link}" style="display:inline-block;background:#CC1B1B;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:600;">Accept invite</a></p>
          <p style="color:#666;font-size:12px;">Or paste this link into your browser:<br/><a href="${link}">${link}</a></p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
          <p style="color:#999;font-size:11px;">The One Percent Nation</p>
        </div>`;

      const [resp] = await sgMail.send({
        to: invite.email,
        from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
        replyTo: REPLY_TO,
        subject,
        text: textBody,
        html: htmlBody,
        customArgs: {
          type: 'invite',
          companyId,
          inviteId: snap.id
        }
      });

      const messageId = resp && resp.headers && resp.headers['x-message-id'] || null;

      await snap.ref.update({
        emailStatus: 'sent',
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailMessageId: messageId
      });
    } catch (err) {
      console.error('[onInviteCreated] send failed:', err && err.message);
      try {
        await snap.ref.update({
          emailStatus: 'failed',
          emailError: String((err && err.message) || err).slice(0, 500)
        });
      } catch (e2) {}
    }
  }
);

// ────────────────────────────────────────────────────────────────
// Email: welcome on user create
// ────────────────────────────────────────────────────────────────

exports.onUserCreated = onDocumentCreated(
  { document: 'users/{uid}', secrets: [sendgridKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const user = snap.data();
    if (!user || !user.email) return;

    try {
      sgMail.setApiKey(sendgridKey.value());

      let companyName = null;
      if (user.companyId) {
        try {
          const cSnap = await admin.firestore().collection('companies').doc(user.companyId).get();
          if (cSnap.exists) companyName = cSnap.data().name || null;
        } catch (e) {}
      }

      const firstName = (user.displayName || '').split(' ')[0] || 'there';
      const companyLine = companyName
        ? `You're now part of <strong>${companyName}</strong>.`
        : `Your account is ready.`;
      const companyLineText = companyName
        ? `You're now part of ${companyName}.`
        : `Your account is ready.`;

      const subject = 'Welcome to 1P Leadership';
      const textBody =
        `Hi ${firstName},\n\n` +
        `Welcome to The 1P Leadership dashboard. ${companyLineText}\n\n` +
        `Jump into the community feed: ${APP_BASE_URL}/community.html\n` +
        `Or start your coursework: ${APP_BASE_URL}/index.html\n\n` +
        `— The One Percent Nation`;

      const htmlBody = `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:0 auto;">
          <h2 style="color:#CC1B1B;margin-bottom:8px;">Welcome, ${firstName}.</h2>
          <p>${companyLine}</p>
          <p style="margin:20px 0;">
            <a href="${APP_BASE_URL}/community.html" style="display:inline-block;background:#CC1B1B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:600;margin-right:8px;">Community feed</a>
            <a href="${APP_BASE_URL}/index.html" style="display:inline-block;background:#222;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:600;">Start coursework</a>
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
          <p style="color:#999;font-size:11px;">The One Percent Nation</p>
        </div>`;

      await sgMail.send({
        to: user.email,
        from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
        replyTo: REPLY_TO,
        subject,
        text: textBody,
        html: htmlBody,
        customArgs: {
          type: 'welcome',
          uid: snap.id
        }
      });
    } catch (err) {
      console.error('[onUserCreated] welcome send failed:', err && err.message);
    }
  }
);

// ────────────────────────────────────────────────────────────────
// sendContactEmail — callable
// ────────────────────────────────────────────────────────────────

exports.sendContactEmail = onCall(
  { secrets: [sendgridKey] },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = (data.companyId || '').toString().trim();
    const contactId = (data.contactId || '').toString().trim();
    const subject = (data.subject || '').toString().trim();
    const bodyHtml = (data.bodyHtml || '').toString();
    const bodyText = (data.bodyText || '').toString();

    if (!companyId || !contactId) throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
    if (!subject) throw new HttpsError('invalid-argument', 'Subject is required.');
    if (!bodyHtml && !bodyText) throw new HttpsError('invalid-argument', 'Body is required.');

    const { uid } = await assertCompanyAdmin(db, companyId, request);

    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
    const contactSnap = await contactRef.get();
    if (!contactSnap.exists) throw new HttpsError('not-found', 'Contact not found.');
    const contact = contactSnap.data();
    if (!contact.email) throw new HttpsError('failed-precondition', 'Contact has no email address.');

    const finalText = bodyText || htmlToText(bodyHtml);
    const finalHtml = bodyHtml || textToHtml(bodyText);

    sgMail.setApiKey(sendgridKey.value());

    let messageId = null;
    try {
      const [resp] = await sgMail.send({
        to: contact.email,
        from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
        replyTo: REPLY_TO,
        subject,
        text: finalText,
        html: finalHtml,
        customArgs: {
          type: 'contact',
          companyId,
          contactId
        }
      });
      messageId = resp && resp.headers && resp.headers['x-message-id'] || null;
    } catch (err) {
      console.error('[sendContactEmail] failed:', err && err.message);
      throw new HttpsError('internal', 'SendGrid rejected the send: ' + ((err && err.message) || 'unknown'));
    }

    // Actor name lookup
    let actorName = (request.auth.token && request.auth.token.name) || null;
    if (!actorName) {
      try {
        const uSnap = await db.collection('users').doc(uid).get();
        if (uSnap.exists) actorName = uSnap.data().displayName || uSnap.data().email || null;
      } catch (e) {}
    }
    if (!actorName) actorName = (request.auth.token && request.auth.token.email) || 'Unknown';

    const bodyPreview = finalText.length > 200 ? finalText.slice(0, 200) + '…' : finalText;
    const desc = subject.length > 80 ? subject.slice(0, 80) + '…' : subject;

    try {
      await contactRef.collection('activities').add({
        type: 'email_sent',
        description: desc,
        actorUid: uid,
        actorName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: { subject, bodyPreview, messageId }
      });
      await contactRef.update({
        lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('[sendContactEmail] activity log failed:', e && e.message);
    }

    return { ok: true, messageId };
  }
);

// ────────────────────────────────────────────────────────────────
// sendCampaign — callable
// ────────────────────────────────────────────────────────────────

async function buildRecipients(db, companyId, filter) {
  const mode = (filter && filter.mode) || 'all_contacts';
  const seen = new Set();
  const recipients = []; // { email, name?, firstName? }

  function push(email, name) {
    if (!email) return;
    const e = String(email).trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || seen.has(e)) return;
    seen.add(e);
    const firstName = name ? String(name).split(' ')[0] : '';
    recipients.push({ email: e, name: name || '', firstName });
  }

  if (mode === 'all_users') {
    // Members of the company.
    const snap = await db.collection('companies').doc(companyId).collection('members').get();
    snap.docs.forEach((d) => {
      const m = d.data();
      push(m.email, m.displayName);
    });
    return recipients;
  }

  // Contact-based modes.
  const colRef = db.collection('companies').doc(companyId).collection('contacts');
  let rows = [];

  if (mode === 'stages' && Array.isArray(filter.stages) && filter.stages.length) {
    // Firestore `in` supports up to 10 values. Chunk.
    const chunks = [];
    for (let i = 0; i < filter.stages.length; i += 10) chunks.push(filter.stages.slice(i, i + 10));
    for (const chunk of chunks) {
      const snap = await colRef.where('stage', 'in', chunk).get();
      snap.docs.forEach((d) => rows.push(d.data()));
    }
  } else if (mode === 'tags' && Array.isArray(filter.tags) && filter.tags.length) {
    const chunks = [];
    for (let i = 0; i < filter.tags.length; i += 10) chunks.push(filter.tags.slice(i, i + 10));
    for (const chunk of chunks) {
      const snap = await colRef.where('tags', 'array-contains-any', chunk).get();
      snap.docs.forEach((d) => rows.push(d.data()));
    }
  } else if (mode === 'owner' && filter.ownerUid) {
    const snap = await colRef.where('ownerUid', '==', filter.ownerUid).get();
    snap.docs.forEach((d) => rows.push(d.data()));
  } else {
    // all_contacts
    const snap = await colRef.get();
    snap.docs.forEach((d) => rows.push(d.data()));
  }

  rows.forEach((c) => push(c.email, c.name));
  return recipients;
}

exports.sendCampaign = onCall(
  { secrets: [sendgridKey], timeoutSeconds: 540 },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = (data.companyId || '').toString().trim();
    const campaignId = (data.campaignId || '').toString().trim();
    if (!companyId || !campaignId) throw new HttpsError('invalid-argument', 'companyId and campaignId are required.');

    await assertCompanyAdmin(db, companyId, request);

    const campaignRef = db.collection('companies').doc(companyId).collection('campaigns').doc(campaignId);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new HttpsError('not-found', 'Campaign not found.');
    const campaign = campaignSnap.data();
    const status = campaign.status || 'draft';
    if (!['draft', 'ready'].includes(status)) {
      throw new HttpsError('failed-precondition', `Cannot send a campaign with status "${status}".`);
    }

    const subject = (campaign.subject || '').toString().trim();
    if (!subject) throw new HttpsError('invalid-argument', 'Campaign has no subject.');
    const bodyText = campaign.bodyText || '';
    const bodyHtml = campaign.bodyHtml || textToHtml(bodyText);
    const finalText = bodyText || htmlToText(bodyHtml);
    const fromName = campaign.fromName || FROM_NAME_DEFAULT;

    await campaignRef.update({
      status: 'sending',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    let recipients = [];
    try {
      recipients = await buildRecipients(db, companyId, campaign.recipientFilter || { mode: 'all_contacts' });
    } catch (err) {
      await campaignRef.update({
        status: 'failed',
        errorSample: [String((err && err.message) || err).slice(0, 300)],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      throw new HttpsError('internal', 'Could not build recipient list: ' + ((err && err.message) || 'unknown'));
    }

    if (!recipients.length) {
      await campaignRef.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        recipientCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        errorSample: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true, recipientCount: 0, acceptedCount: 0, failedCount: 0 };
    }

    sgMail.setApiKey(sendgridKey.value());

    let accepted = 0;
    let failed = 0;
    const errorSample = [];

    // Chunk into batches of 1000.
    const BATCH_SIZE = 1000;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      const personalizations = chunk.map((r) => {
        const personalizedSubject = subject.replace(/\{\{\s*firstName\s*\}\}/g, r.firstName || '');
        return {
          to: [{ email: r.email, name: r.name || undefined }],
          subject: personalizedSubject,
          customArgs: {
            type: 'campaign',
            companyId,
            campaignId,
            recipientEmail: r.email
          }
        };
      });

      const htmlPersonalized = bodyHtml; // No per-recipient token substitution beyond subject (kept simple per spec).
      const textPersonalized = finalText;

      const msg = {
        from: { email: FROM_EMAIL, name: fromName },
        replyTo: REPLY_TO,
        subject, // fallback; personalizations override per-message
        text: textPersonalized,
        html: htmlPersonalized,
        personalizations,
        customArgs: {
          type: 'campaign',
          companyId,
          campaignId
        }
      };

      try {
        await sgMail.send(msg);
        accepted += chunk.length;
      } catch (err) {
        failed += chunk.length;
        const msgStr = String((err && err.message) || err).slice(0, 300);
        if (errorSample.length < 5) errorSample.push(msgStr);
        console.error('[sendCampaign] batch send failed:', msgStr);
      }
    }

    await campaignRef.update({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      recipientCount: recipients.length,
      acceptedCount: accepted,
      failedCount: failed,
      errorSample,
      stats: {
        delivered: admin.firestore.FieldValue.increment(0),
        opens: admin.firestore.FieldValue.increment(0),
        clicks: admin.firestore.FieldValue.increment(0),
        bounces: admin.firestore.FieldValue.increment(0),
        unsubs: admin.firestore.FieldValue.increment(0)
      }
    });

    // Initialize stats if they don't exist.
    try {
      const latest = (await campaignRef.get()).data() || {};
      if (!latest.stats || typeof latest.stats !== 'object' || Object.keys(latest.stats).length === 0) {
        await campaignRef.update({
          stats: { delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 }
        });
      }
    } catch (e) {}

    return { ok: true, recipientCount: recipients.length, acceptedCount: accepted, failedCount: failed };
  }
);

// ────────────────────────────────────────────────────────────────
// sendgridEventWebhook — HTTP function (public)
// ────────────────────────────────────────────────────────────────

function verifySignature(publicKeyPem, payloadRaw, signature, timestamp) {
  if (!publicKeyPem || !signature || !timestamp) return false;
  try {
    const timestampedPayload = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      payloadRaw
    ]);
    const verifier = crypto.createVerify('sha256');
    verifier.update(timestampedPayload);
    verifier.end();
    const decodedSig = Buffer.from(signature, 'base64');
    return verifier.verify(publicKeyPem, decodedSig);
  } catch (e) {
    console.warn('[webhook] signature verify error:', e && e.message);
    return false;
  }
}

exports.sendgridEventWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(200).send('ok');
        return;
      }

      // Get raw body for signature verification. Firebase Functions v2 provides req.rawBody.
      const rawBody = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from(JSON.stringify(req.body || []));

      // Webhook signing is optional. Read from env if set; otherwise accept unsigned.
      const webhookKey = (process.env.SENDGRID_WEBHOOK_KEY || '').trim();

      if (webhookKey && webhookKey.trim()) {
        const signature = req.get('X-Twilio-Email-Event-Webhook-Signature');
        const timestamp = req.get('X-Twilio-Email-Event-Webhook-Timestamp');
        const ok = verifySignature(webhookKey, rawBody, signature, timestamp);
        if (!ok) {
          console.warn('[webhook] signature invalid — ignoring payload');
          res.status(200).send('ok');
          return;
        }
      } else {
        console.warn('[webhook] SENDGRID_WEBHOOK_KEY not set — accepting without signature verification');
      }

      const events = Array.isArray(req.body) ? req.body : [];
      const db = admin.firestore();

      // Counter per campaign, increments per type.
      const campaignIncrements = new Map();

      function bump(cid, field) {
        if (!cid) return;
        const m = campaignIncrements.get(cid) || {};
        m[field] = (m[field] || 0) + 1;
        campaignIncrements.set(cid, m);
      }

      for (const ev of events) {
        try {
          const type = ev.event || 'unknown';
          const companyId = ev.companyId;
          const campaignId = ev.campaignId;
          const contactId = ev.contactId;
          const email = ev.email || null;
          const timestamp = ev.timestamp ? new Date(ev.timestamp * 1000) : new Date();
          const eventId = ev.sg_event_id || (`${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

          if (companyId && campaignId) {
            // Write event to events subcollection.
            const evRef = db.collection('companies').doc(companyId)
              .collection('campaigns').doc(campaignId)
              .collection('events').doc(eventId);
            await evRef.set({
              type,
              email,
              timestamp,
              url: ev.url || null,
              reason: ev.reason || ev.response || null,
              raw: {
                sg_message_id: ev.sg_message_id || null,
                useragent: ev.useragent || null,
                ip: ev.ip || null
              }
            }, { merge: true });

            // Aggregate counters.
            if (type === 'delivered') bump(`${companyId}/${campaignId}`, 'stats.delivered');
            else if (type === 'open') bump(`${companyId}/${campaignId}`, 'stats.opens');
            else if (type === 'click') bump(`${companyId}/${campaignId}`, 'stats.clicks');
            else if (type === 'bounce' || type === 'dropped') bump(`${companyId}/${campaignId}`, 'stats.bounces');
            else if (type === 'unsubscribe' || type === 'group_unsubscribe' || type === 'spamreport') bump(`${companyId}/${campaignId}`, 'stats.unsubs');
          }

          // 1-on-1 contact email events → append activity.
          if (companyId && contactId && !campaignId) {
            try {
              const contactRef = db.collection('companies').doc(companyId)
                .collection('contacts').doc(contactId);
              await contactRef.collection('activities').add({
                type: 'email_event',
                description: `Email ${type}${email ? ' · ' + email : ''}`,
                actorUid: 'system',
                actorName: 'SendGrid',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                meta: {
                  eventType: type,
                  email,
                  url: ev.url || null,
                  reason: ev.reason || ev.response || null,
                  messageId: ev.sg_message_id || null
                }
              });
            } catch (e) {
              console.warn('[webhook] contact activity write failed:', e && e.message);
            }
          }
        } catch (perEvErr) {
          console.warn('[webhook] event error:', perEvErr && perEvErr.message);
        }
      }

      // Apply aggregate counter updates.
      for (const [key, fields] of campaignIncrements.entries()) {
        const [companyId, campaignId] = key.split('/');
        const campRef = db.collection('companies').doc(companyId).collection('campaigns').doc(campaignId);
        const updates = {};
        Object.keys(fields).forEach((f) => {
          updates[f] = admin.firestore.FieldValue.increment(fields[f]);
        });
        try {
          await campRef.set(updates, { merge: true });
        } catch (e) {
          console.warn('[webhook] campaign counter update failed:', e && e.message);
        }
      }

      res.status(200).send('ok');
    } catch (err) {
      console.error('[webhook] fatal:', err && err.message);
      res.status(200).send('ok'); // Always 200 to prevent SendGrid from retrying.
    }
  }
);
