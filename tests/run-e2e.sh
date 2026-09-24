#!/usr/bin/env bash
# Runs an emulator e2e: `tests/run-e2e.sh purchase`, `reader` or `notify`
# (the reader one needs READER_E2E_EPUB=/path/to/sample.epub).
# The Functions emulator needs fake secrets and an email provider it can
# reach; both files are gitignored and removed afterwards.
set -euo pipefail
WHICH="${1:-purchase}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -d functions/node_modules ] || (cd functions && npm ci)
cleanup() { rm -f functions/.env.local functions/.secret.local; }
trap cleanup EXIT
cat > functions/.env.local <<ENV
EMAIL_PROVIDER=telnyx
TELNYX_API_KEY=KEYe2efake
TELNYX_API_BASE=http://127.0.0.1:8766/v2
CRM_TICK_SECRET=e2e-tick-secret
ENV
cat > functions/.secret.local <<SEC
STRIPE_SECRET_KEY=sk_test_fake
STRIPE_WEBHOOK_SECRET=whsec_e2e_fake
SENDGRID_API_KEY=SG.fake
SEC
tests/node_modules/.bin/firebase emulators:exec --only auth,firestore,storage,functions \
  --project demo-1p "node tests/${WHICH}-e2e.test.mjs"
