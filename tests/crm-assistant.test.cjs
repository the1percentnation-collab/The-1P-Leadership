// Pin the CRM assistant's guardrails against the real shipped code in
// functions/index.js.
//
// The assertions that matter here are the containment ones. This feature hands
// an LLM a query surface over every contact record in a company, so the tests
// that earn their keep are the ones proving it cannot reach outside that
// company, cannot count rows and call it a total, and cannot write anything
// without a human approving it first.
//
// Run: node tests/crm-assistant.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

// The assistant block, start to end, as shipped.
const blockStart = SRC.indexOf('// CRM assistant — admin-only, company-scoped, tool-using.');
const blockEnd = SRC.indexOf('exports.crmAssistantRevert');
assert.ok(blockStart > 0 && blockEnd > blockStart, 'could not locate the CRM assistant block');
const BLOCK_RAW = SRC.slice(blockStart, SRC.indexOf('\n});', blockEnd) + 4);
// Comments explain WHY collectionGroup and isAdminCaller are banned here, so
// the bans have to be asserted against code with the prose stripped out —
// otherwise the explanation trips the check it is explaining.
const BLOCK = BLOCK_RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// Pure helpers, extracted and run for real.
const helpersStart = SRC.indexOf('function daysAgoTs(days)');
const helpersEnd = SRC.indexOf('// ── Tool schemas');
assert.ok(helpersStart > 0 && helpersEnd > helpersStart, 'could not locate the assistant helpers');
const schemaStart = SRC.indexOf('const CRM_READ_TOOLS = [');
const schemaEnd = SRC.indexOf('// ── Tool executors');
// Anchored on the declaration, not the value, so swapping the model does not
// silently slice the sandbox to nothing.
const constStart = SRC.indexOf('const CRM_MODEL = ');
assert.ok(constStart > 0, 'could not locate CRM_MODEL');

const sandboxSrc = SRC.slice(constStart, helpersEnd) + SRC.slice(schemaStart, schemaEnd);
const fakeAdmin = {
  firestore: Object.assign(
    () => ({}),
    {
      Timestamp: {
        fromMillis: (m) => ({ toMillis: () => m, _ms: m }),
        now: () => ({ toMillis: () => Date.now() })
      },
      FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'DEL' }
    }
  )
};
const sandbox = new Function('admin', 'Date', 'Math', 'Number', 'JSON', 'Object', 'Array', `
  ${sandboxSrc}
  return { clampInt, snip, freshnessId, daysSince, contactRow, envelope,
           CRM_READ_TOOLS, CRM_WRITE_TOOL, CRM_MAX_ROWS_PER_TOOL, CRM_FETCH_CAP,
           CRM_STAGES, CRM_MODEL, CRM_MAX_ITERATIONS, CRM_STAGE_WRITES_ENABLED };
`)(fakeAdmin, Date, Math, Number, JSON, Object, Array);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// ── Containment ─────────────────────────────────────────────────────────────
console.log('company containment');

ok('no tool schema accepts a companyId, path or tenant argument', () => {
  const all = [...sandbox.CRM_READ_TOOLS, sandbox.CRM_WRITE_TOOL];
  for (const t of all) {
    const props = Object.keys((t.input_schema && t.input_schema.properties) || {});
    for (const bad of ['companyId', 'company', 'tenant', 'path', 'collection', 'db']) {
      assert.ok(!props.includes(bad), `${t.name} exposes "${bad}" to the model`);
    }
  }
});

ok('every tool schema forbids extra properties', () => {
  [...sandbox.CRM_READ_TOOLS, sandbox.CRM_WRITE_TOOL].forEach((t) => {
    assert.strictEqual(t.input_schema.additionalProperties, false, `${t.name} allows extra properties`);
  });
});

ok('no executor reaches for collectionGroup', () => {
  // activities/notes/emails/messages/calls carry no companyId field, so a
  // collection-group query over them is an unfilterable cross-tenant read.
  assert.ok(!/collectionGroup/.test(BLOCK), 'the assistant block contains a collectionGroup query');
});

ok('executors are scoped and never take db', () => {
  const sigs = BLOCK.match(/async function exec\w+\([^)]*\)/g) || [];
  assert.ok(sigs.length >= 6, `expected the six executors, found ${sigs.length}`);
  sigs.forEach((sig) => {
    assert.ok(/\(scope,/.test(sig), `${sig} does not take scope first`);
    assert.ok(!/\bdb\b/.test(sig), `${sig} takes db, which breaks containment`);
  });
});

