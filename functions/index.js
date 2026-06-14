// Cloud Functions v2 — callable endpoints + Firestore triggers + HTTP webhook.
// Includes SendGrid email features: transactional emails (invite, welcome),
// 1-on-1 contact emails, campaign broadcast, and the SendGrid Event Webhook.
//
// Deploy: `npx firebase-tools deploy --only functions --project the-1p-leadership`

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
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
// shareEventToContacts — callable. Emails a community event to CRM
// contacts (or company members) using the same recipient-filter modes
// as sendCampaign. Reads the event from the top-level events/ collection.
// ────────────────────────────────────────────────────────────────

function eventEmail(event, baseUrl, customMessage) {
  const title = (event.title || 'Event').toString();
  const toDate = (t) => (t && typeof t.toDate === 'function') ? t.toDate() : (t ? new Date(t) : null);
  const start = toDate(event.startsAt);
  const end = toDate(event.endsAt);
  let when = 'Date to be announced';
  if (start && !isNaN(start.getTime())) {
    const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    when = start.toLocaleString('en-US', opts);
    if (end && !isNaN(end.getTime())) {
      const sameDay = end.toDateString() === start.toDateString();
      when += ' – ' + (sameDay
        ? end.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : end.toLocaleString('en-US', opts));
    }
  }
  const esc = (s) => textToHtml(s);
  const link = event.link || `${baseUrl}/events`;
  const ctaLabel = event.link ? 'Join the event' : 'View event details';

  const textParts = [];
  if (customMessage) textParts.push(customMessage, '');
  textParts.push(`You're invited: ${title}`, '', when);
  if (event.location) textParts.push(`Location: ${event.location}`);
  if (event.hostName) textParts.push(`Hosted by ${event.hostName}`);
  if (event.description) textParts.push('', event.description);
  textParts.push('', `${ctaLabel}: ${link}`);
  const text = textParts.join('\n');

  const img = event.imageUrl
    ? `<img src="${event.imageUrl}" alt="" style="width:100%;max-width:560px;border-radius:10px;display:block;margin:0 0 20px;" />`
    : '';
  const customHtml = customMessage ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${esc(customMessage)}</p>` : '';
  const descHtml = event.description ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#444;">${esc(event.description)}</p>` : '';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:8px;">
      <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#cc1b1b;margin:0 0 6px;">You're invited</p>
      ${customHtml}
      ${img}
      <h1 style="font-size:22px;margin:0 0 12px;color:#111;">${esc(title)}</h1>
      <p style="margin:0 0 6px;font-size:15px;color:#222;">🗓️ ${esc(when)}</p>
      ${event.location ? `<p style="margin:0 0 6px;font-size:15px;color:#222;">📍 ${esc(event.location)}</p>` : ''}
      ${event.hostName ? `<p style="margin:0 0 6px;font-size:14px;color:#666;">Hosted by ${esc(event.hostName)}</p>` : ''}
      ${descHtml}
      <p style="margin:24px 0 0;">
        <a href="${link}" style="background:#cc1b1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">${ctaLabel} →</a>
      </p>
    </div>
  `;
  return { subject: `You're invited: ${title}`, text, html };
}

exports.shareEventToContacts = onCall(
  { secrets: [sendgridKey], timeoutSeconds: 540 },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = (data.companyId || '').toString().trim();
    const eventId = (data.eventId || '').toString().trim();
    const customMessage = (data.message || '').toString().slice(0, 1000);
    const recipientFilter = data.recipientFilter || { mode: 'all_contacts' };
    if (!companyId || !eventId) throw new HttpsError('invalid-argument', 'companyId and eventId are required.');

    await assertCompanyAdmin(db, companyId, request);

    const eventSnap = await db.collection('events').doc(eventId).get();
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
    const event = eventSnap.data();

    let recipients = [];
    try {
      recipients = await buildRecipients(db, companyId, recipientFilter);
    } catch (err) {
      throw new HttpsError('internal', 'Could not build recipient list: ' + ((err && err.message) || 'unknown'));
    }
    if (!recipients.length) return { ok: true, recipientCount: 0, acceptedCount: 0, failedCount: 0 };

    const { subject, text, html } = eventEmail(event, APP_BASE_URL, customMessage);

    sgMail.setApiKey(sendgridKey.value());
    let accepted = 0;
    let failed = 0;
    const errorSample = [];
    const BATCH_SIZE = 1000;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      const personalizations = chunk.map((r) => ({
        to: [{ email: r.email, name: r.name || undefined }],
        customArgs: { type: 'event', companyId, eventId, recipientEmail: r.email }
      }));
      try {
        await sgMail.send({
          from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
          replyTo: REPLY_TO,
          subject,
          text,
          html,
          personalizations,
          customArgs: { type: 'event', companyId, eventId }
        });
        accepted += chunk.length;
      } catch (err) {
        failed += chunk.length;
        const msgStr = String((err && err.message) || err).slice(0, 300);
        if (errorSample.length < 5) errorSample.push(msgStr);
        console.error('[shareEventToContacts] batch send failed:', msgStr);
      }
    }

    return { ok: true, recipientCount: recipients.length, acceptedCount: accepted, failedCount: failed, errorSample };
  }
);

// ────────────────────────────────────────────────────────────────
// registerForEvent — callable (public, unauthenticated allowed). Records an
// event registration, upserts a CRM contact (source: Event), mirrors to the
// member's account when signed in, and bumps the event's registrationCount.
// ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function resolveEventCompanyId(db, event) {
  if (event.companyId) return event.companyId;
  const ownerUid = event.createdByUid || event.hostUid || null;
  if (ownerUid) {
    try {
      const uSnap = await db.collection('users').doc(ownerUid).get();
      if (uSnap.exists && uSnap.data().companyId) return uSnap.data().companyId;
    } catch (e) {}
    try {
      const snap = await db.collection('companies').where('adminUids', 'array-contains', ownerUid).limit(1).get();
      if (!snap.empty) return snap.docs[0].id;
    } catch (e) {}
  }
  return null;
}

