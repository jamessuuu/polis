/**
 * Lead capture for polis: the decision ladder, the limiter and the mail call,
 * all pure enough to test without a network or a runtime.
 *
 * The route that binds this to Vercel is `api/lead.mjs` and it contains no
 * decisions. Everything that can be wrong lives here, where
 * `tests/lead.test.mjs` exercises it with a stub sender and an injected clock.
 * That split is taken from agentjames `src/lib/hire/*`, which separates the
 * ladder (handler.ts) from the bindings (server.ts) for the same reason.
 *
 * WHY THE EMAIL GOES SERVER SIDE HERE. agentjames records the finding in
 * `src/lib/hire/policy.ts`: web3forms, the browser-side form service it uses,
 * accepts BROWSER submissions only by design. Probed 2026-09-06, a server-side
 * POST is refused with a policy message and Node's own fetch is answered by
 * the provider's Cloudflare front with a managed challenge, because its TLS
 * fingerprint is not a browser's. So that provider cannot be the server path,
 * and a server path is what polis needs: this function also hands over the
 * gated library payload, and that cannot be decided in the browser.
 *
 * WHAT THIS NEEDS, AND WHAT IT DOES WITHOUT IT. No provider is chosen here and
 * none is invented. The function needs four values:
 *
 *   POLIS_LEAD_EMAIL_ENDPOINT   an HTTPS URL that accepts a JSON POST
 *   POLIS_LEAD_EMAIL_TOKEN      a bearer token for it
 *   POLIS_LEAD_TO               where the lead goes
 *   POLIS_LEAD_FROM             a sender the provider has verified
 *
 * With any of them missing the function answers `not-configured` and a 503.
 * It does not queue, it does not pretend, and it does not return `ok: true`.
 * A form that says "sent" when nothing was sent is the one failure mode that
 * costs a real lead, because nobody follows up on a message they believe
 * arrived. `.env.example` documents the four, and the request body shape is
 * stated at `mailBody` below so an operator can see in one place whether their
 * provider takes it.
 */

export const LEAD_LIMITS = {
  /** Per hashed caller. A person sends one, maybe a correction. */
  perMinute: 3,
  perHour: 12,
  /** Per instance, across every caller. The blast radius of one hot function. */
  globalPerMinute: 90,
  /** Distinct callers held per instance before the table is pruned. */
  maxTrackedCallers: 5000,
  /** A lead is a few hundred bytes. 8 KB leaves room for a real note. */
  maxRequestBytes: 8 * 1024,
  name: 120,
  email: 254,
  role: 80,
  message: 2000,
  source: 80,
  template: 64,
};

/**
 * Every way this can refuse. All of them render to the visitor as "this did
 * not send", never as a success with an asterisk.
 */
export const LEAD_REFUSALS = [
  'method',
  'origin',
  'unsupported-type',
  'too-large',
  'malformed',
  'invalid',
  'rate-limited',
  'frozen',
  'not-configured',
  'unavailable',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_SPECIFIED = 'Not specified';
const DEFAULT_SOURCE = 'polis';

function line(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/**
 * Shape and length only.
 *
 * An over-long message is REFUSED rather than cut. Silently keeping the first
 * two thousand characters of what somebody wrote and calling it sent is worse
 * than telling them it did not go, because the refusal carries the address
 * they can use instead and the truncation carries nothing.
 */
export function validateLead(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'shape' };
  const raw = input;

  const name = line(raw.name, LEAD_LIMITS.name);
  if (!name) return { ok: false, error: 'name' };

  const email = line(raw.email, LEAD_LIMITS.email);
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'email' };

  const message = typeof raw.message === 'string' ? raw.message.trim() : '';
  if (message.length > LEAD_LIMITS.message) return { ok: false, error: 'message' };

  const template = line(raw.template, LEAD_LIMITS.template);
  if (template && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(template)) return { ok: false, error: 'template' };

  return {
    ok: true,
    lead: {
      name,
      email,
      role: line(raw.role, LEAD_LIMITS.role) || NOT_SPECIFIED,
      message,
      source: line(raw.source, LEAD_LIMITS.source) || DEFAULT_SOURCE,
      template: template || null,
    },
  };
}

