# social/

Everything in this folder is copied to Google Drive automatically, under
**Social Media - Ready to Post**, keeping these folder names. The copy runs
on every push to `main` that touches this folder
(`.github/workflows/drive-sync.yml`, `scripts/drive-sync.mjs`).

- One folder per campaign, dated: `2026-10 Membership Launch/`.
- `name.gsheet.csv` becomes a Google Sheet, `name.gdoc.html` a Google Doc.
- A changed file is updated in place, so its Drive link stays the same.
- Deleting a file here does not delete it from Drive.

Nothing here is deployed to the website.
