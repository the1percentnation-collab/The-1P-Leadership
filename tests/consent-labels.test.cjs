// Three pages are declared SMS opt-in points in the 10DLC campaign filing.
// Every other page with a phone field is callback-only. This test holds the
// site to that declaration:
//   - each opt-in page carries both consent labels byte-identical to the
//     shared constant, as real checkbox inputs, unchecked, not required;
//   - no callback-only page carries a checkbox label with SMS language.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, 'public', rel), 'utf8');

let fails = 0;
const t = (name, cond, detail) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '\n       ' + detail));
  if (!cond) fails++;
};

(async () => {
  const labels = await import(pathToFileURL(path.join(root, 'public', 'js', 'consent-labels.js')).href);
  const { SMS_CONSENT_LABEL_HTML, MARKETING_CONSENT_LABEL_HTML, OPT_IN_PAGES } = labels;

  // The constant itself must match /webinar, the canonical copy.
  const webinar = read('webinar.html');
  t('constant SMS label equals the /webinar label', webinar.includes(`<span class="consent-text">${SMS_CONSENT_LABEL_HTML}</span>`));
  t('constant marketing label equals the /webinar label', webinar.includes(`<span class="consent-text">${MARKETING_CONSENT_LABEL_HTML}</span>`));

  // ── Opt-in pages ──
  for (const { page, sms, marketing } of OPT_IN_PAGES) {
    const html = read(page);
    const labelFor = (id) => {
      const m = html.match(new RegExp(`<label class="consent-item" for="${id}">[\\s\\S]*?<span class="consent-text">([\\s\\S]*?)</span>\\s*</label>`));
      return m ? m[1] : null;
    };
    const inputFor = (id) => {
      const m = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      return m ? m[0] : '';
    };
    const smsLabel = labelFor(sms), mktLabel = labelFor(marketing);
    t(`/${page}: SMS label byte-identical to the constant`, smsLabel === SMS_CONSENT_LABEL_HTML, smsLabel === null ? 'label not found' : 'got: ' + smsLabel);
    t(`/${page}: marketing label byte-identical to the constant`, mktLabel === MARKETING_CONSENT_LABEL_HTML, mktLabel === null ? 'label not found' : 'got: ' + mktLabel);
    for (const id of [sms, marketing]) {
      const input = inputFor(id);
      t(`/${page}: #${id} is a real checkbox input`, /type="checkbox"/.test(input), input || 'not found');
      t(`/${page}: #${id} is not pre-checked`, !/\bchecked\b/.test(input), input);
      t(`/${page}: #${id} is not required`, !/\brequired\b/.test(input), input);
    }
  }

  // ── Callback-only pages: no SMS language on any checkbox label ──
  const SMS_WORDS = /\btext\b|\bSMS\b|\bSTOP\b|\bHELP\b|frequency may vary|data rates/;
  for (const page of ['index.html', 'contact-us.html', 'book.html', 'matrix.html', 'class.html']) {
    const html = read(page);
    // Every label that wraps or follows a checkbox, plus the styled-div
    // consent pattern the class pages used.
    const labels = [];
    for (const m of html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)) {
      if (/type="checkbox"|consent-box/.test(m[0])) labels.push(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
    for (const m of html.matchAll(/<p class="consent-text">([\s\S]*?)<\/p>/g)) {
      labels.push(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
    const offending = labels.filter((l) => SMS_WORDS.test(l));
    t(`/${page}: no checkbox label carries SMS language (${labels.length} label(s) checked)`,
      offending.length === 0, offending.map((o) => '"' + o + '"').join(' | '));
    t(`/${page}: no data-consent SMS toggles remain`, !/data-consent="sms"/.test(html));
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
