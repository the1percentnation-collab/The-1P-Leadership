// The Rewrite Method — the in-course experience.
//
// Renders through the shared player (course-player.js) like every other course
// in the portal, with three tabs per week: Watch, Worksheet, Check-in. What is
// different here is the drip: a week is a locked card with an unlock date until
// enrolledAt + N*7 days, and the bonus module opens on the Week 6 review step
// instead of on a date.
//
// The lock states drawn here are cosmetic. The real boundary is in
// firestore.rules, which refuses to hand out `modules/{order}/content/main`
// — the video ids and worksheet URL — until the drip reaches that week. If the
// content load returns null, the week stays locked no matter what the UI says.

import { mountCoursePlayer, escPlayer as esc } from './course-player.js';
import { videoEmbedHtml } from './video-embed.js';
import { app, auth, firebaseReady } from './firebase.js';
import {
  MODULES, WEEK_MODULES, BONUS_ID, COPY, moduleById
} from './rewrite-course-data.js';
import {
  loadRewriteState, rewriteState, ensureDripStarted, isUnlocked, unlockLabel,
  checkinFor, completedWeekCount, submitCheckin, setReviewChoice,
  loadModuleContent, isBonusUnlocked
} from './rewrite-method.js';

// Week payloads, keyed by module id. Only unlocked weeks ever land here —
// a locked week's entry stays undefined because the rules said no.
const content = new Map();

let player = null;

// ─── Shared bits ──────────────────────────────────────────────────────────

function sectionLabel(text) {
  return `<div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">${esc(text)}</div>`;
}

function card(inner, { accent = false } = {}) {
  const border = accent ? '#E60306' : '#222';
  const bg = accent ? 'linear-gradient(135deg,#0A0000 0%,#1A0000 100%)' : '#111';
  return `<div style="background:${bg};border:1px solid ${border};border-radius:12px;padding:20px;">${inner}</div>`;
}

function lockedPanelHtml(mod) {
  const label = unlockLabel(mod.id);
  const isBonus = mod.id === BONUS_ID;
  const line = isBonus
    ? 'Finish Week 6 and answer the review step. Either answer opens this — the ask is an ask, not a paywall.'
    : COPY.lockedTooltip;
  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      ${card(`
        <div style="display:flex;gap:16px;align-items:flex-start;">
          <div style="font-size:26px;line-height:1;flex-shrink:0;">🔒</div>
          <div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;letter-spacing:0.5px;margin-bottom:6px;">${esc(label)}</div>
            <p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0;">${esc(line)}</p>
          </div>
        </div>`, { accent: true })}
      ${card(`
        ${sectionLabel("WHAT'S IN THIS WEEK")}
        <p style="color:#CCC;font-size:14px;line-height:1.7;margin:0 0 16px;">${esc(mod.welcome)}</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${mod.videos.map((v) => `
            <div style="display:flex;gap:12px;align-items:center;color:#888;font-size:13px;">
              <span style="color:#E60306;">▶</span>
              <span style="flex:1;">${esc(v.title)}</span>
              <span style="font-family:'Space Mono',monospace;font-size:11px;">${esc(v.runtime)}</span>
            </div>`).join('')}
          ${mod.worksheetLabel ? `
            <div style="display:flex;gap:12px;align-items:center;color:#888;font-size:13px;">
              <span style="color:#E60306;">📝</span>
              <span style="flex:1;">${esc(mod.worksheetLabel)}</span>
            </div>` : ''}
        </div>`)}
    </div>`;
}

// ─── Watch tab ────────────────────────────────────────────────────────────

function videoBlockHtml(mod, v, payload) {
  const live = (payload && Array.isArray(payload.videos))
    ? payload.videos.find((x) => x.id === v.id)
    : null;
  const embed = live && live.url ? videoEmbedHtml(live.url) : '';
  const body = embed || `
    <div style="background:#0D0D0D;border:1px dashed #2A2A2A;border-radius:10px;padding:30px 20px;text-align:center;">
      <div style="font-size:12px;color:#777;letter-spacing:1px;">FILMING — COMING SOON</div>
      <div style="font-size:12px;color:#555;margin-top:6px;">This video drops before your week does.</div>
    </div>`;
  return `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:10px;">
        <div style="font-size:14px;color:#fff;font-weight:600;">${esc(v.title)}</div>
        <div style="font-family:'Space Mono',monospace;font-size:11px;color:#777;flex-shrink:0;">${esc(v.runtime)}</div>
      </div>
      ${body}
    </div>`;
}

function watchTabHtml(mod) {
  if (!isUnlocked(mod.id)) return lockedPanelHtml(mod);
  const payload = content.get(mod.id) || null;
  return `
    <div style="display:flex;flex-direction:column;gap:24px;">
      ${card(`${sectionLabel('THIS WEEK')}<p style="color:#CCC;font-size:14px;line-height:1.7;margin:0;">${esc(mod.welcome)}</p>`)}
      <div style="display:flex;flex-direction:column;gap:22px;">
        ${mod.videos.map((v) => videoBlockHtml(mod, v, payload)).join('')}
      </div>
    </div>`;
}

// ─── Worksheet tab ────────────────────────────────────────────────────────

function worksheetTabHtml(mod) {
  if (!isUnlocked(mod.id)) return lockedPanelHtml(mod);
  if (!mod.worksheetLabel) {
    return card(`
      ${sectionLabel('NO WORKSHEET')}
      <p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0;">This one is watch-and-run. The protocol is in the video.</p>`);
  }
  const payload = content.get(mod.id) || null;
  const ws = payload && payload.worksheet ? payload.worksheet : null;
  const cta = ws && ws.url
    ? `<a href="${esc(ws.url)}" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;background:#E60306;
           color:#fff;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.5px;
           text-decoration:none;">Download the worksheet →</a>`
    : `<div style="display:inline-block;padding:13px 24px;background:#161616;border:1px dashed #2A2A2A;
         border-radius:8px;font-size:13px;color:#777;">Being typeset — coming soon</div>`;
  return card(`
    ${sectionLabel('YOUR WORKSHEET')}
    <div style="font-size:16px;color:#fff;font-weight:600;margin-bottom:8px;">${esc(mod.worksheetLabel)}</div>
    <p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0 0 18px;">Print it or write in it on screen. It belongs in your Manuscript either way.</p>
    ${cta}`);
}

