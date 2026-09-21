#!/usr/bin/env node
// Upload a local image to Firebase Storage and print its public download URL.
//
//   node scripts/upload-image.js <local-file> [destination-path]
//
// Destination defaults to product-images/admin/<filename>, a path storage.rules
// already exposes with `allow read: if true` — so the printed URL works for
// anyone, signed in or not (sales pages, email, ads).
//
// Credentials come from FIREBASE_SERVICE_ACCOUNT_B64 (base64-encoded service
// account JSON, the one that works in a cloud session), or from
// GOOGLE_APPLICATION_CREDENTIALS / `gcloud auth application-default login`
// when running locally.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const PUBLIC_PREFIXES = ['product-images/', 'courses/'];
const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function projectIdFromFirebaserc() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '.firebaserc'), 'utf8');
    return (JSON.parse(raw).projects || {}).default || null;
  } catch (e) {
    return null;
  }
}

/**
 * Resolve credentials without needing a key file on disk.
 *
 * FIREBASE_SERVICE_ACCOUNT_B64 (a base64-encoded service account JSON) is the
 * one that works in a cloud session, where there is no gcloud login and no
 * file to point GOOGLE_APPLICATION_CREDENTIALS at. It is decoded in memory and
 * never written to the repo. Falls back to the standard ADC lookup, so a local
 * run with GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default
 * login` keeps behaving exactly as before.
 */
function resolveCredential() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch (e) {
      console.error('FIREBASE_SERVICE_ACCOUNT_B64 is set but is not valid base64-encoded JSON.');
      process.exit(1);
    }
    return { credential: admin.credential.cert(parsed), projectId: parsed.project_id };
  }
  return { credential: admin.credential.applicationDefault(), projectId: null };
}

async function main() {
  const [localFile, destArg] = process.argv.slice(2);
  if (!localFile) {
    console.error('Usage: node scripts/upload-image.js <local-file> [destination-path]');
    process.exit(1);
  }
  if (!fs.existsSync(localFile)) {
    console.error(`No such file: ${localFile}`);
    process.exit(1);
  }

  const ext = path.extname(localFile).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    console.error(`Unsupported image extension "${ext}". Supported: ${Object.keys(CONTENT_TYPES).join(', ')}`);
    process.exit(1);
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || projectIdFromFirebaserc();
  if (!projectId) {
    console.error('Could not determine the Firebase project. Set GOOGLE_CLOUD_PROJECT or run from a checkout with .firebaserc.');
    process.exit(1);
  }

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  const dest = destArg || `product-images/admin/${path.basename(localFile)}`;

  const cred = resolveCredential();
  admin.initializeApp({
    credential: cred.credential,
    projectId: cred.projectId || projectId,
    storageBucket: bucketName,
  });
  const bucket = admin.storage().bucket();

  const token = crypto.randomUUID();
  try {
    await bucket.upload(localFile, {
      destination: dest,
      metadata: {
        contentType,
        cacheControl: 'public, max-age=604800',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
  } catch (e) {
    console.error(
      `\nUpload to gs://${bucketName} failed.\n  ${e.message}\n\n` +
      'Authenticate with ONE of:\n' +
      '  export FIREBASE_SERVICE_ACCOUNT_B64="$(base64 -w0 /path/to/key.json)"   # works in a cloud session\n' +
      '  export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json\n' +
      '  gcloud auth application-default login\n'
    );
    process.exit(1);
  }

  const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
  const isPublic = PUBLIC_PREFIXES.some((p) => dest.startsWith(p));

  console.log(`\nUploaded to gs://${bucketName}/${dest}`);
  console.log(`\n${url}\n`);
  if (!isPublic) {
    console.log('Note: storage.rules may gate reads on this path. The token URL above still works,');
    console.log('but paths under product-images/ or courses/*/images/ are the ones meant to be public.\n');
  }
}

main();