async function upsertEventContact(db, companyId, event, name, email, ownerUid, extra) {
  const colRef = db.collection('companies').doc(companyId).collection('contacts');
  const tag = (event.title || '').toString().slice(0, 40);
  const phone = (extra && extra.phone) || null;
  const address = (extra && extra.address) || null;
  let contactRef = null;
  try {
    const snap = await colRef.where('email', '==', email).limit(1).get();
    if (!snap.empty) contactRef = snap.docs[0].ref;
  } catch (e) {}

  if (contactRef) {
    const patch = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (phone) patch.phone = phone;
    if (address) patch.address = address;
    if (tag) patch.tags = admin.firestore.FieldValue.arrayUnion(tag);
    await contactRef.set(patch, { merge: true });
  } else {
    contactRef = await colRef.add({
      name: name || 'Unnamed contact',
      email,
      phone: phone,
      address: address,
      companyName: null,
      source: 'Event',
      stage: 'new',
      tags: tag ? [tag] : [],
      ownerUid: ownerUid || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'system',
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  try {
    const notes = (extra && extra.notes) || null;
    await contactRef.collection('activities').add({
      type: 'event_registration',
      description: `Registered for "${(event.title || 'event').toString().slice(0, 80)}"` + (notes ? ` — Note: ${notes.slice(0, 200)}` : ''),
      actorUid: 'system',
      actorName: 'Event registration',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: { eventId: event.id || null, eventTitle: event.title || null, phone: phone || null, address: address || null, notes: notes || null }
    });
  } catch (e) {}
}

exports.registerForEvent = onCall(async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const eventId = (data.eventId || '').toString().trim();
  const name = (data.name || '').toString().trim().slice(0, 120);
  const email = (data.email || '').toString().trim().toLowerCase().slice(0, 200);
  const phone = (data.phone || '').toString().trim().slice(0, 40);
  const address = (data.address || '').toString().trim().slice(0, 240);
  const notes = (data.notes || '').toString().trim().slice(0, 800);

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!name) throw new HttpsError('invalid-argument', 'Please enter your name.');
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');

  const uid = (request.auth && request.auth.uid) || null;

  const eventRef = db.collection('events').doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
  const event = { id: eventId, ...eventSnap.data() };

  // Dedup key: uid for members, hashed email for the public.
  const regId = uid || ('e_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24));
  const regRef = eventRef.collection('registrations').doc(regId);
  const existing = await regRef.get();
  const alreadyRegistered = existing.exists;

  await regRef.set({
    name,
    email,
    phone: phone || null,
    address: address || null,
    notes: notes || null,
    uid: uid || null,
    source: uid ? 'member' : 'public',
    registeredAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  if (!alreadyRegistered) {
    try { await eventRef.set({ registrationCount: admin.firestore.FieldValue.increment(1) }, { merge: true }); } catch (e) {}
  }

  // Upsert into the CRM (best-effort — registration still succeeds if no company).
  try {
    const companyId = await resolveEventCompanyId(db, event);
    if (companyId) {
      await upsertEventContact(db, companyId, event, name, email, event.createdByUid || event.hostUid || null, { phone, address, notes });
    }
  } catch (e) {
    console.warn('[registerForEvent] CRM upsert failed:', e && e.message);
  }

  // Mirror to the member's account so they see it as "Registered".
  if (uid) {
    try {
      await db.collection('users').doc(uid).collection('registrations').doc(eventId).set({
        eventId,
        title: event.title || null,
        startsAt: event.startsAt || null,
        registeredAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {}
  }

  let registrationCount = null;
  try { registrationCount = (await eventRef.get()).data().registrationCount || null; } catch (e) {}

  return { ok: true, alreadyRegistered, registrationCount };
});

// ────────────────────────────────────────────────────────────────
// Course interest + member onboarding → CRM
//
// Both callables upsert the caller into the academy's CRM (the owner's
// company) so admins/owners can see who signed up and what they want.
// They run with the Admin SDK, so they bypass Firestore rules — members
// never get direct write access to the contacts collection.
// ────────────────────────────────────────────────────────────────

// Resolve the academy's company (the owner's). Cached per cold start.
let _academyCompanyIdCache = null;
async function resolveAcademyCompanyId(db) {
  if (_academyCompanyIdCache) return _academyCompanyIdCache;
  // 1) Find the owner user, prefer their companyId.
  try {
    const snap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
    if (!snap.empty) {
      const owner = snap.docs[0];
      const cid = owner.data().companyId;
      if (cid) { _academyCompanyIdCache = cid; return cid; }
      // 2) Else a company the owner administers.
      const cSnap = await db.collection('companies').where('adminUids', 'array-contains', owner.id).limit(1).get();
      if (!cSnap.empty) { _academyCompanyIdCache = cSnap.docs[0].id; return cSnap.docs[0].id; }
    }
  } catch (e) { console.warn('[resolveAcademyCompanyId]', e && e.message); }
  // 3) Fallback: the first company that exists.
  try {
    const any = await db.collection('companies').limit(1).get();
    if (!any.empty) { _academyCompanyIdCache = any.docs[0].id; return any.docs[0].id; }
  } catch (e) {}
  return null;
}

// Find-or-create a contact by email, merge fields, and return its ref.
async function upsertCrmContact(db, companyId, { name, email, phone, address, companyName, source, tags }) {
  const colRef = db.collection('companies').doc(companyId).collection('contacts');
  const FV = admin.firestore.FieldValue;
  let ref = null;
  try {
    const snap = await colRef.where('email', '==', email).limit(1).get();
    if (!snap.empty) ref = snap.docs[0].ref;
  } catch (e) {}

  if (ref) {
    const patch = { updatedAt: FV.serverTimestamp(), lastActivityAt: FV.serverTimestamp() };
    if (name) patch.name = name;
    if (phone) patch.phone = phone;
    if (address) patch.address = address;
    if (companyName) patch.companyName = companyName;
    if (tags && tags.length) patch.tags = FV.arrayUnion(...tags);
    await ref.set(patch, { merge: true });
  } else {
    ref = await colRef.add({
      name: name || 'Member',
      email,
      phone: phone || null,
      address: address || null,
      companyName: companyName || null,
      source: source || 'Member',
      stage: 'new',
      tags: tags || [],
      ownerUid: null,
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
      createdBy: 'system',
      lastActivityAt: FV.serverTimestamp()
    });
  }
  return ref;
}

// registerCourseInterest({ slug, title }) — member taps "Notify me when live".
exports.registerCourseInterest = onCall(async (request) => {
  const db = admin.firestore();
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const slug = (data.slug || '').toString().trim().slice(0, 80);
  const title = (data.title || '').toString().trim().slice(0, 120) || slug;
  if (!slug) throw new HttpsError('invalid-argument', 'A course slug is required.');

  const userSnap = await db.collection('users').doc(uid).get();
  const u = userSnap.exists ? userSnap.data() : {};
  const email = (u.email || (request.auth.token && request.auth.token.email) || '').toString().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpsError('failed-precondition', 'Your account has no valid email.');

  const FV = admin.firestore.FieldValue;

  // Mirror to the member's own account (dedupes the button + lets them see it).
  await db.collection('users').doc(uid).collection('courseInterests').doc(slug).set({
    slug, title, createdAt: FV.serverTimestamp()
  }, { merge: true });

  // Upsert into the CRM (best-effort).
  try {
    const companyId = await resolveAcademyCompanyId(db);
    if (companyId) {
      const ref = await upsertCrmContact(db, companyId, {
        name: u.displayName || null,
        email,
        phone: u.phone || null,
        address: u.address || null,
        companyName: u.company || null,
        source: 'Course Interest',
        tags: [`Waitlist: ${title}`.slice(0, 40)]
      });
      await ref.collection('activities').add({
        type: 'course_interest',
        description: `Joined the waitlist for "${title}"`,
        actorUid: 'system',
        actorName: 'Course waitlist',
        createdAt: FV.serverTimestamp(),
        meta: { courseSlug: slug, courseTitle: title }
      });
    }
  } catch (e) {
    console.warn('[registerCourseInterest] CRM upsert failed:', e && e.message);
  }

  return { ok: true, slug };
});

// submitOnboarding({ displayName, phone, address, company, industry, location, goals })
// Required after member-portal signup. Updates the user profile and upserts
// the member into the CRM with everything they entered.
exports.submitOnboarding = onCall(async (request) => {
  const db = admin.firestore();
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const s = (v, n) => (v || '').toString().trim().slice(0, n);
  const displayName = s(data.displayName, 120);
  const phone = s(data.phone, 40);
  const address = s(data.address, 240);
  const company = s(data.company, 120);
  const industry = s(data.industry, 80);
  const location = s(data.location, 120);
  const goals = s(data.goals, 1000);
  const marketingConsent = data.marketingConsent === true;
  const consentText = s(data.consentText, 1000);

  if (!displayName) throw new HttpsError('invalid-argument', 'Please enter your name.');
  if (!phone) throw new HttpsError('invalid-argument', 'Please enter a phone number.');

  const FV = admin.firestore.FieldValue;
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const u = userSnap.exists ? userSnap.data() : {};
  const email = (u.email || (request.auth.token && request.auth.token.email) || '').toString().toLowerCase();

  // 1) Update the member's profile doc + flip the onboarding gate.
  // Record the marketing/communications consent as a durable proof-of-opt-in:
  // the boolean, the timestamp, and the exact wording the member agreed to.
  const profilePatch = {
    displayName: displayName || u.displayName || null,
    phone, address, company, industry, location,
    communityGoals: goals,
    marketingConsent,
    onboardingComplete: true,
    onboardingAt: FV.serverTimestamp(),
    lastActiveAt: FV.serverTimestamp()
  };
  if (marketingConsent) {
    profilePatch.marketingConsentAt = FV.serverTimestamp();
    if (consentText) profilePatch.marketingConsentText = consentText;
  }
  await userRef.set(profilePatch, { merge: true });

  // 2) Upsert into the CRM (best-effort).
  try {
    const companyId = await resolveAcademyCompanyId(db);
    if (companyId && EMAIL_RE.test(email)) {
      const ref = await upsertCrmContact(db, companyId, {
        name: displayName,
        email,
        phone,
        address,
        companyName: company,
        source: 'Member Signup',
        tags: [
          'Member',
          industry ? `Industry: ${industry}`.slice(0, 40) : null,
          marketingConsent ? 'Opt-In: Calls/SMS/Email' : null
        ].filter(Boolean)
      });
      // Persist consent flags on the contact for filtering/segmenting.
      await ref.set({
        marketingConsent,
        marketingConsentAt: marketingConsent ? FV.serverTimestamp() : null,
        marketingConsentText: marketingConsent ? (consentText || null) : null
      }, { merge: true });
      await ref.collection('activities').add({
        type: 'member_onboarding',
        description: 'Completed member-portal onboarding'
          + (goals ? ` — Goals: ${goals.slice(0, 200)}` : ''),
        actorUid: 'system',
        actorName: 'Member onboarding',
        createdAt: FV.serverTimestamp(),
        meta: { phone, address, company, industry, location, goals }
      });
      // Separate, explicit consent record (proof of opt-in / opt-out).
      await ref.collection('activities').add({
        type: 'consent_updated',
        description: marketingConsent
          ? 'Opted IN to calls, SMS, and email communications'
          : 'Did NOT opt in to calls, SMS, or email communications',
        actorUid: 'system',
        actorName: 'Consent capture',
        createdAt: FV.serverTimestamp(),
        meta: { marketingConsent, consentText: consentText || null, channel: 'onboarding' }
      });
    }
  } catch (e) {
    console.warn('[submitOnboarding] CRM upsert failed:', e && e.message);
  }

  return { ok: true };
});


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

// ────────────────────────────────────────────────────────────────
// Phase 2 — Community leaderboard, points & levels.
//
// Three Firestore triggers (post create, comment create, like write) maintain
// a per-user stats subcollection at users/{uid}/stats/aggregate, plus mirror
// fields `statsPoints` / `statsWeekPoints` on the parent user doc so the
// leaderboard query can `orderBy('statsPoints')` without a collectionGroup.
//
// Points formula:
//   - post created      +5 points (+10 if category=='wins')
//   - comment created   +1 point
//   - like received     +2 points to the post author
//   - like given        0 points (vanity stat)
//
// Levels are computed client-side from `points` — never written to Firestore.
//
// Weekly reset is "lazy": each trigger compares the stat doc's
// `weekStartedAt` to the current Monday-00:00-UTC. If older, weekPoints
// resets to the current delta; otherwise it increments. No Pub/Sub needed.
// ────────────────────────────────────────────────────────────────

const POINTS = {
  POST: 5,
  POST_WIN: 10,
  COMMENT: 1,
  LIKE_RECEIVED: 2
};

function currentWeekStartUTC() {
  // Monday 00:00:00.000 UTC of the current week.
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = (day + 6) % 7; // Mon=0, Tue=1, .., Sun=6
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - offsetToMonday,
    0, 0, 0, 0
  ));
  return monday;
}

/**
 * Apply a points delta to a user's stat aggregate doc + mirror fields on the
 * parent user doc, with lazy week-roll. Also bumps the named counter (e.g.
 * 'postCount', 'commentCount', 'likesReceived') by `counterDelta`.
 *
 * Single transaction for read-then-write atomicity. Cheap (1 read + 2 writes).
 */
async function applyPointsDelta(db, uid, pointsDelta, counters) {
  if (!uid) return;
  const userRef = db.collection('users').doc(uid);
  const statRef = userRef.collection('stats').doc('aggregate');
  const weekStart = currentWeekStartUTC();

  await db.runTransaction(async (tx) => {
    const [statSnap, userSnap] = await Promise.all([tx.get(statRef), tx.get(userRef)]);
    const stat = statSnap.exists ? statSnap.data() : {};
    const prevWeekStart = stat.weekStartedAt && stat.weekStartedAt.toMillis
      ? new Date(stat.weekStartedAt.toMillis())
      : null;
    const sameWeek = prevWeekStart && prevWeekStart.getTime() >= weekStart.getTime();

    const nextPoints = Math.max(0, (stat.points || 0) + pointsDelta);
    const nextWeekPoints = sameWeek
      ? Math.max(0, (stat.weekPoints || 0) + pointsDelta)
      : Math.max(0, pointsDelta);

    const statPatch = {
      points: nextPoints,
      weekPoints: nextWeekPoints,
      weekStartedAt: admin.firestore.Timestamp.fromDate(weekStart),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (counters) {
      Object.keys(counters).forEach((k) => {
        statPatch[k] = Math.max(0, (stat[k] || 0) + counters[k]);
      });
    }
    tx.set(statRef, statPatch, { merge: true });

    // Mirror onto user doc so the leaderboard query can orderBy without a
    // collectionGroup on the subcollection. Only write if the user doc exists
    // (otherwise we'd create a doc lacking auth-bound fields like email).
    if (userSnap.exists) {
      tx.set(userRef, {
        statsPoints: nextPoints,
        statsWeekPoints: nextWeekPoints
      }, { merge: true });
    }
  });
}

// Trigger handlers (onPostCreated / onCommentCreated / onLikeWritten) are
// defined further down in the Phase 3 block; they handle BOTH the points
// updates and the notification fan-out so the trigger boundary stays simple.

/**
 * getLeaderboard({ scope='global'|'company', limit=20 }) — callable.
 *
 * Returns the top N users by all-time `statsPoints`. Server-side because the
 * `users` collection has `allow list: if isOwner()` — going through Admin SDK
 * lets us project ONLY the safe fields (uid, displayName, avatarUrl,
 * statsPoints, statsWeekPoints, level) without leaking emails / companyIds.
 *
 * scope='company' restricts to caller's companyId. Owner sees global.
 */
exports.getLeaderboard = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const scope = data.scope === 'company' ? 'company' : 'global';
  const lim = Math.max(1, Math.min(50, Number(data.limit) || 20));

  const db = admin.firestore();

  // Resolve caller context for company scoping.
  let callerCompanyId = null;
  try {
    const meSnap = await db.collection('users').doc(callerUid).get();
    if (meSnap.exists) callerCompanyId = meSnap.data().companyId || null;
  } catch (e) { /* best-effort */ }

  let q;
  if (scope === 'company' && callerCompanyId) {
    q = db.collection('users')
      .where('companyId', '==', callerCompanyId)
      .orderBy('statsPoints', 'desc')
      .limit(lim);
  } else {
    q = db.collection('users')
      .orderBy('statsPoints', 'desc')
      .limit(lim);
  }

  let snap;
  try {
    snap = await q.get();
  } catch (err) {
    console.error('[getLeaderboard] query failed:', err && err.message);
    throw new HttpsError('internal', 'Could not load leaderboard.');
  }

  const rows = snap.docs.map((d) => {
    const u = d.data() || {};
    return {
      uid: d.id,
      displayName: u.displayName || u.email || 'Unknown',
      avatarUrl: u.avatarUrl || null,
      statsPoints: Number(u.statsPoints || 0),
      statsWeekPoints: Number(u.statsWeekPoints || 0)
    };
  }).filter((r) => r.statsPoints > 0); // Hide users who never engaged.

  return { ok: true, scope, rows };
});

/**
 * recomputeUserStats({ uid }) — owner-only callable. Repair / backfill path.
 *
 * Paginates the target user's posts + likes-received and rewrites the stat
 * aggregate from scratch. Comments aren't easily countable across all parent
 * posts without a collectionGroup query, so commentCount is reset to 0 — the
 * trigger will re-accumulate going forward. Acceptable for v1.
 */
exports.recomputeUserStats = onCall(async (request) => {
  const isOwnerClaim = request.auth && request.auth.token && request.auth.token.role === 'owner';
  if (!isOwnerClaim) throw new HttpsError('permission-denied', 'Owner only.');

  const uid = (request.data && request.data.uid || '').toString().trim();
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const statRef = userRef.collection('stats').doc('aggregate');

  // Posts authored by this user — drives postCount + base post points.
  let postCount = 0;
  let winsCount = 0;
  let likesReceived = 0;
  const authoredPostIds = [];
  try {
    const postsSnap = await db.collection('posts').where('authorUid', '==', uid).get();
    postsSnap.forEach((d) => {
      const p = d.data() || {};
      postCount += 1;
      if (p.category === 'wins') winsCount += 1;
      likesReceived += Number(p.likeCount || 0);
      authoredPostIds.push(d.id);
    });
  } catch (err) {
    console.error('[recomputeUserStats] posts query failed:', err && err.message);
    throw new HttpsError('internal', 'Could not read posts.');
  }

  const points =
    (postCount - winsCount) * POINTS.POST +
    winsCount * POINTS.POST_WIN +
    likesReceived * POINTS.LIKE_RECEIVED;

  const weekStart = currentWeekStartUTC();

  await db.runTransaction(async (tx) => {
    tx.set(statRef, {
      points,
      postCount,
      commentCount: 0,
      likesReceived,
      likesGiven: 0,
      weekPoints: 0,
      weekStartedAt: admin.firestore.Timestamp.fromDate(weekStart),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(userRef, {
      statsPoints: points,
      statsWeekPoints: 0
    }, { merge: true });
  });

  return { ok: true, uid, points, postCount, winsCount, likesReceived };
});

// ────────────────────────────────────────────────────────────────
// Phase 3 — Notifications (mention / like / comment) + FCM push
// + member search.
//
// Triggers fan out one Firestore notification doc per recipient. Doc IDs
// are deterministic so re-firing (e.g. unlike → like) collapses into a
// single row instead of spamming the inbox. unreadNotifCount on the user
// doc mirrors the count of unread notifs, used to badge the bell icon
// without an extra query.
// ────────────────────────────────────────────────────────────────

const NOTIF_TRUNCATE = 140;

function clampPreview(text) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > NOTIF_TRUNCATE ? t.slice(0, NOTIF_TRUNCATE) + '…' : t;
}

/**
 * Send a multicast FCM push to a user's registered tokens. Best-effort:
 * never throws. Prunes tokens that come back as not-registered.
 */
async function pushToUser(db, uid, payload) {
  if (!uid || !payload) return { sent: 0, failed: 0 };
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return { sent: 0, failed: 0 };
    const data = userSnap.data() || {};
    const prefs = data.notifPrefs || {};
    if (prefs.push === false) return { sent: 0, failed: 0 };
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens.filter((t) => typeof t === 'string' && t) : [];
    if (!tokens.length) return { sent: 0, failed: 0 };

    const messaging = admin.messaging();
    const message = {
      tokens,
      notification: {
        title: payload.title || '1P Leadership',
        body: payload.body || ''
      },
      data: payload.data || {},
      webpush: {
        fcmOptions: { link: (payload.data && payload.data.url) || `${APP_BASE_URL}/community.html` }
      }
    };
    const resp = await messaging.sendEachForMulticast(message);
    const stale = [];
    (resp.responses || []).forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) stale.push(tokens[i]);
    });
    if (stale.length) {
      try {
        await db.collection('users').doc(uid).set({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale)
        }, { merge: true });
      } catch (e) { /* ignore */ }
    }
    return { sent: resp.successCount || 0, failed: resp.failureCount || 0 };
  } catch (err) {
    console.error('[pushToUser] failed:', err && err.message);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Write a notification with a deterministic ID. If it already exists
 * AND was unread, this is a no-op (avoids double-counting on re-fire).
 * If it was read or didn't exist, sets to unread and bumps the parent
 * user doc's unreadNotifCount. Returns true iff this was a new unread.
 *
 * Uses a transaction so the count + doc stay consistent.
 */
async function notifyUser(db, recipientUid, notif, { typePrefKey } = {}) {
  if (!recipientUid || !notif || !notif.id) return false;
  const userRef = db.collection('users').doc(recipientUid);
  const notifRef = userRef.collection('notifications').doc(notif.id);

  const result = await db.runTransaction(async (tx) => {
    const [notifSnap, userSnap] = await Promise.all([tx.get(notifRef), tx.get(userRef)]);

    // Respect per-user opt-out (notifPrefs.mentions / .likes / .comments).
    if (typePrefKey && userSnap.exists) {
      const prefs = (userSnap.data() && userSnap.data().notifPrefs) || {};
      if (prefs[typePrefKey] === false) return { newUnread: false, skipped: true };
    }

    const wasUnread = notifSnap.exists && notifSnap.data().read === false;
    const willBeUnread = true;

    const patch = {
      type: notif.type,
      fromUid: notif.fromUid || null,
      fromName: notif.fromName || '',
      fromAvatar: notif.fromAvatar || null,
      postId: notif.postId || null,
      commentId: notif.commentId || null,
      category: notif.category || null,
      preview: notif.preview || '',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.set(notifRef, patch, { merge: true });

    if (!wasUnread && willBeUnread && userSnap.exists) {
      tx.set(userRef, {
        unreadNotifCount: admin.firestore.FieldValue.increment(1)
      }, { merge: true });
      return { newUnread: true, skipped: false };
    }
    return { newUnread: false, skipped: false };
  });

  return result.newUnread;
}

/**
 * Fan out @mention notifications to a set of recipients. Filters out the
 * actor (no self-notify) and dedupes. Caller passes the surrounding post
 * info so we don't re-read it. Optionally pushes FCM after the Firestore
 * write so badge counts are accurate even if push fails.
 */
async function fanOutMentions(db, mentionedUids, ctx) {
  if (!Array.isArray(mentionedUids) || !mentionedUids.length) return;
  const seen = new Set();
  for (const uid of mentionedUids) {
    if (!uid || uid === ctx.fromUid || seen.has(uid)) continue;
    seen.add(uid);
    const notifId = ctx.commentId
      ? `mention_comment_${ctx.commentId}_${ctx.fromUid}`
      : `mention_post_${ctx.postId}_${ctx.fromUid}`;
    const wasNew = await notifyUser(db, uid, {
      id: notifId,
      type: 'mention',
      fromUid: ctx.fromUid,
      fromName: ctx.fromName,
      fromAvatar: ctx.fromAvatar,
      postId: ctx.postId,
      commentId: ctx.commentId || null,
      category: ctx.category || null,
      preview: clampPreview(ctx.preview)
    }, { typePrefKey: 'mentions' });
    if (wasNew) {
      pushToUser(db, uid, {
        title: `${ctx.fromName || 'Someone'} mentioned you`,
        body: clampPreview(ctx.preview),
        data: {
          url: `${APP_BASE_URL}/community.html?post=${encodeURIComponent(ctx.postId)}`,
          type: 'mention',
          postId: ctx.postId
        }
      }).catch(() => {});
    }
  }
}

// Replace the Phase 2 onPostCreated to also fan out mention notifs, and
// piggyback the activity timestamp on the user doc.
exports.onPostCreated = onDocumentCreated(
  { document: 'posts/{postId}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const post = snap.data() || {};
    const author = post.authorUid;
    if (!author) return;

    const isWin = post.category === 'wins';
    const delta = isWin ? POINTS.POST_WIN : POINTS.POST;
    const db = admin.firestore();
    try {
      await applyPointsDelta(db, author, delta, { postCount: 1 });
    } catch (err) {
      console.error('[onPostCreated] points apply failed:', err && err.message);
    }

    // Mention fan-out.
    try {
      await fanOutMentions(db, post.mentionedUids || [], {
        fromUid: author,
        fromName: post.authorName || '',
        fromAvatar: post.authorAvatar || null,
        postId: snap.id,
        commentId: null,
        category: post.category || null,
        preview: post.text || ''
      });
    } catch (err) {
      console.error('[onPostCreated] mention fan-out failed:', err && err.message);
    }
  }
);

// Replace the Phase 2 onCommentCreated to also fan out comment + mention notifs.
exports.onCommentCreated = onDocumentCreated(
  { document: 'posts/{postId}/comments/{commentId}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const comment = snap.data() || {};
    const commenter = comment.authorUid;
    const postId = event.params.postId;
    const commentId = event.params.commentId;
    if (!commenter || !postId) return;

    const db = admin.firestore();
    try {
      await applyPointsDelta(db, commenter, POINTS.COMMENT, { commentCount: 1 });
    } catch (err) {
      console.error('[onCommentCreated] points apply failed:', err && err.message);
    }

    // Notify the post author (skip if commenter == author).
    let postData = null;
    try {
      const postSnap = await db.collection('posts').doc(postId).get();
      if (postSnap.exists) postData = postSnap.data();
    } catch (e) { /* tolerated */ }

    if (postData && postData.authorUid && postData.authorUid !== commenter) {
      try {
        const wasNew = await notifyUser(db, postData.authorUid, {
          id: `comment_${commentId}`,
          type: 'comment',
          fromUid: commenter,
          fromName: comment.authorName || '',
          fromAvatar: comment.authorAvatar || null,
          postId,
          commentId,
          category: postData.category || null,
          preview: clampPreview(comment.text || '')
        }, { typePrefKey: 'comments' });
        if (wasNew) {
          pushToUser(db, postData.authorUid, {
            title: `${comment.authorName || 'Someone'} commented on your post`,
            body: clampPreview(comment.text || ''),
            data: {
              url: `${APP_BASE_URL}/community.html?post=${encodeURIComponent(postId)}`,
              type: 'comment',
              postId
            }
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[onCommentCreated] author notify failed:', err && err.message);
      }
    }

    // Mention fan-out for @mentions in the comment body.
    try {
      await fanOutMentions(db, comment.mentionedUids || [], {
        fromUid: commenter,
        fromName: comment.authorName || '',
        fromAvatar: comment.authorAvatar || null,
        postId,
        commentId,
        category: postData ? (postData.category || null) : null,
        preview: comment.text || ''
      });
    } catch (err) {
      console.error('[onCommentCreated] mention fan-out failed:', err && err.message);
    }
  }
);

// Replace the Phase 2 onLikeWritten to also write a like notif on like-add.
// (Like-remove leaves the existing notif in place — typical social UX.)
exports.onLikeWritten = onDocumentWritten(
  { document: 'posts/{postId}/likes/{uid}' },
  async (event) => {
    const beforeExists = event.data && event.data.before && event.data.before.exists;
    const afterExists = event.data && event.data.after && event.data.after.exists;
    if (beforeExists === afterExists) return;

    const liker = event.params.uid;
    const postId = event.params.postId;
    if (!liker || !postId) return;

    const isLikeAdded = !beforeExists && afterExists;
    const sign = isLikeAdded ? 1 : -1;

    const db = admin.firestore();
    let post = null;
    try {
      const postSnap = await db.collection('posts').doc(postId).get();
      if (postSnap.exists) post = { id: postSnap.id, ...postSnap.data() };
    } catch (err) {
      console.warn('[onLikeWritten] post fetch failed:', err && err.message);
    }

    try {
      await applyPointsDelta(db, liker, 0, { likesGiven: sign });
    } catch (err) {
      console.error('[onLikeWritten] liker stat update failed:', err && err.message);
    }

    if (post && post.authorUid && post.authorUid !== liker) {
      try {
        await applyPointsDelta(
          db,
          post.authorUid,
          sign * POINTS.LIKE_RECEIVED,
          { likesReceived: sign }
        );
      } catch (err) {
        console.error('[onLikeWritten] author stat update failed:', err && err.message);
      }

      // Only write a notif on like-add. We need the liker's display info; pull
      // it from the like-doc's parent author lookup if present, else fall back
      // to a fetch on the liker's user doc.
      if (isLikeAdded) {
        let likerName = '';
        let likerAvatar = null;
        try {
          const likerSnap = await db.collection('users').doc(liker).get();
          if (likerSnap.exists) {
            const u = likerSnap.data() || {};
            likerName = u.displayName || u.email || '';
            likerAvatar = u.avatarUrl || null;
          }
        } catch (e) { /* tolerated */ }

        try {
          const wasNew = await notifyUser(db, post.authorUid, {
            id: `like_${postId}_${liker}`,
            type: 'like',
            fromUid: liker,
            fromName: likerName,
            fromAvatar: likerAvatar,
            postId,
            commentId: null,
            category: post.category || null,
            preview: clampPreview(post.text || '')
          }, { typePrefKey: 'likes' });
          if (wasNew) {
            pushToUser(db, post.authorUid, {
              title: `${likerName || 'Someone'} liked your post`,
              body: clampPreview(post.text || ''),
              data: {
                url: `${APP_BASE_URL}/community.html?post=${encodeURIComponent(postId)}`,
                type: 'like',
                postId
              }
            }).catch(() => {});
          }
        } catch (err) {
          console.error('[onLikeWritten] author notify failed:', err && err.message);
        }
      }
    }
  }
);

/**
 * searchMembers({ query }) — autocomplete for @mention picking.
 *
 * Server-side because the `users` collection has `allow list: if isOwner()`.
 * We project safe fields only (uid, displayName, avatarUrl) and scope the
 * candidate set to the caller's visibility:
 *   - owner → all users
 *   - team user / admin → company members + owner
 *   - individual buyer → owner only (closest thing to a "global" they share with)
 *
 * Returns up to 10 matches sorted by displayName asc.
 */
exports.searchMembers = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const q = (data.query || '').toString().trim().toLowerCase();
  if (!q) return { ok: true, results: [] };

  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  const db = admin.firestore();

  let callerCompanyId = null;
  if (!isOwnerClaim) {
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      if (meSnap.exists) callerCompanyId = meSnap.data().companyId || null;
    } catch (e) { /* best-effort */ }
  }

  // Collect a candidate pool, then filter by prefix match in JS. Prefix-only
  // matching ('alex' matches 'Alex Chen', 'alexandra'; not 'sandra alex').
  const pool = new Map(); // uid → { uid, displayName, avatarUrl }
  function add(uid, doc) {
    if (!uid || pool.has(uid)) return;
    const u = doc || {};
    pool.set(uid, {
      uid,
      displayName: u.displayName || u.email || 'Unknown',
      avatarUrl: u.avatarUrl || null
    });
  }

  try {
    if (isOwnerClaim) {
      const snap = await db.collection('users').limit(500).get();
      snap.docs.forEach((d) => add(d.id, d.data()));
    } else if (callerCompanyId) {
      const memSnap = await db.collection('companies').doc(callerCompanyId).collection('members').limit(500).get();
      memSnap.docs.forEach((d) => add(d.id, d.data()));
      // Also include owner so users can @mention support.
      const ownerSnap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
      ownerSnap.docs.forEach((d) => add(d.id, d.data()));
    } else {
      // Individual buyer — only owner is visible to them via @mention.
      const ownerSnap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
      ownerSnap.docs.forEach((d) => add(d.id, d.data()));
    }
  } catch (err) {
    console.error('[searchMembers] candidate pool fetch failed:', err && err.message);
    return { ok: false, results: [] };
  }

  const results = Array.from(pool.values())
    .filter((u) => (u.displayName || '').toLowerCase().includes(q))
    .sort((a, b) => {
      // Prefix matches first, then alphabetical.
      const ap = (a.displayName || '').toLowerCase().startsWith(q) ? 0 : 1;
      const bp = (b.displayName || '').toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.displayName || '').localeCompare(b.displayName || '');
    })
    .slice(0, 10);

  return { ok: true, results };
});

// ────────────────────────────────────────────────────────────────
// Community invite tokens.
//
// Owner / admin generates a shareable invite link; recipient signs up
// via /signup.html?invite=<token>; the signup flow calls
// acceptCommunityInvite to record the use. Server-only collection so
// tokens never leak via client list operations.
// ────────────────────────────────────────────────────────────────

const COMMUNITY_INVITE_DEFAULT_USES = 100;
const COMMUNITY_INVITE_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function makeInviteToken() {
  // 12 URL-safe characters via base64url of 9 random bytes.
  return crypto.randomBytes(9).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * createCommunityInvite({ usesAllowed?, ttlMs? }) — owner / admin only.
 * Returns { token, url, expiresAt }.
 */
exports.createCommunityInvite = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';

  const db = admin.firestore();

  // Owner is always allowed; otherwise the caller must be a company admin.
  if (!isOwnerClaim) {
    let isAnyCompanyAdmin = false;
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      const cid = meSnap.exists ? (meSnap.data().companyId || null) : null;
      if (cid) {
        const compSnap = await db.collection('companies').doc(cid).get();
        const adminUids = compSnap.exists ? (compSnap.data().adminUids || []) : [];
        isAnyCompanyAdmin = adminUids.includes(callerUid);
      }
    } catch (e) { /* best-effort */ }
    if (!isAnyCompanyAdmin) {
      throw new HttpsError('permission-denied', 'Only owners and admins can create invites.');
    }
  }

  const data = request.data || {};
  const usesAllowed = Math.max(1, Math.min(1000, Number(data.usesAllowed) || COMMUNITY_INVITE_DEFAULT_USES));
  const ttlMs = Math.max(60 * 60 * 1000, Math.min(365 * 24 * 60 * 60 * 1000, Number(data.ttlMs) || COMMUNITY_INVITE_DEFAULT_TTL_MS));
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttlMs);

  // Look up creator's display name for analytics.
  let createdByName = (request.auth.token && request.auth.token.name) || null;
  if (!createdByName) {
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      if (meSnap.exists) createdByName = meSnap.data().displayName || meSnap.data().email || null;
    } catch (e) { /* tolerated */ }
  }

  // Generate a token and ensure no collision (extremely unlikely; one retry).
  let token = makeInviteToken();
  for (let i = 0; i < 3; i++) {
    const probe = await db.collection('communityInvites').doc(token).get();
    if (!probe.exists) break;
    token = makeInviteToken();
  }

  await db.collection('communityInvites').doc(token).set({
    token,
    createdByUid: callerUid,
    createdByName: createdByName || 'Unknown',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    usesAllowed,
    usesUsed: 0,
    usedBy: []
  });

  const url = `${APP_BASE_URL}/signup.html?invite=${encodeURIComponent(token)}`;
  return { ok: true, token, url, expiresAt: expiresAt.toMillis(), usesAllowed };
});

