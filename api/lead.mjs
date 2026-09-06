/**
 * POST /api/lead: email James a lead, and release a locked library template
 * once the mail has actually gone.
 *
 * This file routes and binds. Every decision lives in `lib/lead.mjs`, which is
 * tested with a stub sender, a stub limiter and an injected clock in
 * `tests/lead.test.mjs`. The split is deliberate: a route that contains
 * judgement is a route whose judgement is only ever exercised by deploying it.
 *
 * DEPLOYMENT SHAPE, and the part that is unverified. polis is a static site
 * (`vercel.json` sets `outputDirectory: "site"` and there is no build step).
 * Vercel builds functions found in a top level `api/` directory for static
 * projects as well as framework ones, which is why this file sits here rather
 * than in `site/`. That has NOT been verified against a real deployment from
 * this session, because deploying is James's call and the machine's deploy
 * guard blocks it. Treat "the function is reachable at /api/lead" as the first
 * thing to check on the first deploy.
 *
 * The site's Content-Security-Policy already allows this: `connect-src 'self'`
 * permits a same-origin fetch, and `form-action 'none'` means the page must
 * call it with fetch rather than submit a form element to it.
 *
 * Runtime: Node. Not edge, because the mail call wants a normal fetch with a
 * timeout and nothing here needs to be at the edge.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { handleLead, createRateLimiter, sendLeadEmail } from '../lib/lead.mjs';
import { template, lockedTemplates } from '../lib/library.mjs';
import { bundleFromTemplate, templateSkills, validateBundle } from '../lib/export.mjs';

export const config = { runtime: 'nodejs' };

const limiter = createRateLimiter();

/**
 * Without a real salt, a stored hash of an IPv4 address is reversible by
 * anyone willing to walk the space, so a missing salt does not fall back to a
 * constant. It falls back to a random value minted once per process: still
 * unlinkable, still a working limiter, and it never leaves memory.
 */
let ephemeralSalt = null;
function salt() {
  const configured = process.env.POLIS_LEAD_IP_SALT;
  if (configured) return configured;
  if (!ephemeralSalt) ephemeralSalt = randomBytes(32).toString('hex');
  return ephemeralSalt;
}

/**
 * The LAST forwarded hop, not the first.
 *
 * `x-forwarded-for` is a list a caller can prepend to, so trusting its first
 * entry lets anyone mint a fresh rate-limit identity per request. The last
 * entry is the one the proxy in front of this function actually saw.
 */
function callerKey(headers) {
  const vercel = headers['x-vercel-forwarded-for'];
  const forwarded = headers['x-forwarded-for'];
  const real = headers['x-real-ip'];
  let ip = '';
  if (typeof vercel === 'string' && vercel.trim()) ip = vercel.split(',').pop().trim();
  else if (typeof forwarded === 'string' && forwarded.trim()) ip = forwarded.split(',').pop().trim();
  else if (typeof real === 'string') ip = real.trim();
  if (!ip) return 'unknown';
  return createHmac('sha256', salt()).update(ip).digest('hex').slice(0, 32);
}

function siteOrigin() {
  const explicit = process.env.POLIS_SITE_URL;
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : '';
}

function mailConfig() {
  return {
    endpoint: process.env.POLIS_LEAD_EMAIL_ENDPOINT || '',
    token: process.env.POLIS_LEAD_EMAIL_TOKEN || '',
    to: process.env.POLIS_LEAD_TO || '',
    from: process.env.POLIS_LEAD_FROM || '',
    subjectPrefix: process.env.POLIS_LEAD_SUBJECT_PREFIX || 'polis lead',
  };
}

/** POLIS_LEAD_FREEZE=1 stops every send instantly, with no deploy. */
function frozen() {
  const v = process.env.POLIS_LEAD_FREEZE;
  return v === '1' || v === 'true';
}

/**
 * The gated payload.
 *
 * Only LOCKED templates are released here, and the bundle is validated against
 * the Agent Skills field set before it is handed over: a lead that buys a
 * broken bundle is worse than a lead that buys nothing, because it is the
 * first impression as well as the last.
 *
 * Files are returned as text and the browser builds the zip with `lib/zip.mjs`.
 * That keeps the archive step in the same place for free and locked templates,
 * so there is one zip writer to be right about instead of two.
 */
async function unlock(id) {
  const t = template(id);
  if (!t || !t.locked) return null;
  if (!lockedTemplates().some((x) => x.id === t.id)) return null;
  const bundle = bundleFromTemplate({ ...t, skills: templateSkills(t) });
  const verdict = validateBundle(bundle.files);
  if (!verdict.ok) return null;
  return { id: t.id, name: t.name, files: bundle.files, warnings: bundle.warnings };
}

function readBody(req) {
  // Vercel's Node runtime parses JSON bodies for you, but the ladder caps the
  // request by real byte length and that needs the bytes. When the platform
  // has already parsed it, re-serialise: the cap then measures what was
  // actually accepted rather than nothing at all.
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  return new Promise((resolve) => {
    let data = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (over) return;
      data += chunk;
      // A hard stop well above the ladder's own cap, so a caller cannot stream
      // megabytes into memory before the 413 is decided.
      if (data.length > 1_000_000) { over = true; }
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

export default async function handler(req, res) {
  const rawBody = await readBody(req);
  const headers = req.headers || {};

  const result = await handleLead(
    {
      method: req.method,
      header: (name) => {
        const v = headers[String(name).toLowerCase()];
        return Array.isArray(v) ? v[0] : (v ?? null);
      },
      rawBody,
    },
    {
      site: siteOrigin(),
      frozen: frozen(),
      check: async () => limiter.check(callerKey(headers)),
      send: async (lead) => sendLeadEmail(lead, { ...mailConfig(), at: new Date().toISOString() }),
      unlock,
    },
  );

  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.statusCode = result.status;
  res.end(result.body);
}