// ─── Check-in tab ─────────────────────────────────────────────────────────

function fieldHtml(f, saved) {
  const val = saved && saved[f.key] != null ? String(saved[f.key]) : '';
  const req = f.required ? ' required' : '';
  const note = f.note
    ? `<div style="font-size:11px;color:#777;margin-top:6px;">${esc(f.note)}</div>` : '';
  const boxCss = 'width:100%;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;' +
    'color:#fff;padding:10px 12px;font-size:13px;line-height:1.5;font-family:inherit;box-sizing:border-box;';

  let input;
  if (f.type === 'textarea') {
    input = `<textarea data-key="${esc(f.key)}"${req}
      placeholder="${esc(f.placeholder || '')}"
      style="${boxCss}resize:vertical;min-height:90px;">${esc(val)}</textarea>`;
  } else if (f.type === 'number') {
    input = `<input type="number" data-key="${esc(f.key)}"${req}
      min="${esc(f.min ?? 0)}" max="${esc(f.max ?? 9999)}" value="${esc(val)}"
      style="${boxCss}max-width:160px;">`;
  } else if (f.type === 'file') {
    input = `<input type="file" data-key="${esc(f.key)}"${req}
      accept="${esc(f.accept || 'image/*')}"
      style="${boxCss}padding:9px 12px;">
      <div class="rw-upload-progress" style="display:none;font-size:11px;color:#E60306;margin-top:6px;"></div>`;
  } else {
    input = `<input type="text" data-key="${esc(f.key)}"${req}
      ${f.maxLength ? `maxlength="${esc(f.maxLength)}"` : ''}
      placeholder="${esc(f.placeholder || '')}" value="${esc(val)}"
      style="${boxCss}">`;
  }

  return `
    <div>
      <label style="display:block;font-size:12px;color:#DDD;margin-bottom:7px;font-weight:500;">
        ${esc(f.label)}${f.required ? '<span style="color:#E60306;"> *</span>' : ''}
      </label>
      ${input}
      ${note}
    </div>`;
}