/**
 * acceptCommunityInvite({ token }) — any authenticated user.
 *
 * Validates the token (exists, not expired, has uses remaining) and
 * records this user's acceptance. Idempotent: a user accepting twice is
 * a no-op (their uid is added to usedBy at most once). Returns
 * { ok, alreadyAccepted? } so the client can decide whether to celebrate.
 */
exports.acceptCommunityInvite = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const token = (request.data && request.data.token || '').toString().trim();
  if (!token) throw new HttpsError('invalid-argument', 'Token is required.');

  const db = admin.firestore();
  const ref = db.collection('communityInvites').doc(token);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Invite not found.');
    }
    const inv = snap.data() || {};

    const now = Date.now();
    const exp = inv.expiresAt && inv.expiresAt.toMillis ? inv.expiresAt.toMillis() : 0;
    if (exp && exp < now) {
      throw new HttpsError('failed-precondition', 'Invite has expired.');
    }
    const used = Number(inv.usesUsed || 0);
    const allowed = Number(inv.usesAllowed || COMMUNITY_INVITE_DEFAULT_USES);
    if (used >= allowed) {
      throw new HttpsError('resource-exhausted', 'Invite has no uses remaining.');
    }
    const usedBy = Array.isArray(inv.usedBy) ? inv.usedBy : [];
    if (usedBy.includes(uid)) {
      return { alreadyAccepted: true };
    }
    tx.update(ref, {
      usesUsed: used + 1,
      usedBy: admin.firestore.FieldValue.arrayUnion(uid),
      lastAcceptedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { alreadyAccepted: false };
  });

  // Stamp the accepting user's doc with referral info so the inviter
  // can be credited in future analytics. Best-effort.
  try {
    await db.collection('users').doc(uid).set({
      invitedByToken: token,
      invitedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) { /* tolerated */ }

  return { ok: true, ...result };
});

