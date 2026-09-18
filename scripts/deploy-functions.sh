#!/usr/bin/env bash
#
# Deploys the "default" Cloud Functions codebase, and distinguishes a real
# deploy failure from the one stale condition this project is stuck in.
#
# THE SITUATION
# -------------
# taskReminders and appointmentReminders are deployed in the project but are
# not in source. They were un-exported because the CI service account lacks the
# Cloud Scheduler Admin role, and their source has since been deleted outright:
# runAutomationTick's sendReminders() does the same work against the same
# remindedAt dedupe, so re-exporting them would put two senders in a race on a
# read-then-write flag.
#
# That leaves one problem. Firebase sees two functions that exist in the
# project but not in source, tries to delete them, and the very same missing
# permission rejects the delete. So every deploy since 2026-06-14 has exited
# non-zero AFTER successfully deploying every real function. A pipeline that is
# always red reports nothing: a genuine failure looks exactly like the last
# three months of noise.
#
# WHAT THIS DOES
# --------------
# Runs the same deploy, then reads the CLI's own end-of-run summary. If the
# only functions that errored are the two known stranded ones, it says so and
# exits clean. Anything else — including a third function getting stranded the
# same way — still fails the build.
#
# THE REAL FIX, AND HOW TO FINISH IT
# ----------------------------------
# Grant the deploy service account roles/cloudscheduler.admin in GCP IAM:
#
#   gcloud projects add-iam-policy-binding the-1p-leadership \
#     --member="serviceAccount:<the CI deploy service account>" \
#     --role="roles/cloudscheduler.admin"
#
# The next deploy then succeeds in deleting both functions, and they stop
# running the June 2026 code they were last deployed with. Confirm that in the
# deploy log, then empty KNOWN_STRANDED below and delete the ::warning:: at the
# end of this script.
#
# Do it in that order. Emptying the list before the grant lands just turns
# every deploy red again, because the delete still fails.

set -uo pipefail

# Deployed-but-unexported functions we knowingly cannot clean up yet. Keep this
# list minimal: every name here is a function whose failure we stop reporting.
# Empty it once the IAM grant above has let a deploy delete these two.
KNOWN_STRANDED="appointmentReminders taskReminders"

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
#   <tab>appointmentReminders(us-central1)
#   <tab>taskReminders(us-central1)
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

for name in $failed; do
  case " $KNOWN_STRANDED " in
    *" $name "*) ;;
    *)
      echo "::error::Cloud Functions deploy failed on ${failed}. Rules and indexes in the previous step DID deploy. If this mentions 'requires billing to be enabled' on secretmanager.googleapis.com, billing is off for the-1p-leadership — see AUTH_SETUP.md step 1."
      exit 1
      ;;
  esac
done

echo "::warning::Every function deployed. Firebase could not clean up ${failed} — deployed-but-unexported scheduled functions the CI service account lacks cloudscheduler.jobs.delete permission to remove. Grant roles/cloudscheduler.admin to the deploy service account to resolve this permanently; see scripts/deploy-functions.sh."
exit 0
