#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Publish an audiobook from one long MP3.
//
// Takes the single file a narration tool exports (ElevenLabs), cuts it into
// chapter tracks at the pauses between chapters, makes each a 64 kbps mono
// MP3, takes the cover (the config's coverImage, else the art embedded in
// the MP3), uploads it all to Storage under
// books/{bookId}/, writes books/{bookId} (format 'audio'), and creates the
// product that sells it. Run by .github/workflows/publish-audiobook.yml, so
// the owner never splits or uploads a chapter by hand.
//
// USAGE
//   cd scripts && npm ci
//   node publish-audiobook.js --config=audiobooks/i-cant.json \
//     --drive="https://drive.google.com/file/d/<id>/view"   (or --file=/path.mp3)
//
//   --publish        put the book and product live (default: hidden for a
//                    listen-through by an admin, product in draft)
//   --cuts="0:00:58, 0:06:10, ..."  hand-set chapter starts, after track 1,
//                    when a cut in the report needs moving
//   --dry-run        split and report only; nothing is written to Firebase
//   --relisten       ignore the config's verifiedCuts and find the chapters again
//   --no-listen      cut by pauses and word counts alone, without transcribing
//                    (only for a narration whose chapter pauses stand out)
//   --out=DIR        where the tracks are written (default: a temp dir)
//   --cover-only     just upload the config's coverImage, point the book and
//                    its product at it, and refresh the product's wording
//                    (summary, button, note); no MP3 needed, the audio, price
//                    and sale status are left alone
//
// The Drive file must be shared "Anyone with the link" while this runs; set
// it back to Restricted afterwards. Needs ffmpeg and ffprobe on PATH.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseSilences, chooseCuts, parseCutOverride, driveFileId, fmt, headingWindows, cutsByWords } = require('./lib/audiobook-split');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const flag = (name) => process.argv.includes(`--${name}`);
const DRY = flag('dry-run');
const PUBLISH = flag('publish');

const summary = [];
const note = (line = '') => { console.log(line); summary.push(line); };
function writeSummary() {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}
function fail(msg) {
  note(`\n**Stopped:** ${msg}`);
  writeSummary();
  process.exit(1);
}

function run(cmd, args, { capture = 'stdout' } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) fail(`${cmd} could not run: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.slice(0, 6).join(' ')} … exited ${r.status}\n${(r.stderr || '').slice(-1500)}`);
  return capture === 'stderr' ? r.stderr : r.stdout;
}

function probeDuration(file) {
  const d = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());
  if (!(d > 0)) fail(`could not read the length of ${path.basename(file)}`);
  return d;
}

