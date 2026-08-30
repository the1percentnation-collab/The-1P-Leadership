#!/usr/bin/env node
// Seeds the Zoom booking integration:
//   - config/booking: Anthony's Zoom Scheduler URL + the current webinar's
//     event id (unset until an event is created in /events)
//   - coachDirectory/{FOUNDER_UID}.bookingUrl so Anthony's own directory card
//     shows the "Book a conversation" button (pass FOUNDER_UID in the env)
//
// Safe to re-run; existing values are preserved unless overridden here.
//
// Run with Admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=... FOUNDER_UID=<uid> node scripts/seed-booking.js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const SCHEDULER_URL =
  'https://scheduler.zoom.us/anthony-brown--the-one-percent-3sfu6w/the-1p-nation';

async function main() {
  const bookingRef = db.collection('config').doc('booking');
  const existing = await bookingRef.get();
  await bookingRef.set({
    schedulerUrl: SCHEDULER_URL,
    ...(existing.exists && 'webinarEventId' in existing.data() ? {} : { webinarEventId: null })
  }, { merge: true });
  console.log('config/booking seeded');
  if (!existing.exists || !existing.data().webinarEventId) {
    console.log('TODO Anthony: create the webinar as an event in /events (with its');
    console.log('private join link) and set config/booking.webinarEventId to its id.');
  }

  const founderUid = (process.env.FOUNDER_UID || '').trim();
  if (founderUid) {
    await db.collection('coachDirectory').doc(founderUid).set({
      bookingUrl: SCHEDULER_URL
    }, { merge: true });
    console.log(`coachDirectory/${founderUid}.bookingUrl set`);
  } else {
    console.log('FOUNDER_UID not set; skipped the directory bookingUrl.');
    console.log('Re-run with FOUNDER_UID=<your uid> to add the booking button to your coach card.');
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
