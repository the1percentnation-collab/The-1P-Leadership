// Shared Admin SDK bootstrap for the scripts in this directory.
//
// Why this exists: `admin.initializeApp()` with no arguments fails with an
// unhelpful error when credentials are missing, and it cannot infer the
// project when credentials come from `gcloud auth application-default login`
// (an ADC file carries no project id). This resolves the project from
// .firebaserc, checks for credentials up front, and prints which project is
// about to be written to — so a migration can never quietly hit the wrong one.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function projectIdFromFirebaserc() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '.firebaserc'), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed.projects && parsed.projects.default) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Initialise the Admin SDK and return { db, projectId }.
 * Exits with a readable message rather than a stack trace when misconfigured.
 */
function initAdmin() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || projectIdFromFirebaserc();

  if (!projectId) {
    console.error(
      'Could not determine the Firebase project.\n' +
      'Set GOOGLE_CLOUD_PROJECT, or run from a checkout that has .firebaserc.'
    );
    process.exit(1);
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && !fs.existsSync(keyPath)) {
    console.error(
      `GOOGLE_APPLICATION_CREDENTIALS points at a file that does not exist:\n  ${keyPath}`
    );
    process.exit(1);
  }

  try {
    admin.initializeApp({ projectId });
  } catch (e) {
    console.error('Could not initialise the Admin SDK: ' + e.message);
    process.exit(1);
  }

  return { admin, db: admin.firestore(), projectId };
}

/**
 * Prove the credentials actually work before a script starts writing, so a
 * permissions problem surfaces as one clear line instead of a partial run.
 */
async function assertCredentials(db, projectId) {
  try {
    await db.collection('courses').limit(1).get();
  } catch (e) {
    console.error(
      `\nCould not read Firestore in project "${projectId}".\n` +
      `  ${e.message}\n\n` +
      'Authenticate with ONE of:\n' +
      '  a) A service account key (Firebase Console → Project settings →\n' +
      '     Service accounts → Generate new private key):\n' +
      '       export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json\n' +
      '  b) Your own Google account, if you have the gcloud CLI:\n' +
      '       gcloud auth application-default login\n'
    );
    process.exit(1);
  }
}

module.exports = { initAdmin, assertCredentials };