/**
 * The honeypot. A person leaves this empty because they never see the field.
 * Same field name agentjames uses, so one form can serve both.
 */
export function isHoneypotTripped(input) {
  if (!input || typeof input !== 'object') return false;
  const value = input.botcheck;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * An in-process rolling-window limiter.
 *
 * Per instance, and that is a ceiling per function rather than a global one.
 * Stated rather than implied, because a serverless deployment runs several
 * instances and a limiter that is described as global when it is not is a
 * control somebody will rely on incorrectly.
 *
 * It fails CLOSED: any throw inside `check` denies. A limiter that opens when
 * it breaks is a formality.
 */
export function createRateLimiter(config = {}) {
  const cfg = { ...LEAD_LIMITS, ...config };
  const now = config.now ?? (() => Date.now());
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  let callers = new Map();
  let globalHits = [];

  function prune(t) {
    if (callers.size <= cfg.maxTrackedCallers) return;
    // Oldest-seen first. A flood of fresh keys must not push out a caller who
    // is mid-burst, so eviction is by last-seen rather than by insertion.
    const sorted = [...callers.entries()].sort((a, b) => a[1].last - b[1].last);
    const drop = sorted.slice(0, Math.ceil(sorted.length / 2));
    for (const [key] of drop) callers.delete(key);
    void t;
  }

  return {
    check(key) {
      try {
        const t = now();
        globalHits = globalHits.filter((x) => t - x < MINUTE);
        if (globalHits.length >= cfg.globalPerMinute) {
          return { allowed: false, retryAfter: 60, reason: 'global' };
        }

        const id = String(key ?? 'anonymous');
        let rec = callers.get(id);
        if (!rec) { rec = { hits: [], last: t }; callers.set(id, rec); }
        rec.hits = rec.hits.filter((x) => t - x < HOUR);
        rec.last = t;

        const inMinute = rec.hits.filter((x) => t - x < MINUTE).length;
        if (inMinute >= cfg.perMinute) return { allowed: false, retryAfter: 60, reason: 'per-minute' };
        if (rec.hits.length >= cfg.perHour) return { allowed: false, retryAfter: 3600, reason: 'per-hour' };

        rec.hits.push(t);
        globalHits.push(t);
        prune(t);
        return { allowed: true, retryAfter: 0 };
      } catch {
        return { allowed: false, retryAfter: 60, reason: 'error' };
      }
    },
    reset() {
      callers = new Map();
      globalHits = [];
    },
  };
}

/**
 * Origin check.
 *
 * A missing Origin is allowed: a same-origin form post and a command line
 * request both arrive without one, and the rate limiter still applies to them.
 * A present Origin must match the site exactly. When the site origin is not
 * configured, every cross-origin request is refused rather than waved through,
 * which is fail-closed and is why `POLIS_SITE_URL` is in `.env.example`.
 */
export function originAllowed(origin, site) {
  if (!origin) return true;
  if (!site) return false;
  try {
    return new URL(origin).origin === new URL(site).origin;
  } catch {
    return false;
  }
}

/** The plain-text body of the mail James receives. */
export function leadEmailText(lead, meta = {}) {
  const lines = [];
  lines.push(`Name:     ${lead.name}`);
  lines.push(`Email:    ${lead.email}`);
  lines.push(`Role:     ${lead.role}`);
  lines.push(`Source:   ${lead.source}`);
  lines.push(`Template: ${lead.template ?? 'none requested'}`);
  if (meta.at) lines.push(`At:       ${meta.at}`);
  lines.push('');
  lines.push(lead.message || '(no message)');
  return lines.join('\n');
}

/**
 * The request body posted to whatever endpoint the operator configured.
 *
 * Named and exported on purpose: this is the one shape that has to match the
 * provider, and an operator whose provider wants different field names should
 * change it here rather than hunting through the ladder. Nothing else in this
 * module knows what an email looks like.
 */
export function mailBody(lead, cfg, meta = {}) {
  return {
    from: cfg.from,
    to: cfg.to,
    subject: `${cfg.subjectPrefix ?? 'polis lead'}: ${lead.name}`,
    text: leadEmailText(lead, meta),
    reply_to: lead.email,
  };
}

/**
 * Send, or say honestly why not.
 *
 * @returns {Promise<'sent'|'not-configured'|'unavailable'>}
 */
export async function sendLeadEmail(lead, cfg = {}) {
  const { endpoint, token, to, from } = cfg;
  if (!endpoint || !token || !to || !from) return 'not-configured';
  const fetchImpl = cfg.fetch ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return 'not-configured';

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs ?? 8000) : null;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(mailBody(lead, cfg, { at: cfg.at })),
      signal: controller ? controller.signal : undefined,
    });
    // Only a 2xx counts. A provider that answers 200 with an error body is a
    // provider whose body shape this module does not claim to know, so the
    // status is the only honest signal available here.
    return res && res.status >= 200 && res.status < 300 ? 'sent' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function answer(status, body, headers = {}) {
  return {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

/**
 * The ladder.
 *
 * @param {{method: string, header: (name: string) => string|null, rawBody: string}} request
 * @param {{send: Function, check: Function, site: string, frozen: boolean, unlock?: Function, callerKey?: Function}} deps
 * @returns {Promise<{status: number, headers: object, body: string}>}
 *
 * The order matters and each step is here for a reason:
 *
 *   1. Method, so a crawler's GET is one comparison rather than a parse.
 *   2. Origin, so a page on another domain cannot drive it.
 *   3. Declared type, then declared length, then real byte length. Multibyte
 *      content is what slips past a character count.
 *   4. Rate limit BEFORE parsing, so an unconfigured deployment is still cheap
 *      to hammer.
 *   5. Parse, honeypot, validate.
 *   6. The freeze switch, then the send. Only a real send becomes `ok: true`,
 *      and only a real send releases the gated payload.
 */
export async function handleLead(request, deps) {
  const method = String(request.method ?? '').toUpperCase();
  if (method !== 'POST') return answer(405, { ok: false, reason: 'method' }, { Allow: 'POST' });

  if (!originAllowed(request.header('origin'), deps.site)) {
    return answer(403, { ok: false, reason: 'origin' });
  }

  const type = String(request.header('content-type') ?? '').toLowerCase();
  if (!type.includes('application/json')) {
    return answer(415, { ok: false, reason: 'unsupported-type' });
  }

  const declared = Number(request.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > LEAD_LIMITS.maxRequestBytes) {
    return answer(413, { ok: false, reason: 'too-large' });
  }
  const raw = String(request.rawBody ?? '');
  if (new TextEncoder().encode(raw).length > LEAD_LIMITS.maxRequestBytes) {
    return answer(413, { ok: false, reason: 'too-large' });
  }

  const verdict = await deps.check(request);
  if (!verdict.allowed) {
    return answer(429, { ok: false, reason: 'rate-limited' }, { 'Retry-After': String(verdict.retryAfter) });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return answer(400, { ok: false, reason: 'malformed' });
  }

  // A silent yes, no send, no payload. The bot learns nothing about the field
  // and receives nothing for tripping it.
  if (isHoneypotTripped(body)) return answer(202, { ok: true });

  const validated = validateLead(body);
  if (!validated.ok) return answer(400, { ok: false, reason: 'invalid' });

  if (deps.frozen) return answer(503, { ok: false, reason: 'frozen' });

  let outcome;
  try {
    outcome = await deps.send(validated.lead);
  } catch {
    outcome = 'unavailable';
  }
  if (outcome !== 'sent') {
    return answer(503, { ok: false, reason: outcome === 'not-configured' ? 'not-configured' : 'unavailable' });
  }

  const payload = { ok: true };
  if (validated.lead.template && typeof deps.unlock === 'function') {
    const unlocked = await deps.unlock(validated.lead.template);
    // A request for a template that is not locked, or does not exist, is not
    // an error: the lead was still captured and the visitor already has every
    // free template. It is reported so the page can say which.
    if (unlocked) payload.template = unlocked;
    else payload.template = null;
  }
  return answer(200, payload);
}