// ────────────────────────────────────────────────────────────────
// Search (Stage 2 — topbar search overlay).
//
// Server-side substring match on the latest N posts visible to the
// caller. Bounded by a hard limit so an unbounded query can't drain
// reads. Pairs with the existing searchMembers callable on the
// frontend (called in parallel) to populate the topbar overlay.
// ────────────────────────────────────────────────────────────────

const SEARCH_POSTS_POOL = 200;       // recent posts inspected per call
const SEARCH_POSTS_RESULTS = 10;     // results returned

exports.searchPosts = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const q = (data.query || '').toString().trim().toLowerCase();
  if (!q) return { ok: true, results: [] };
  if (q.length < 2) return { ok: true, results: [] };

  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  const db = admin.firestore();

  let callerCompanyId = null;
  if (!isOwnerClaim) {
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      if (meSnap.exists) callerCompanyId = meSnap.data().companyId || null;
    } catch (e) { /* tolerated */ }
  }

  const pool = [];
  const seen = new Set();
  function add(d) {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    pool.push({ id: d.id, ...d.data() });
  }

  try {
    if (isOwnerClaim) {
      const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get();
      snap.docs.forEach(add);
    } else if (callerCompanyId) {
      const [companySnap, globalSnap] = await Promise.all([
        db.collection('posts').where('companyId', '==', callerCompanyId).orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get(),
        db.collection('posts').where('companyId', '==', null).orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get()
      ]);
      companySnap.docs.forEach(add);
      globalSnap.docs.forEach(add);
    } else {
      const snap = await db.collection('posts').where('companyId', '==', null).orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get();
      snap.docs.forEach(add);
    }
  } catch (err) {
    console.error('[searchPosts] pool fetch failed:', err && err.message);
    return { ok: false, results: [] };
  }

  const results = pool
    .filter((p) => {
      const text = (p.text || '').toLowerCase();
      const author = (p.authorName || '').toLowerCase();
      return text.includes(q) || author.includes(q);
    })
    .sort((a, b) => {
      // Title-text matches first, then author matches; within each group,
      // recency (descending createdAt).
      const at = (a.text || '').toLowerCase().includes(q) ? 0 : 1;
      const bt = (b.text || '').toLowerCase().includes(q) ? 0 : 1;
      if (at !== bt) return at - bt;
      const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bm - am;
    })
    .slice(0, SEARCH_POSTS_RESULTS)
    .map((p) => ({
      id: p.id,
      text: (p.text || '').slice(0, 200),
      authorName: p.authorName || 'Unknown',
      authorUid: p.authorUid || null,
      authorAvatar: p.authorAvatar || null,
      category: p.category || 'general',
      createdAt: p.createdAt && p.createdAt.toMillis ? p.createdAt.toMillis() : null,
      likeCount: p.likeCount || 0,
      commentCount: p.commentCount || 0
    }));

  return { ok: true, results };
});





