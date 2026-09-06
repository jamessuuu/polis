/**
 * Lead capture, against stubs.
 *
 * The tests that matter are the refusals. A form that answers "sent" when
 * nothing was sent costs a real lead, because nobody follows up on a message
 * they believe arrived, so every path through this ladder either sends or says
 * plainly that it did not. `ok: true` appears in exactly two places in these
 * tests: a genuine send, and the honeypot, which is a deliberate silent yes to
 * a bot and reaches neither the mailer nor the gated payload.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleLead, validateLead, isHoneypotTripped, createRateLimiter, originAllowed,
  sendLeadEmail, mailBody, leadEmailText, LEAD_LIMITS,
} from '../lib/lead.mjs';

const GOOD = { name: 'Ada', email: 'ada@example.com', role: 'CTO', message: 'Interested in the agency template.' };

function req(body, over = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = {
    'content-type': 'application/json',
    'content-length': String(new TextEncoder().encode(raw).length),
    origin: 'https://polis.example',
    ...over.headers,
  };
  return {
    method: over.method ?? 'POST',
    header: (n) => headers[String(n).toLowerCase()] ?? null,
    rawBody: raw,
  };
}

function deps(over = {}) {
  const calls = { sent: [], unlocked: [] };
  return {
    calls,
    deps: {
      site: 'https://polis.example',
      frozen: false,
      check: async () => ({ allowed: true, retryAfter: 0 }),
      send: async (lead) => { calls.sent.push(lead); return 'sent'; },
      unlock: async (id) => { calls.unlocked.push(id); return id === 'evaluation-and-governance' ? { id, files: [] } : null; },
      ...over,
    },
  };
}

const parse = (r) => JSON.parse(r.body);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('a good lead validates and gets its defaults', () => {
  const out = validateLead({ name: ' Ada ', email: 'ada@example.com' });
  assert.equal(out.ok, true);
  assert.equal(out.lead.name, 'Ada');
  assert.equal(out.lead.role, 'Not specified');
  assert.equal(out.lead.source, 'polis');
  assert.equal(out.lead.template, null);
});

test('shape, name and email are all required and checked', () => {
  assert.equal(validateLead(null).error, 'shape');
  assert.equal(validateLead([]).error, 'shape');
  assert.equal(validateLead('x').error, 'shape');
  assert.equal(validateLead({ email: 'a@b.co' }).error, 'name');
  assert.equal(validateLead({ name: 'A' }).error, 'email');
  assert.equal(validateLead({ name: 'A', email: 'not-an-email' }).error, 'email');
  assert.equal(validateLead({ name: 'A', email: 'a@b' }).error, 'email');
});

test('an over-long message is refused rather than quietly cut in half', () => {
  const out = validateLead({ ...GOOD, message: 'x'.repeat(LEAD_LIMITS.message + 1) });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'message');
});

test('single line fields are flattened and capped', () => {
  const out = validateLead({ ...GOOD, name: 'Ada\nLovelace\t', role: 'r'.repeat(200) });
  assert.equal(out.lead.name, 'Ada Lovelace');
  assert.equal(out.lead.role.length, LEAD_LIMITS.role);
});

test('a template id must look like a template id', () => {
  assert.equal(validateLead({ ...GOOD, template: 'agency-delivery' }).lead.template, 'agency-delivery');
  assert.equal(validateLead({ ...GOOD, template: '../../etc/passwd' }).error, 'template');
  assert.equal(validateLead({ ...GOOD, template: 'Bad Name' }).error, 'template');
});

test('unknown fields are dropped rather than carried through', () => {
  const out = validateLead({ ...GOOD, admin: true, id: 7 });
  assert.deepEqual(Object.keys(out.lead).sort(), ['email', 'message', 'name', 'role', 'source', 'template'].sort());
});

test('the honeypot only trips on non-empty text', () => {
  assert.equal(isHoneypotTripped({ botcheck: 'anything' }), true);
  assert.equal(isHoneypotTripped({ botcheck: '   ' }), false);
  assert.equal(isHoneypotTripped({ botcheck: '' }), false);
  assert.equal(isHoneypotTripped({}), false);
  assert.equal(isHoneypotTripped(null), false);
});

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

test('a missing origin is allowed and a foreign one is not', () => {
  assert.equal(originAllowed(null, 'https://polis.example'), true);
  assert.equal(originAllowed('https://polis.example', 'https://polis.example'), true);
  assert.equal(originAllowed('https://polis.example/some/path', 'https://polis.example'), true);
  assert.equal(originAllowed('https://evil.example', 'https://polis.example'), false);
  assert.equal(originAllowed('http://polis.example', 'https://polis.example'), false);
  assert.equal(originAllowed('garbage', 'https://polis.example'), false);
});

test('an unconfigured site origin fails closed for cross-origin callers', () => {
  assert.equal(originAllowed('https://polis.example', ''), false);
  assert.equal(originAllowed(null, ''), true);
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

test('a good request sends and answers ok', async () => {
  const d = deps();
  const res = await handleLead(req(GOOD), d.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(parse(res), { ok: true });
  assert.equal(d.calls.sent.length, 1);
  assert.equal(d.calls.sent[0].email, 'ada@example.com');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('anything but POST is 405 with an Allow header', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    const res = await handleLead(req(GOOD, { method }), deps().deps);
    assert.equal(res.status, 405);
    assert.equal(parse(res).reason, 'method');
    assert.equal(res.headers.Allow, 'POST');
  }
});

test('a foreign origin is refused before anything is parsed', async () => {
  const d = deps();
  const res = await handleLead(req(GOOD, { headers: { origin: 'https://evil.example' } }), d.deps);
  assert.equal(res.status, 403);
  assert.equal(parse(res).reason, 'origin');
  assert.equal(d.calls.sent.length, 0);
});

test('a non-JSON content type is refused', async () => {
  const res = await handleLead(req(GOOD, { headers: { 'content-type': 'text/plain' } }), deps().deps);
  assert.equal(res.status, 415);
  assert.equal(parse(res).reason, 'unsupported-type');
});

test('a declared length over the cap is refused without reading the body', async () => {
  const res = await handleLead(req(GOOD, { headers: { 'content-length': String(LEAD_LIMITS.maxRequestBytes + 1) } }), deps().deps);
  assert.equal(res.status, 413);
});

test('a lying content-length does not get past the real byte count', async () => {
  // Multibyte content is what slips past a character-length check, so the
  // second cap measures encoded bytes.
  const big = { ...GOOD, message: 'é'.repeat(LEAD_LIMITS.maxRequestBytes) };
  const res = await handleLead(req(big, { headers: { 'content-length': '10' } }), deps().deps);
  assert.equal(res.status, 413);
  assert.equal(parse(res).reason, 'too-large');
});

test('the rate limit is checked before the body is parsed', async () => {
  const d = deps({ check: async () => ({ allowed: false, retryAfter: 42, reason: 'per-minute' }) });
  const res = await handleLead(req('this is not json at all'), d.deps);
  assert.equal(res.status, 429);
  assert.equal(parse(res).reason, 'rate-limited');
  assert.equal(res.headers['Retry-After'], '42');
});

test('a body that is not JSON is a 400, never a crash', async () => {
  const res = await handleLead(req('{ not json'), deps().deps);
  assert.equal(res.status, 400);
  assert.equal(parse(res).reason, 'malformed');
});

test('the honeypot answers a silent yes and reaches neither the mailer nor the payload', async () => {
  const d = deps();
  const res = await handleLead(req({ ...GOOD, botcheck: 'filled', template: 'evaluation-and-governance' }), d.deps);
  assert.equal(res.status, 202);
  assert.deepEqual(parse(res), { ok: true });
  assert.equal(d.calls.sent.length, 0);
  assert.equal(d.calls.unlocked.length, 0);
});

test('an invalid lead is a 400 and nothing is sent', async () => {
  const d = deps();
  const res = await handleLead(req({ name: '', email: 'nope' }), d.deps);
  assert.equal(res.status, 400);
  assert.equal(parse(res).reason, 'invalid');
  assert.equal(d.calls.sent.length, 0);
});

test('the freeze switch stops every send with no deploy', async () => {
  const d = deps({ frozen: true });
  const res = await handleLead(req(GOOD), d.deps);
  assert.equal(res.status, 503);
  assert.equal(parse(res).reason, 'frozen');
  assert.equal(d.calls.sent.length, 0);
});

test('an unconfigured mailer refuses honestly rather than pretending', async () => {
  const d = deps({ send: async () => 'not-configured' });
  const res = await handleLead(req(GOOD), d.deps);
  assert.equal(res.status, 503);
  assert.equal(parse(res).reason, 'not-configured');
  assert.equal(parse(res).ok, false);
});

test('a mailer that fails is unavailable, and a mailer that throws is too', async () => {
  for (const send of [async () => 'unavailable', async () => { throw new Error('boom'); }]) {
    const res = await handleLead(req(GOOD), deps({ send }).deps);
    assert.equal(res.status, 503);
    assert.equal(parse(res).reason, 'unavailable');
  }
});

test('nothing but a real send releases the gated payload', async () => {
  const d = deps({ send: async () => 'unavailable' });
  const res = await handleLead(req({ ...GOOD, template: 'evaluation-and-governance' }), d.deps);
  assert.equal(res.status, 503);
  assert.equal(d.calls.unlocked.length, 0);
});

test('a successful lead for a locked template returns its payload', async () => {
  const d = deps();
  const res = await handleLead(req({ ...GOOD, template: 'evaluation-and-governance' }), d.deps);
  assert.equal(res.status, 200);
  assert.equal(parse(res).template.id, 'evaluation-and-governance');
  assert.deepEqual(d.calls.unlocked, ['evaluation-and-governance']);
});

test('asking for a template that is not locked still captures the lead and says so', async () => {
  const d = deps();
  const res = await handleLead(req({ ...GOOD, template: 'solo-developer' }), d.deps);
  assert.equal(res.status, 200);
  assert.equal(parse(res).ok, true);
  assert.equal(parse(res).template, null);
});

// ---------------------------------------------------------------------------
// The limiter
// ---------------------------------------------------------------------------

test('a caller is stopped at the per-minute ceiling and released after a minute', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ now: () => now });
  for (let i = 0; i < LEAD_LIMITS.perMinute; i++) {
    assert.equal(limiter.check('a').allowed, true, `call ${i}`);
  }
  const blocked = limiter.check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'per-minute');
  assert.equal(blocked.retryAfter, 60);

  now += 61_000;
  assert.equal(limiter.check('a').allowed, true);
});

test('one caller hitting the ceiling does not block another', () => {
  let now = 0;
  const limiter = createRateLimiter({ now: () => now });
  for (let i = 0; i < LEAD_LIMITS.perMinute; i++) limiter.check('a');
  assert.equal(limiter.check('a').allowed, false);
  assert.equal(limiter.check('b').allowed, true);
});

test('the hourly ceiling holds even when the minutes are spread out', () => {
  let now = 0;
  const limiter = createRateLimiter({ now: () => now });
  let allowed = 0;
  for (let i = 0; i < 30; i++) {
    if (limiter.check('a').allowed) allowed++;
    now += 90_000; // more than a minute apart, so only the hour rule can bite
  }
  assert.equal(allowed, LEAD_LIMITS.perHour);
});

test('the global ceiling bounds one instance across every caller', () => {
  let now = 0;
  const limiter = createRateLimiter({ now: () => now, globalPerMinute: 5 });
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (limiter.check(`caller-${i}`).allowed) allowed++;
  assert.equal(allowed, 5);
  const blocked = limiter.check('caller-fresh');
  assert.equal(blocked.reason, 'global');
});

test('the limiter fails closed when its clock throws', () => {
  const limiter = createRateLimiter({ now: () => { throw new Error('no clock'); } });
  const verdict = limiter.check('a');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, 'error');
});

test('the caller table is pruned rather than growing without bound', () => {
  let now = 0;
  const limiter = createRateLimiter({ now: () => now, maxTrackedCallers: 10, globalPerMinute: 10_000 });
  for (let i = 0; i < 200; i++) { limiter.check(`c${i}`); now += 10; }
  // Nothing to assert on the internals from outside, so assert the behaviour
  // that pruning must not break: a fresh caller is still served.
  assert.equal(limiter.check('fresh').allowed, true);
});

// ---------------------------------------------------------------------------
// The mail call
// ---------------------------------------------------------------------------

const MAIL = { endpoint: 'https://mail.example/send', token: 't', to: 'james@example.com', from: 'polis@example.com' };

test('a missing piece of mail configuration is not-configured, every time', async () => {
  for (const key of ['endpoint', 'token', 'to', 'from']) {
    const cfg = { ...MAIL, [key]: '' };
    assert.equal(await sendLeadEmail(GOOD, { ...cfg, fetch: async () => ({ status: 200 }) }), 'not-configured');
  }
});

test('only a 2xx counts as sent', async () => {
  for (const [status, expected] of [[200, 'sent'], [202, 'sent'], [299, 'sent'], [400, 'unavailable'], [403, 'unavailable'], [500, 'unavailable']]) {
    assert.equal(await sendLeadEmail(GOOD, { ...MAIL, fetch: async () => ({ status }) }), expected, `status ${status}`);
  }
});

test('a mailer that throws or times out is unavailable, not sent', async () => {
  assert.equal(await sendLeadEmail(GOOD, { ...MAIL, fetch: async () => { throw new Error('network'); } }), 'unavailable');
  assert.equal(
    await sendLeadEmail(GOOD, { ...MAIL, timeoutMs: 5, fetch: (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); }) }),
    'unavailable',
  );
});

test('the request carries the bearer token and the documented body shape', async () => {
  let seen = null;
  await sendLeadEmail({ ...GOOD, source: 'polis', template: 'agency-delivery' }, {
    ...MAIL,
    fetch: async (url, init) => { seen = { url, init }; return { status: 200 }; },
  });
  assert.equal(seen.url, MAIL.endpoint);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer t');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['from', 'reply_to', 'subject', 'text', 'to'].sort());
  assert.equal(body.to, MAIL.to);
  assert.equal(body.reply_to, 'ada@example.com');
});

test('the email body carries every field James needs to answer it', () => {
  const text = leadEmailText({ ...GOOD, source: 'polis', template: 'agency-delivery' }, { at: '2026-09-07T00:00:00.000Z' });
  for (const fragment of ['Ada', 'ada@example.com', 'CTO', 'agency-delivery', '2026-09-07', 'Interested in the agency template.']) {
    assert.ok(text.includes(fragment), `missing ${fragment}`);
  }
});

test('a lead with no message says so rather than sending an empty mail', () => {
  const text = leadEmailText({ ...GOOD, message: '', source: 'polis', template: null });
  assert.match(text, /\(no message\)/);
  assert.match(text, /none requested/);
});

test('the subject prefix is configurable and defaults sensibly', () => {
  assert.match(mailBody(GOOD, MAIL).subject, /^polis lead: Ada$/);
  assert.match(mailBody(GOOD, { ...MAIL, subjectPrefix: 'lead' }).subject, /^lead: Ada$/);
});