// Drive's direct-download host serves a link-shared file to anyone. A file
// still set to Restricted comes back as an HTML sign-in page instead, which
// is caught here rather than fed to ffmpeg.
async function downloadFromDrive(link, dest) {
  const id = driveFileId(link);
  if (!id) fail('that does not look like a Google Drive file link.');
  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  console.log(`Downloading Drive file ${id} …`);
  const r = await fetch(url, { redirect: 'follow' });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || /text\/html/.test(type)) {
    fail('Google Drive would not hand over the file. In Drive, open Share on the MP3, set General access to "Anyone with the link", and run again.');
  }
  const out = fs.createWriteStream(dest);
  const reader = r.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (!out.write(value)) await new Promise((res) => out.once('drain', res));
  }
  await new Promise((res) => out.end(res));
  const head = fs.readFileSync(dest).subarray(0, 3);
  const isMp3 = head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (!isMp3) fail('the Drive file is not an MP3.');
  console.log(`  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

// Transcribe a few minutes either side of where each chapter should start,
// with a time for every word, so the cut can go right before its heading.
// Returns { track: [{ word, start, end }] }. AUDIOBOOK_TRANSCRIBER swaps in
// another script with the same arguments (tests use a stand-in, since the
// model cannot be downloaded everywhere).
function listenAround(src, words, duration, outDir) {
  const windows = headingWindows({ words, duration, span: Number(process.env.AUDIOBOOK_LISTEN_SPAN) || 240 });
  const winFile = path.join(outDir, 'windows.json');
  const heardFile = path.join(outDir, 'heard-words.json');
  fs.writeFileSync(winFile, JSON.stringify(windows.map((w) => [w.from, w.to])));
  const script = process.env.AUDIOBOOK_TRANSCRIBER || path.join(__dirname, 'transcribe-snippets.py');
  console.log(`Listening around ${windows.length} chapter starts …`);
  const r = spawnSync('python3', [script, src, winFile, heardFile, '--windows', '--model', process.env.AUDIOBOOK_STT_MODEL || 'base.en'],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) fail('could not transcribe around the chapter starts (speech model step failed; see the log above). Nothing was uploaded.');
  const lists = JSON.parse(fs.readFileSync(heardFile, 'utf8'));
  const heard = {};
  windows.forEach((w, j) => { heard[w.track] = lists[j] || []; });
  return heard;
}

// The cover goes to books/{id}/cover.jpg with a fresh download token, so the
// new URL is never served from an old cache (players, podcast apps, Stripe).
async function uploadCover(bucket, bucketName, id, file) {
  const token = crypto.randomUUID();
  const dest = `books/${id}/cover.jpg`;
  await bucket.upload(file, { destination: dest, metadata: { contentType: 'image/jpeg', metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
}

async function connect() {
  const { initAdmin, assertCredentials } = require('./lib/init');
  const { admin, db, projectId } = initAdmin();
  await assertCredentials(db, projectId);
  const bucketName = process.env.STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  return { admin, db, bucketName, bucket: admin.storage().bucket(bucketName) };
}

async function coverOnly(cfg, coverFile) {
  if (!coverFile) fail('the config has no coverImage, or the file is missing.');
  const { admin, db, bucket, bucketName } = await connect();
  const id = cfg.bookId;
  const bookRef = db.collection('books').doc(id);
  if (!(await bookRef.get()).exists) fail(`books/${id} does not exist yet. Publish the audiobook first.`);
  const coverUrl = await uploadCover(bucket, bucketName, id, coverFile);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await bookRef.set({ coverUrl, updatedAt: now }, { merge: true });
  const prods = await db.collection('products').where('grantsBooks', 'array-contains', id).get();
  const p = cfg.product || {};
  const wording = {
    ...(p.summary ? { summary: p.summary } : {}),
    ...(p.pageCta ? { pageCta: p.pageCta } : {}),
    ...(p.pageNote ? { pageNote: p.pageNote } : {})
  };
  for (const d of prods.docs) await d.ref.set({ imageUrl: coverUrl, ...wording, updatedAt: now }, { merge: true });
  note(`## ${cfg.title}`);
  note(`**Cover updated** from ${path.basename(coverFile)} on books/${id}${prods.size ? ` and ${prods.docs.map((d) => `products/${d.id}`).join(', ')}` : ''}.`);
  if (prods.size && Object.keys(wording).length) note(`Store wording refreshed: ${Object.keys(wording).join(', ')}.`);
  note('The audio, price and sale status were not touched.');
  writeSummary();
}