function submittedHtml(mod, entry) {
  const when = entry && entry.submittedAt
    ? new Date(entry.submittedAt.seconds ? entry.submittedAt.seconds * 1000 : entry.submittedAt)
    : null;
  const rows = mod.checkin.fields.map((f) => {
    const raw = entry && entry.data ? entry.data[f.key] : null;
    if (raw == null || raw === '') return '';
    const body = f.type === 'file'
      ? `<a href="${esc(raw)}" target="_blank" rel="noopener" style="color:#E60306;">View your mark ↗</a>`
      : esc(String(raw));
    return `
      <div style="padding:12px 0;border-top:1px solid #1E1E1E;">
        <div style="font-size:11px;color:#777;margin-bottom:5px;">${esc(f.label)}</div>
        <div style="color:#DDD;font-size:14px;line-height:1.6;">${body}</div>
      </div>`;
  }).join('');

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      ${card(`
        <div style="color:#00AA00;font-size:13px;font-weight:600;margin-bottom:4px;">✓ Check-in submitted</div>
        <div style="font-size:12px;color:#777;">${when ? esc(when.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })) : ''}</div>
        ${rows}`)}
      ${card(`<p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0;">This is yours. Nobody else in the portal can read it.</p>`)}
    </div>`;
}

function reviewStepHtml(state) {
  if (state.reviewChoice) {
    return card(`
      ${sectionLabel('BONUS UNLOCKED')}
      <p style="color:#CCC;font-size:14px;line-height:1.7;margin:0;">${esc(COPY.completion)}</p>`, { accent: true });
  }
  return card(`
    ${sectionLabel('ONE LAST THING')}
    <p style="color:#E0E0E0;font-size:14px;line-height:1.7;margin:0 0 18px;">${esc(COPY.reviewAsk)}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <a href="${esc(COPY.bookUrl)}" target="_blank" rel="noopener" id="rw-review-open"
         style="padding:12px 20px;background:#E60306;color:#fff;border-radius:8px;font-size:13px;
           font-weight:600;text-decoration:none;">★ Leave an Amazon review →</a>
      <button type="button" class="rw-review" data-choice="left_review"
        style="padding:12px 20px;background:#161616;border:1px solid #2A2A2A;color:#fff;
          border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">I left a review</button>
      <button type="button" class="rw-review" data-choice="opted_out"
        style="padding:12px 20px;background:transparent;border:1px solid #2A2A2A;color:#AAA;
          border-radius:8px;font-size:13px;cursor:pointer;">Not right now</button>
    </div>
    <div class="rw-review-msg" style="font-size:12px;color:#777;margin-top:12px;"></div>`, { accent: true });
}

function checkinTabHtml(mod) {
  if (!isUnlocked(mod.id)) return lockedPanelHtml(mod);
  if (!mod.checkin) {
    return card(`
      ${sectionLabel('NO CHECK-IN')}
      <p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0;">The bonus module is a protocol, not an assignment. Run it when you need it.</p>`);
  }

  const state = rewriteState();
  const entry = checkinFor(mod.slug, state);
  const isFinal = mod.slug === 'week-6';

  if (entry) {
    return `
      <div style="display:flex;flex-direction:column;gap:20px;">
        ${submittedHtml(mod, entry)}
        ${isFinal ? reviewStepHtml(state) : ''}
      </div>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      ${card(`${sectionLabel('CHECK-IN')}<p style="color:#CCC;font-size:14px;line-height:1.7;margin:0;">${esc(mod.checkin.prompt)}</p>`)}
      ${card(`
        <form class="rw-checkin" data-week="${esc(mod.slug)}" style="display:flex;flex-direction:column;gap:18px;">
          ${mod.checkin.fields.map((f) => fieldHtml(f, null)).join('')}
          <div>
            <button type="submit" class="rw-submit"
              style="padding:13px 24px;background:#E60306;color:#fff;border:none;border-radius:8px;
                font-size:14px;font-weight:600;letter-spacing:0.5px;cursor:pointer;">
              ${isFinal ? 'Submit and finish →' : 'Submit check-in →'}
            </button>
            <div class="rw-msg" style="font-size:12px;color:#E60306;margin-top:10px;"></div>
          </div>
        </form>`)}
    </div>`;
}

// ─── Check-in submission ──────────────────────────────────────────────────

async function uploadMark(file) {
  if (!firebaseReady || !auth || !auth.currentUser) {
    throw new Error('Sign in to upload your photo.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('That photo is over 10MB. Try a smaller one.');
  }
  const { getStorage, ref, uploadBytes, getDownloadURL } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `users/${auth.currentUser.uid}/checkins/${Date.now()}-mark.${ext || 'jpg'}`;
  const r = ref(getStorage(app), path);
  await uploadBytes(r, file, { contentType: file.type });
  return await getDownloadURL(r);
}

function bindCheckin(root, mod) {
  const form = root.querySelector('.rw-checkin');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('.rw-submit');
      const msg = form.querySelector('.rw-msg');
      const fields = mod.checkin.fields;
      msg.textContent = '';
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Saving…';

      try {
        const data = {};
        for (const f of fields) {
          const el = form.querySelector(`[data-key="${f.key}"]`);
          if (!el) continue;
          if (f.type === 'file') {
            const file = el.files && el.files[0];
            if (!file) {
              if (f.required) throw new Error('Add a photo of your mark before submitting.');
              continue;
            }
            btn.textContent = 'Uploading…';
            data[f.key] = await uploadMark(file);
            btn.textContent = 'Saving…';
          } else if (f.type === 'number') {
            const n = Number(el.value);
            if (!Number.isFinite(n)) {
              if (f.required) throw new Error('Enter a number.');
              continue;
            }
            data[f.key] = n;
          } else {
            const v = el.value.trim();
            if (!v && f.required) throw new Error(`${f.label} is required.`);
            if (v) data[f.key] = v;
          }
        }

        await submitCheckin(mod.slug, data);
        if (player) player.render();
      } catch (err) {
        console.warn('[rewrite-course] check-in failed', err);
        btn.disabled = false;
        btn.textContent = original;
        msg.textContent = err.message || 'Could not save your check-in. Try again.';
      }
    });
  }

  root.querySelectorAll('.rw-review').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msg = root.querySelector('.rw-review-msg');
      root.querySelectorAll('.rw-review').forEach((b) => { b.disabled = true; });
      try {
        await setReviewChoice(btn.dataset.choice);
        await hydrateContent();
        if (player) player.render();
      } catch (err) {
        console.warn('[rewrite-course] review choice failed', err);
        root.querySelectorAll('.rw-review').forEach((b) => { b.disabled = false; });
        if (msg) msg.textContent = err.message || 'Could not save that. Try again.';
      }
    });
  });
}