// ────────────────────────────────────────────────────────────────
// Course commerce — enrollment + Stripe checkout.
//
// Stripe keys are read from the environment at runtime (set them in
// functions/.env or via Secret Manager once a Stripe account exists):
//   STRIPE_SECRET_KEY      — sk_live_... / sk_test_...
//   STRIPE_WEBHOOK_SECRET  — whsec_... (from the webhook endpoint config)
// Until they're set, paid checkout returns a clear "not configured" error
// while free enrollment keeps working.
// ────────────────────────────────────────────────────────────────

let _stripeClient = null;
function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;
  if (!_stripeClient) {
    // Lazy require so deploys work before the dependency/key are exercised.
    _stripeClient = require('stripe')(key);
  }
  return _stripeClient;
}

async function isAdminCaller(db, request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) return false;
  if (request.auth.token && request.auth.token.role === 'owner') return true;
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists && snap.data().role === 'admin';
}

function effectivePriceDollars(course) {
  const base = typeof course.price === 'number' ? course.price : null;
  const sale = typeof course.salePrice === 'number' && course.salePrice >= 0 ? course.salePrice : null;
  if (sale != null && base != null && sale < base) return sale;
  return base;
}

// enrollFree — server-side enrollment for free (or legacy) courses. All
// client enrollment goes through here; firestore rules freeze
// enrolledCourseSlugs on self-writes.
exports.enrollFree = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const slug = String((request.data && request.data.slug) || '').trim();
  if (!slug) throw new HttpsError('invalid-argument', 'slug is required.');

  const db = admin.firestore();
  const courseSnap = await db.collection('courses').doc(slug).get();
  const course = courseSnap.exists ? courseSnap.data() : null;

  // Legacy migration: users with pre-enrollment 1P-CLC progress keep access
  // even though the course is paid. Server-verifies the progress exists.
  const legacy = !!(request.data && request.data.legacy) && slug === '1p-clc';
  if (legacy) {
    const prog = await db.collection('users').doc(uid).collection('progress').limit(1).get();
    if (prog.empty) throw new HttpsError('failed-precondition', 'No prior progress found.');
  } else {
    if (!course) throw new HttpsError('not-found', 'Unknown course.');
    if (course.status !== 'live') {
      throw new HttpsError('failed-precondition', 'This course isn\'t available to join yet.');
    }
    const price = effectivePriceDollars(course);
    if (price != null && price > 0) {
      throw new HttpsError('failed-precondition', 'This course requires checkout to enroll.');
    }
  }

  await db.collection('users').doc(uid).set({
    enrolledCourseSlugs: admin.firestore.FieldValue.arrayUnion(slug),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, slug };
});

