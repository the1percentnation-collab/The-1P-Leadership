#!/usr/bin/env bash
#
# Deploys the "default" Cloud Functions codebase, and says which kind of
# failure happened when one does.
#
# WHY A WRAPPER AT ALL
# --------------------
# `firebase deploy` exits 1 for two very different situations, and the fix for
# each is nothing like the fix for the other:
#
#   - It died before deploying anything — bad credentials, billing off, a
#     syntax error in functions/. Nothing shipped.
#   - It deployed, and specific named functions failed. Everything else DID
#     ship, so the blast radius is those names and no more.
#
# This reads the CLI's own end-of-run summary to tell them apart and prints the
# matching ::error::, because a deploy log is read by someone who needs to know
# whether production is half-updated.
#
# HISTORY (do not re-learn this the hard way)
# -------------------------------------------
# Between June and September 2026 this script also carried a tolerance list.
# Three scheduled functions — appointmentReminders, taskReminders and
# automationTick — had been removed from source while their Cloud Scheduler
# jobs stayed behind in the project. Firebase saw functions that existed in
# GCP but not in the code, tried to delete them on every run, and this
# project's deploy service account lacks cloudscheduler.jobs.delete, so the
# delete was refused and the deploy exited non-zero after successfully
# shipping every real function. Every backend deploy from 2026-06-14 onward
# was red for that reason alone, which is its own kind of outage: a pipeline
# that is always red reports nothing.
#
# The list made those three names non-fatal. All three were deleted from GCP
# in September 2026 and the list went with them, so this script is strict
# again — any function the CLI names now fails the build.
#
# The trap that created them is still open: this project can create a
# scheduled function but not its Cloud Scheduler job, and then cannot delete
# either, so exporting one is a one-way door and un-exporting it does not
# undo it. tests/no-scheduled-functions.test.cjs fails the build if anyone
# adds one, and .github/workflows/firebase-deploy-backend.yml runs that test
# before this script. Leave both in place. Time-based work belongs in
# runAutomationTick, the HTTP function .github/workflows/crm-tick.yml calls.

set -uo pipefail

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

npx --yes firebase-tools deploy \
  --only functions \
  --project the-1p-leadership \
  --non-interactive \
  --force 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}

if [ "$status" -eq 0 ]; then
  exit 0
fi

# The CLI ends a partially-failed run with:
#
#   Functions deploy had errors with the following functions:
#   <tab>someFunction(us-central1)
#   <tab>anotherFunction(us-central1)
#
# Collect those names, stopping at the first line that isn't one (the block is
# followed directly by "Function URL (...)" lines, with no blank line between).
failed=$(
  sed -e 's/\x1b\[[0-9;]*m//g' "$LOG" | awk '
    /Functions deploy had errors with the following functions:/ { collecting = 1; next }
    collecting {
      if ($0 ~ /^[[:space:]]+[A-Za-z0-9_]+\([a-z0-9-]+\)[[:space:]]*$/) {
        name = $0
        gsub(/^[[:space:]]+/, "", name)
        sub(/\(.*$/, "", name)
        print name
      } else {
        collecting = 0
      }
    }' | sort -u | tr '\n' ' '
)
failed="$(echo "$failed" | xargs || true)"

# No summary block means the run died before deploying anything — a real
# failure (bad credentials, billing disabled, a syntax error in source).
if [ -z "$failed" ]; then
  echo "::error::Cloud Functions deploy failed. Rules and indexes in the previous step DID deploy. Functions v2 require the Blaze plan — a 403 mentioning 'requires billing to be enabled' on secretmanager.googleapis.com means billing is off for the-1p-leadership. See AUTH_SETUP.md step 1."
  exit 1
fi

echo "::error::Cloud Functions deploy failed on ${failed}. Rules and indexes in the previous step DID deploy, as did every function not named here. If this mentions 'requires billing to be enabled' on secretmanager.googleapis.com, billing is off for the-1p-leadership — see AUTH_SETUP.md step 1."
exit 1