ok('the chat callable authorizes with assertCompanyAdmin, not isAdminCaller', () => {
  const chat = BLOCK.slice(BLOCK.indexOf('exports.crmAssistantChat'));
  assert.ok(/assertCompanyAdmin\(db, companyId, request\)/.test(chat), 'assertCompanyAdmin is not called');
  assert.ok(!/isAdminCaller/.test(chat),
    'isAdminCaller is true for a platform admin of ANY company and returns no companyId');
});

ok('client history is stripped of tool blocks before replay', () => {
  const fnStart = SRC.indexOf('function sanitizeHistory');
  const fn = SRC.slice(fnStart, SRC.indexOf('\n}', fnStart));
  assert.ok(/b\.type === 'text'/.test(fn), 'history is not filtered down to text blocks');
});

// ── Honesty ─────────────────────────────────────────────────────────────────
console.log('reporting honesty');

ok('every row result carries truncation metadata even when complete', () => {
  const e = sandbox.envelope([{ contactId: 'a' }], { scanned: 1, matchedAtLeast: 1 });
  ['returned', 'scanned', 'truncated', 'truncationNote'].forEach((k) => {
    assert.ok(k in e, `envelope is missing ${k}`);
  });
  assert.strictEqual(e.truncated, false);
});

ok('a capped list reports a floor, not a count', () => {
  const rows = new Array(50).fill({ contactId: 'x' });
  const e = sandbox.envelope(rows, { scanned: 300, matchedAtLeast: 412 });
  assert.strictEqual(e.truncated, true);
  assert.match(e.truncationNote, /at least 412/);
});

ok('hitting the fetch cap counts as truncated even when the filtered set fits', () => {
  // The post-filter count can sit inside the limit while the query that
  // produced it still stopped at the cap. Reporting that as complete is the
  // confident under-report the envelope exists to prevent.
  const e = sandbox.envelope([{ contactId: 'a' }, { contactId: 'b' }], {
    scanned: sandbox.CRM_FETCH_CAP, matchedAtLeast: 2
  });
  assert.strictEqual(e.truncated, true);
});

ok('the out-of-budget notice never creates two consecutive user turns', () => {
  const fn = new Function('BUDGET_NOTICE', 'Array', `
    ${SRC.slice(SRC.indexOf('function withBudgetNotice'), SRC.indexOf('function sanitizeHistory'))}
    return withBudgetNotice;
  `)('NOTICE', Array);
  const withToolResults = fn([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] }
  ]);
  assert.strictEqual(withToolResults.length, 3, 'a fourth message was appended beside a user turn');
  assert.strictEqual(withToolResults[2].content.length, 2);
  const afterAssistant = fn([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'x' }] }
  ]);
  assert.strictEqual(afterAssistant.length, 3);
  assert.strictEqual(afterAssistant[2].role, 'user');
});

ok('the aggregate tools promise numbers, the row tool promises rows', () => {
  const find = sandbox.CRM_READ_TOOLS.find((t) => t.name === 'crm_find_contacts');
  const snap = sandbox.CRM_READ_TOOLS.find((t) => t.name === 'crm_pipeline_snapshot');
  assert.match(find.description, /do not count these rows/i);
  assert.match(snap.description, /NUMBERS ONLY/);
});

ok('outreach metrics warn that they count contacts, not messages', () => {
  const t = sandbox.CRM_READ_TOOLS.find((t) => t.name === 'crm_outreach_metrics');
  assert.match(t.description, /DISTINCT CONTACTS TOUCHED/);
});

// ── Write safety ────────────────────────────────────────────────────────────
console.log('write safety');

ok('the write tool says plainly that it applies nothing', () => {
  assert.match(sandbox.CRM_WRITE_TOOL.description, /DOES NOT APPLY ANYTHING/);
  assert.match(sandbox.CRM_WRITE_TOOL.description, /admin clicks Apply/i);
});

ok('the write tool cannot delete, email or text', () => {
  const props = Object.keys(sandbox.CRM_WRITE_TOOL.input_schema.properties);
  ['deleteContacts', 'sendEmail', 'sendSms', 'updateFields', 'assignOwner'].forEach((bad) => {
    assert.ok(!props.includes(bad), `write tool exposes ${bad}`);
  });
  assert.deepStrictEqual(props.sort(), ['createTasks', 'rationale', 'stageChanges', 'summary', 'tagChanges']);
});