// createCheckoutSession — starts a Stripe Checkout for a live paid course.
// Price is always read server-side from courses/{slug}; the client only
// sends the slug.
exports.createCheckoutSession = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const slug = String((request.data && request.data.slug) || '').trim();
  if (!slug) throw new HttpsError('invalid-argument', 'slug is required.');

  const stripe = getStripe();
  if (!stripe) {
    throw new HttpsError('failed-precondition',
      'Online checkout isn\'t available yet — payments are still being set up.');
  }

  const db = admin.firestore();
  const courseSnap = await db.collection('courses').doc(slug).get();
  if (!courseSnap.exists) throw new HttpsError('not-found', 'Unknown course.');
  const course = courseSnap.data();
  if (course.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This course isn\'t available to join yet.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const enrolled = (userSnap.exists && userSnap.data().enrolledCourseSlugs) || [];
  if (enrolled.includes(slug)) {
    throw new HttpsError('already-exists', 'You\'re already enrolled in this course.');
  }

  const dollars = effectivePriceDollars(course);
  if (dollars == null || dollars <= 0) {
    throw new HttpsError('failed-precondition', 'This course is free — use enrollFree.');
  }

  const isSubscription = !!(course.pricing && course.pricing.mode === 'subscription');
  const interval = isSubscription
    ? (course.pricing.interval === 'year' ? 'year' : 'month')
    : null;

  // Affiliate attribution — validate the referral code server-side and lock
  // the commission rate into the session metadata at purchase time.
  let refCode = String((request.data && request.data.refCode) || '').trim().toUpperCase();
  let refPercent = null;
  if (refCode) {
    const affSnap = await db.collection('affiliates').doc(refCode).get();
    const aff = affSnap.exists ? affSnap.data() : null;
    const buyerEmail = ((request.auth.token && request.auth.token.email) || '').toLowerCase();
    const selfReferral = aff && (
      (aff.uid && aff.uid === uid)
      || (aff.email && String(aff.email).toLowerCase() === buyerEmail)
    );
    if (aff && aff.active !== false && !selfReferral) {
      refPercent = typeof aff.commissionPercent === 'number' ? aff.commissionPercent : 20;
    } else {
      refCode = '';
    }
  }

  const metadata = { courseSlug: slug, uid };
  if (refCode) {
    metadata.refCode = refCode;
    metadata.refPercent = String(refPercent);
  }

  const priceData = {
    currency: 'usd',
    unit_amount: Math.round(dollars * 100),
    product_data: { name: course.title || slug }
  };
  if (isSubscription) priceData.recurring = { interval };

  const session = await stripe.checkout.sessions.create({
    mode: isSubscription ? 'subscription' : 'payment',
    line_items: [{ price_data: priceData, quantity: 1 }],
    allow_promotion_codes: true,
    customer_email: (request.auth.token && request.auth.token.email) || undefined,
    client_reference_id: uid,
    metadata,
    ...(isSubscription ? { subscription_data: { metadata } } : {}),
    success_url: `${APP_BASE_URL}/courses.html?course=${encodeURIComponent(slug)}&purchase=success`,
    cancel_url: `${APP_BASE_URL}/courses.html`
  });

  return { ok: true, url: session.url };
});