// ─── Content hydration ────────────────────────────────────────────────────

// Fetches the paid payload for every week the member has actually reached.
// Locked weeks are never requested — the rules would refuse anyway, and a
// refusal logs noise in the console for something that is working correctly.
async function hydrateContent() {
  const unlocked = MODULES.filter((m) => isUnlocked(m.id) && !content.has(m.id));
  await Promise.all(unlocked.map(async (m) => {
    const payload = await loadModuleContent(m.id);
    if (payload) content.set(m.id, payload);
  }));
}

// ─── Sidebar footer ───────────────────────────────────────────────────────

function sidebarFooterHtml() {
  const state = rewriteState();
  const done = completedWeekCount(state);
  const total = WEEK_MODULES.length;
  return `
    <div style="font-size:11px;color:#777;line-height:1.6;">
      <div style="color:#E60306;letter-spacing:2px;font-weight:600;font-size:10px;margin-bottom:6px;">CHECK-INS</div>
      <div style="color:#DDD;font-size:13px;margin-bottom:8px;">${done} of ${total} submitted</div>
      ${state.isRewriter
        ? '<div style="color:#00AA00;font-size:12px;font-weight:600;">✓ Rewriter</div>'
        : `<div>${esc(COPY.subline)}</div>`}
    </div>`;
}

// ─── Public mount ─────────────────────────────────────────────────────────

export async function mount({ startAt } = {}) {
  // Opening the course is what starts the clock — not the purchase.
  // ensureDripStarted resolves with the anchor written, so by the time content
  // is fetched below, week 0 is already unlocked for a first-time opener.
  await ensureDripStarted();
  await loadRewriteState();
  await hydrateContent();

  player = mountCoursePlayer({
    brand: 'THE ONE PERCENT NATION',
    courseTitle: 'THE REWRITE METHOD',
    modules: MODULES.map((m) => {
      const open = isUnlocked(m.id);
      return {
        id: m.id,
        title: m.title,
        subtitle: m.subtitle,
        eyebrow: m.eyebrow,
        duration: m.duration,
        meta: open ? `${m.duration} · ${m.videoCount} video${m.videoCount > 1 ? 's' : ''}` : unlockLabel(m.id)
      };
    }),
    moduleHeaderHtml: (m) => {
      const mod = moduleById(m.id);
      if (isUnlocked(mod.id)) return '';
      return `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;
        background:#160000;border:1px solid #3A0000;border-radius:999px;color:#E60306;
        font-size:11px;font-weight:600;letter-spacing:1px;margin-top:10px;">🔒 ${esc(unlockLabel(mod.id).toUpperCase())}</div>`;
    },
    sidebarFooterHtml,
    tabs: [
      { id: 'watch', label: 'Watch', html: (m) => watchTabHtml(moduleById(m.id)) },
      { id: 'worksheet', label: 'Worksheet', html: (m) => worksheetTabHtml(moduleById(m.id)) },
      {
        id: 'checkin',
        label: 'Check-in',
        html: (m) => checkinTabHtml(moduleById(m.id)),
        bind: (root, m) => bindCheckin(root, moduleById(m.id))
      }
    ],
    labels: {
      complete: 'Next week →',
      completeLast: 'Finish →',
      completed: 'Next week →',
      completedLast: 'You have the pen'
    },
    progress: {
      // A week counts as done when its check-in is in — watching is not the
      // work. The bonus counts once the review step is answered.
      isComplete: (id) => {
        const mod = moduleById(id);
        if (!mod) return false;
        if (mod.id === BONUS_ID) return isBonusUnlocked();
        return !!checkinFor(mod.slug);
      },
      markComplete: async () => {},
      onNavigate: () => { hydrateContent().catch(() => {}); }
    },
    startAt: typeof startAt === 'number' && moduleById(startAt) ? startAt : 0
  });
}

export { MODULES };