ok('stage writes are shadowed by default', () => {
  // A stage change fires autoEnroll, which sends real email and SMS. Until
  // that is proven safe on real proposals, stage items stage but never apply.
  assert.strictEqual(sandbox.CRM_STAGE_WRITES_ENABLED, false);
  assert.ok(/status: 'shadowed'/.test(BLOCK), 'the apply path does not shadow stage items');
});

ok('a staged plan can only touch contacts the model actually retrieved', () => {
  assert.ok(/ctx\.seenContacts\.has\(id\)/.test(BLOCK),
    'propose_crm_changes does not check contacts against what was retrieved');
});

ok('apply claims the plan in a transaction before doing anything', () => {
  const apply = SRC.slice(SRC.indexOf('exports.crmAssistantApply'));
  assert.ok(/runTransaction/.test(apply.slice(0, 3000)), 'no transactional claim on the plan');
  assert.ok(/'applying'/.test(apply), 'no applying state to gate double-clicks');
  assert.ok(/expired/.test(apply), 'expiry is not enforced at apply time');
});

ok('apply re-verifies admin rights rather than trusting the staged plan', () => {
  const apply = SRC.slice(SRC.indexOf('exports.crmAssistantApply'), SRC.indexOf('exports.crmAssistantRevert'));
  assert.ok(/assertCompanyAdmin\(db, companyId, request\)/.test(apply));
});

ok('applied changes are attributed to the approving human, not to "system"', () => {
  const apply = SRC.slice(SRC.indexOf('exports.crmAssistantApply'), SRC.indexOf('exports.crmAssistantRevert'));
  assert.ok(/actorUid: uid/.test(apply), 'activities are not attributed to the approving admin');
  assert.ok(/via CRM Assistant/.test(apply), 'the AI involvement is not visible in the timeline');
  assert.ok(/userPrompt/.test(apply), 'the originating prompt is not recorded');
});

ok('the daily budget fails closed', () => {
  const apply = SRC.slice(SRC.indexOf('exports.crmAssistantApply'), SRC.indexOf('exports.crmAssistantRevert'));
  assert.ok(/resource-exhausted/.test(apply), 'no daily cap');
  assert.ok(/nothing was applied/.test(apply), 'budget failure does not abort the apply');
});

ok('revert restores tags by inverse delta, not by overwriting the snapshot', () => {
  const rev = SRC.slice(SRC.indexOf('exports.crmAssistantRevert'));
  assert.ok(/Inverse delta/.test(rev), 'revert overwrites tags and would clobber concurrent edits');
});

ok('revert is honest that sent mail cannot be recalled', () => {
  const rev = SRC.slice(SRC.indexOf('exports.crmAssistantRevert'));
  assert.match(rev, /cannot be recalled/);
});

ok('the sequence trigger honours the suppression flag', () => {
  const trig = SRC.slice(SRC.indexOf('exports.onContactWrittenForSequences'));
  assert.ok(/_automationSuppressed === true/.test(trig.slice(0, 2000)),
    'bulk changes cannot suppress sequence auto-enrolment');
});

// ── Loop control ────────────────────────────────────────────────────────────
console.log('loop control');

ok('the thinking config matches whichever model is configured', () => {
  // Getting this wrong is a 400 at runtime, not a lint error: Opus 5 and
  // Sonnet 5 take adaptive and reject budget_tokens; Haiku 4.5 is the reverse.
  const fn = new Function(`
    ${SRC.slice(SRC.indexOf('function crmThinkingConfig'), SRC.indexOf('\nconst FRESHNESS_BANDS'))}
    return crmThinkingConfig;
  `)();
  assert.deepStrictEqual(fn('claude-haiku-4-5'), { type: 'enabled', budget_tokens: 2048 });
  assert.deepStrictEqual(fn('claude-opus-5'), { type: 'adaptive' });
  assert.deepStrictEqual(fn('claude-sonnet-5'), { type: 'adaptive' });
  // The configured model must get a config the API will accept.
  const cfg = fn(sandbox.CRM_MODEL);
  assert.ok(cfg.type === 'adaptive' || cfg.budget_tokens < 4096,
    'a thinking budget at or above max_tokens is rejected');
  // The call site must not hardcode a block past the helper.
  assert.ok(/thinking: crmThinkingConfig\(CRM_MODEL\)/.test(BLOCK),
    'the loop hardcodes a thinking block instead of using the per-model helper');
});