// stripeWebhook — enrolls buyers after checkout and revokes subscription
// access on cancellation. Configure the endpoint in the Stripe dashboard to
// send: checkout.session.completed, customer.subscription.deleted,
// invoice.payment_failed.
exports.stripeWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    const stripe = getStripe();
    const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!stripe || !webhookSecret) {
      console.warn('[stripeWebhook] Stripe not configured');
      res.status(503).send('stripe not configured');
      return;
    }

    let event;
    try {
      const rawBody = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from('');
      event = stripe.webhooks.constructEvent(rawBody, req.get('stripe-signature'), webhookSecret);
    } catch (e) {
      console.warn('[stripeWebhook] signature verification failed:', e && e.message);
      res.status(400).send('invalid signature');
      return;
    }

    const db = admin.firestore();

    // Idempotency: each Stripe event is processed once.
    const evRef = db.collection('stripeEvents').doc(event.id);
    const seen = await evRef.get();
    if (seen.exists) {
      res.status(200).send('ok (duplicate)');
      return;
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const uid = (session.metadata && session.metadata.uid) || session.client_reference_id;
        const courseSlug = session.metadata && session.metadata.courseSlug;
        if (uid && courseSlug) {
          await db.collection('users').doc(uid).set({
            enrolledCourseSlugs: admin.firestore.FieldValue.arrayUnion(courseSlug)
          }, { merge: true });
          await db.collection('users').doc(uid).collection('purchases').doc(session.id).set({
            courseSlug,
            amount: (session.amount_total || 0) / 100,
            mode: session.mode,
            stripeCustomerId: session.customer || null,
            subscriptionId: session.subscription || null,
            status: session.mode === 'subscription' ? 'active' : 'paid',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          if (session.mode === 'subscription' && session.subscription) {
            // Index for cancellation handling.
            await db.collection('stripeSubscriptions').doc(String(session.subscription)).set({
              uid, courseSlug, sessionId: session.id,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }

          // Affiliate commission — the code + rate were validated and locked
          // into metadata by createCheckoutSession.
          const refCode = session.metadata && session.metadata.refCode;
          if (refCode) {
            const affRef = db.collection('affiliates').doc(refCode);
            const affSnap = await affRef.get();
            if (affSnap.exists) {
              const pct = Number(session.metadata.refPercent) ||
                (typeof affSnap.data().commissionPercent === 'number' ? affSnap.data().commissionPercent : 20);
              const saleAmount = (session.amount_total || 0) / 100;
              const commission = Math.round(saleAmount * pct) / 100;
              await affRef.collection('referrals').doc(session.id).set({
                courseSlug,
                buyerUid: uid,
                saleAmount,
                commissionPercent: pct,
                commission,
                mode: session.mode,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              await affRef.set({
                totalSales: admin.firestore.FieldValue.increment(saleAmount),
                totalCommission: admin.firestore.FieldValue.increment(commission),
                saleCount: admin.firestore.FieldValue.increment(1),
                lastSaleAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              await db.collection('users').doc(uid).collection('purchases').doc(session.id)
                .set({ refCode }, { merge: true });
            }
          }

          // ── CRM deal revenue tie-in ──
          // Best-effort: match the buyer to a CRM contact and mark their newest
          // open opportunity as won, recording the paid amount. Non-breaking.
          try {
            let email = (session.customer_details && session.customer_details.email)
              || session.customer_email || null;
            if (!email) {
              const us = await db.collection('users').doc(uid).get();
              email = us.exists ? (us.data().email || null) : null;
            }
            const cid = email ? await resolveAcademyCompanyId(db) : null;
            if (email && cid) {
              const cs = await db.collection('companies').doc(cid).collection('contacts')
                .where('email', '==', email).limit(1).get();
              if (!cs.empty) {
                const contactId = cs.docs[0].id;
                const os = await db.collection('companies').doc(cid).collection('opportunities')
                  .where('contactId', '==', contactId).limit(20).get();
                const open = os.docs.filter((d) => (d.data().status || 'open') === 'open');
                if (open.length) {
                  open.sort((a, b) => {
                    const am = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    const bm = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return bm - am;
                  });
                  const pick = open[0];
                  const amount = (session.amount_total || 0) / 100;
                  await pick.ref.set({
                    status: 'won',
                    wonAt: admin.firestore.FieldValue.serverTimestamp(),
                    stripeSessionId: session.id,
                    amountPaid: amount,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
                  }, { merge: true });
                  await db.collection('companies').doc(cid).collection('contacts').doc(contactId)
                    .collection('activities').add({
                      type: 'deal_won',
                      description: `Deal won via Stripe — ${courseSlug} ($${amount})`,
                      actorUid: uid,
                      actorName: 'Stripe',
                      meta: { opportunityId: pick.id, stripeSessionId: session.id, amount },
                      createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
              }
            }
          } catch (e) { console.warn('[stripeWebhook] deal tie-in skipped:', e && e.message); }
        } else {
          console.warn('[stripeWebhook] session missing uid/courseSlug metadata', session.id);
        }
      } else if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const idx = await db.collection('stripeSubscriptions').doc(String(sub.id)).get();
        const meta = idx.exists ? idx.data() : (sub.metadata && sub.metadata.uid ? sub.metadata : null);
        if (meta && meta.uid && meta.courseSlug) {
          await db.collection('users').doc(meta.uid).set({
            enrolledCourseSlugs: admin.firestore.FieldValue.arrayRemove(meta.courseSlug)
          }, { merge: true });
          if (meta.sessionId) {
            await db.collection('users').doc(meta.uid).collection('purchases').doc(meta.sessionId)
              .set({ status: 'canceled' }, { merge: true });
          }
        }
      } else if (event.type === 'invoice.payment_failed') {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          const idx = await db.collection('stripeSubscriptions').doc(String(subId)).get();
          if (idx.exists && idx.data().sessionId) {
            const meta = idx.data();
            await db.collection('users').doc(meta.uid).collection('purchases').doc(meta.sessionId)
              .set({ status: 'past_due' }, { merge: true });
          }
        }
      }

      await evRef.set({
        type: event.type,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.status(200).send('ok');
    } catch (e) {
      console.error('[stripeWebhook] handler error:', e);
      // Non-2xx so Stripe retries.
      res.status(500).send('handler error');
    }
  }
);

// syncCoupon — mirrors a coupons/{code} doc into a Stripe Coupon +
// Promotion Code so it's redeemable on the checkout page. Admin/owner only.
exports.syncCoupon = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const stripe = getStripe();
  if (!stripe) {
    throw new HttpsError('failed-precondition',
      'Stripe isn\'t configured yet — set STRIPE_SECRET_KEY first.');
  }

  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  if (!code) throw new HttpsError('invalid-argument', 'code is required.');
  const ref = db.collection('coupons').doc(code);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');
  const c = snap.data();
  if (c.stripePromotionCodeId) return { ok: true, alreadySynced: true };

  const couponParams = c.percentOff
    ? { percent_off: Number(c.percentOff) }
    : { amount_off: Math.round(Number(c.amountOff) * 100), currency: 'usd' };
  if (c.expiresAt && c.expiresAt.toDate) {
    couponParams.redeem_by = Math.floor(c.expiresAt.toDate().getTime() / 1000);
  }
  const stripeCoupon = await stripe.coupons.create(couponParams);
  const promo = await stripe.promotionCodes.create({
    coupon: stripeCoupon.id,
    code,
    active: c.active !== false
  });

  await ref.set({
    stripeCouponId: stripeCoupon.id,
    stripePromotionCodeId: promo.id,
    syncedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, promotionCodeId: promo.id };
});

// ────────────────────────────────────────────────────────────────
// Affiliate program — referral codes, click tracking, commissions.
//
// Affiliates live at affiliates/{CODE} (created by owner/admin from
// /manage-affiliates.html). Attribution: links carry ?ref=CODE → stored
// client-side (referral.js) → passed to createCheckoutSession → commission
// recorded by the Stripe webhook. Payouts are manual (mark-as-paid ledger).
// ────────────────────────────────────────────────────────────────

// recordAffiliateClick — public, best-effort click counter for ?ref= visits.
exports.recordAffiliateClick = onCall(async (request) => {
  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  if (!code || code.length > 32) return { ok: false };
  const db = admin.firestore();
  const ref = db.collection('affiliates').doc(code);
  const snap = await ref.get();
  if (!snap.exists || snap.data().active === false) return { ok: false };
  await ref.set({
    clicks: admin.firestore.FieldValue.increment(1),
    lastClickAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// markAffiliatePaid — flips all pending referrals for an affiliate to 'paid'
// and rolls the amount into totalPaid. Owner/admin only (the actual payout
// happens outside the platform — bank transfer, PayPal, etc.).
exports.markAffiliatePaid = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  if (!code) throw new HttpsError('invalid-argument', 'code is required.');

  const affRef = db.collection('affiliates').doc(code);
  const affSnap = await affRef.get();
  if (!affSnap.exists) throw new HttpsError('not-found', 'Affiliate not found.');

  const pending = await affRef.collection('referrals').where('status', '==', 'pending').get();
  if (pending.empty) return { ok: true, paidCount: 0, paidAmount: 0 };

  let paidAmount = 0;
  const batch = db.batch();
  pending.docs.forEach((d) => {
    paidAmount += d.data().commission || 0;
    batch.set(d.ref, {
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidBy: (request.auth.token && request.auth.token.email) || request.auth.uid
    }, { merge: true });
  });
  paidAmount = Math.round(paidAmount * 100) / 100;
  batch.set(affRef, {
    totalPaid: admin.firestore.FieldValue.increment(paidAmount)
  }, { merge: true });
  await batch.commit();

  return { ok: true, paidCount: pending.size, paidAmount };
});