async function main() {
  const cfgPath = arg('config');
  if (!cfgPath) fail('pass --config=audiobooks/<book>.json');
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, cfgPath), 'utf8'));
  // A cover kept in the repo beats whatever art the narration tool embedded.
  const coverFile = cfg.coverImage ? path.resolve(__dirname, cfg.coverImage) : null;
  const hasCoverFile = !!coverFile && fs.existsSync(coverFile);
  if (flag('cover-only')) return coverOnly(cfg, hasCoverFile ? coverFile : null);
  const words = cfg.tracks.map((t) => t.words);
  const outDir = arg('out') || fs.mkdtempSync(path.join(os.tmpdir(), 'audiobook-'));
  fs.mkdirSync(outDir, { recursive: true });

  // ── The source file ──
  let src = arg('file');
  if (!src) {
    if (!arg('drive')) fail('pass --drive=<Google Drive link> or --file=<path to the MP3>');
    src = path.join(outDir, 'source.mp3');
    await downloadFromDrive(arg('drive'), src);
  }
  const duration = probeDuration(src);

  // ── Where the chapters start ──
  // Chapter starts already confirmed for this recording (the config's
  // verifiedCuts) beat listening again: the speech model can hear a little
  // differently on another machine. They apply only while the source is the
  // same length, so a new export is listened to afresh. --relisten ignores them.
  const saved = cfg.verifiedCuts && !flag('relisten') && Math.abs(Number(cfg.verifiedCuts.sourceSeconds) - duration) <= 2
    ? cfg.verifiedCuts.cuts : null;
  const override = parseCutOverride(arg('cuts') || saved, { tracks: words.length, duration });
  let cuts = override;
  let how = arg('cuts') ? 'Chapter starts set by hand.' : 'Chapter starts from the times already confirmed for this recording.';
  if (!cuts) {
    const silences = parseSilences(run('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', 'silencedetect=noise=-40dB:d=0.6', '-f', 'null', '-'], { capture: 'stderr' }));
    if (flag('no-listen')) {
      cuts = chooseCuts({ words, duration, silences });
      how = 'Chapter starts placed by pauses and word counts alone.';
    } else {
      cuts = cutsByWords({ titles: cfg.tracks.map((t) => t.title), words, duration, silences, heardWords: listenAround(src, words, duration, outDir) });
      how = 'Chapter starts found where the narrator says each heading.';
    }
  }

  note(`## ${cfg.title}`);
  note(`Source: ${fmt(duration)} long. ${how}`);
  note('');
  note('| # | Track | Starts at | Length | Check |');
  note('|---|---|---|---|---|');

  // ── Cut, shrink, tag ──
  const tracks = [];
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i].at;
    const end = i + 1 < cuts.length ? cuts[i + 1].at : duration;
    const file = path.join(outDir, `audio-${String(i + 1).padStart(2, '0')}.mp3`);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(end - start), '-i', src,
      '-map', '0:a', '-ac', '1', '-ar', '44100', '-b:a', '64k', '-map_metadata', '-1', '-id3v2_version', '3',
      '-metadata', `title=${cfg.tracks[i].title}`, '-metadata', `album=${cfg.title}`, '-metadata', `artist=${cfg.author}`,
      '-metadata', `track=${i + 1}/${cuts.length}`, file]);
    const len = probeDuration(file);
    tracks.push({ title: cfg.tracks[i].title, file, duration: Math.round(len), size: fs.statSync(file).size });
    const c = cuts[i];
    // A length far from what the word count predicts means a cut is off.
    const predicted = duration * (words[i] / words.reduce((a, b) => a + b, 0));
    const odd = len < predicted * 0.6 || len > predicted * 1.6;
    let check;
    if (i === 0 || override) check = '';
    else if (c.by === 'heard') check = `heard “${String(c.heard).slice(0, 48)}${String(c.heard).length > 48 ? '…' : ''}”`;
    else if (c.by === 'pause') check = `listen: heading not heard${c.near ? ` (said here: “${c.near.slice(0, 90)}”)` : ''}`;
    else check = c.confidence === 0 ? 'listen: no clear pause nearby'
      : (c.confidence != null && c.confidence < 1.25 ? 'listen: a similar pause is close by' : 'ok');
    if (odd && i) check += `${check ? '; ' : ''}listen: length looks off (expected about ${fmt(predicted)})`;
    note(`| ${i + 1} | ${cfg.tracks[i].title} | ${fmt(start)} | ${fmt(len)} | ${check} |`);
  }

  // ── Cover: the config's image, else the art embedded in the source ──
  let cover = hasCoverFile ? coverFile : path.join(outDir, 'cover.jpg');
  let hasCover = hasCoverFile;
  if (!hasCover) {
    const art = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-an', '-frames:v', '1', '-q:v', '2', cover]);
    hasCover = art.status === 0 && fs.existsSync(cover) && fs.statSync(cover).size > 1000;
  }
  note('');
  note(hasCoverFile ? `Cover art: ${path.basename(coverFile)}.`
    : hasCover ? 'Cover art: taken from the MP3.' : 'Cover art: none in the MP3; the book keeps its current cover.');
  note(`Tracks written to ${outDir}`);

  if (DRY) {
    note('\nDry run: nothing was uploaded.');
    writeSummary();
    return;
  }

  // ── Upload and publish ──
  const { admin, db, bucket, bucketName } = await connect();
  const id = cfg.bookId;

  const stored = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const dest = `books/${id}/audio-${String(i + 1).padStart(2, '0')}.mp3`;
    console.log(`Uploading ${dest} …`);
    await bucket.upload(t.file, { destination: dest, resumable: true, metadata: { contentType: 'audio/mpeg', cacheControl: 'private, max-age=0' } });
    stored.push({ title: t.title, path: dest, duration: t.duration, size: t.size });
  }
  const book = {
    title: cfg.title,
    author: cfg.author,
    format: 'audio',
    status: PUBLISH ? 'live' : 'hidden',
    openAccess: false,
    description: cfg.description,
    sampleTrack: Number.isInteger(cfg.sampleTrack) ? cfg.sampleTrack : null,
    buyHref: `/listen?book=${id}`,
    tracks: stored,
    version: String(Date.now()),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (hasCover) book.coverUrl = await uploadCover(bucket, bucketName, id, cover);
  const bookRef = db.collection('books').doc(id);
  const existed = (await bookRef.get()).exists;
  await bookRef.set({ ...book, ...(existed ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }) }, { merge: true });

  // The product that sells it: reuse one already unlocking this book.
  const prodSnap = await db.collection('products').where('grantsBooks', 'array-contains', id).limit(1).get();
  const prod = {
    name: cfg.product.name,
    type: 'book',
    status: PUBLISH ? 'live' : 'planned',
    summary: cfg.product.summary,
    description: cfg.description,
    price: cfg.product.price,
    sellable: true,
    requiresShipping: false,
    grantsBooks: [id],
    showOnSite: true,
    showInDashboard: true,
    // Its own page: the /books shop and the member Store send people to the
    // audiobook page, which plays the free chapter before the buy button.
    pageUrl: `/listen?book=${id}`,
    pageCta: cfg.product.pageCta || 'Listen free',
    pageNote: cfg.product.pageNote || null,
    sortOrder: Number.isFinite(cfg.product.sortOrder) ? cfg.product.sortOrder : 0,
    ...(book.coverUrl ? { imageUrl: book.coverUrl } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  let productId;
  if (prodSnap.empty) {
    const ref = await db.collection('products').add({
      ...prod, slug: null, inventory: null, preorderMode: 'interest', depositAmount: null,
      launchDate: null, salePrice: null, saleEndsAt: null, externalUrl: null, videoUrl: null, posterUrl: null,
      interestCount: 0, preorderCount: 0, depositTotal: 0, launchNotifiedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    productId = ref.id;
  } else {
    productId = prodSnap.docs[0].id;
    await prodSnap.docs[0].ref.set(prod, { merge: true });
  }

  note('');
  note(PUBLISH
    ? `**Live.** The audiobook and its $${cfg.product.price} product are on sale: https://the1pnation.com/listen?book=${id}`
    : `**Uploaded for a listen-through.** Admins can play it now at https://the1pnation.com/listen?book=${id}. Run again with Publish ticked to put it on sale.`);
  note(`Book: books/${id} · Product: products/${productId}`);
  writeSummary();
}

main().catch((e) => fail(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : String(e)));