ok('the assistant turn is replayed whole, thinking blocks included', () => {
  assert.ok(/content: response\.content/.test(BLOCK),
    'dropping thinking blocks breaks the next request on a thinking-enabled model');
});

ok('duplicate tool calls are refused without touching the database', () => {
  assert.ok(/duplicate_call/.test(BLOCK));
});

ok('exhausting the budget still produces an answer', () => {
  assert.ok(/tool_choice: \{ type: 'none' \}/.test(BLOCK), 'no forced final answer');
  assert.ok(sandbox.CRM_MAX_ITERATIONS > 0 && sandbox.CRM_MAX_ITERATIONS <= 10);
});

ok('the callable is given room to finish', () => {
  const chat = BLOCK.slice(BLOCK.indexOf('exports.crmAssistantChat'));
  assert.ok(/timeoutSeconds: 300/.test(chat), 'the 60s callable default would cut the loop off');
  assert.ok(/secrets: \[anthropicKey\]/.test(chat), 'the API key would be undefined at runtime');
});

ok('index errors never reach the chat reply', () => {
  assert.ok(/index/i.test(BLOCK_RAW) && /database index is still building/.test(BLOCK_RAW),
    'a raw Firestore index error embeds a console URL');
});

// ── Argument handling ───────────────────────────────────────────────────────
console.log('argument handling');

ok('clampInt survives whatever the model sends', () => {
  assert.strictEqual(sandbox.clampInt(999, 1, 50, 25), 50);
  assert.strictEqual(sandbox.clampInt(-5, 1, 50, 25), 1);
  assert.strictEqual(sandbox.clampInt('abc', 1, 50, 25), 25);
  assert.strictEqual(sandbox.clampInt(undefined, 1, 50, 25), 25);
  assert.strictEqual(sandbox.clampInt('12', 1, 50, 25), 12);
  assert.strictEqual(sandbox.clampInt(null, 1, 50, 25), 25);
});

ok('free text is bounded before it reaches the model', () => {
  assert.strictEqual(sandbox.snip('x'.repeat(500)).length, 300 + '…[truncated]'.length);
  assert.strictEqual(sandbox.snip(null), '');
});

ok('contact rows are a whitelist and never leak the phone number', () => {
  const row = sandbox.contactRow('c1', {
    name: 'Jane', phone: '+15555550123', email: 'j@x.com', stage: 'new',
    unsubToken: 'SECRET', stripeCustomerId: 'cus_SECRET', tags: ['a']
  });
  assert.strictEqual(row.hasPhone, true);
  assert.ok(!('phone' in row), 'the raw phone number is in the model context');
  assert.ok(!('unsubToken' in row));
  assert.ok(!('stripeCustomerId' in row));
});

ok('opt-outs travel with the row so the model can respect them', () => {
  const row = sandbox.contactRow('c1', { emailOptOut: true, doNotCall: true, tags: [] });
  assert.deepStrictEqual(row.optOuts.sort(), ['calls', 'email']);
});

ok('freshness matches the client bands exactly', () => {
  const at = (d) => ({ lastContactedAt: { toMillis: () => Date.now() - d * 86400000 - 1000 } });
  assert.strictEqual(sandbox.freshnessId(at(1)), 'warm');
  assert.strictEqual(sandbox.freshnessId(at(8)), 'cooling');
  assert.strictEqual(sandbox.freshnessId(at(20)), 'stagnant');
  assert.strictEqual(sandbox.freshnessId(at(45)), 'cold');
  assert.strictEqual(sandbox.freshnessId({}), 'never');
});

ok('never-contacted is excluded from staleness ranges by a lower bound', () => {
  // null sorts before every timestamp, so a bare <= cutoff would sweep in
  // every brand-new lead and report them as the coldest in the book.
  assert.ok(/lastContactedAt', '>', new admin\.firestore\.Timestamp\(0, 0\)/.test(BLOCK),
    'staleness queries lack the lower bound that excludes never-contacted rows');
});

console.log(`\n${passed} assertions passed.`);
