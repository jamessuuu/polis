#!/usr/bin/env node
/**
 * Verify the DEPLOYED site against the snapshot in this repo.
 *
 * tests/site.test.mjs already asserts that the BUILT html agrees with
 * data/ecosystem.json. That test passed continuously while the public site
 * served 45 citizens / 50 skills / 105 roads against a repo that said
 * 59 / 86 / 219 — because the build was correct and simply never shipped.
 *
 * A build-time check cannot see a stale deploy. On a project whose entire
 * claim is "every number traces to one file", the number a stranger actually
 * reads is the only one that counts. So this checks the published artifact.
 *
 *   node tools/verify-live.mjs                       # default URL
 *   node tools/verify-live.mjs https://example.com   # explicit
 *
 * Exit 0 published numbers agree with the snapshot
 * Exit 1 they disagree — the deploy is stale or wrong
 * Exit 2 could not fetch or parse (unverifiable, NOT a pass)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { get as httpsGet } from 'node:https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_URL = 'https://polis-sigma.vercel.app/';

const LABELS = {
  Citizens: 'agents',
  Skills: 'skills',
  Districts: 'divisions',
  Roads: 'edges',
  Directors: 'directors',
  Unreachable: 'unreachable',
  Withheld: 'withheld',
};

// node:https rather than fetch. undici keeps a pooled socket alive past the
// last await, and on Windows that trips
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... src\win\async.c
// at teardown, which ABORTS the process and replaces the real exit code with
// garbage. A checker whose exit code cannot be trusted is worse than no
// checker, so this uses the builtin client and closes its own socket.
function fetchText(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const req = httpsGet(url, { headers: { 'user-agent': 'polis-verify-live' } }, (res) => {
      const { statusCode: code, headers } = res;
      if (code >= 300 && code < 400 && headers.location) {
        res.resume();
        return resolve(fetchText(new URL(headers.location, url).href, depth + 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${code} from ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', (e) => reject(new Error(`request failed: ${e.message}`)));
    req.setTimeout(30000, () => { req.destroy(new Error('timed out after 30s')); });
  });
}

export async function verifyLive(url = DEFAULT_URL) {
  const snap = JSON.parse(readFileSync(join(ROOT, 'data', 'ecosystem.json'), 'utf8')).stats;

  let html;
  try {
    html = await fetchText(url);
  } catch (err) {
    return { status: 'unverifiable', reason: err.message, rows: [] };
  }

  const rows = [];
  for (const [label, key] of Object.entries(LABELS)) {
    const m = new RegExp(`<dt>${label}</dt><dd>(\\d+)</dd>`).exec(html);
    if (!m) {
      rows.push({ label, published: null, expected: snap[key], ok: false, missing: true });
      continue;
    }
    const published = Number(m[1]);
    rows.push({ label, published, expected: snap[key], ok: published === snap[key], missing: false });
  }

  if (rows.every((r) => r.missing)) {
    return { status: 'unverifiable', reason: 'no stat grid found in the published page', rows };
  }
  return { status: rows.every((r) => r.ok) ? 'verified' : 'failed', reason: null, rows };
}

// Windows note: import.meta.url never equals a bare argv[1] path here, so the
// main-module check must go through pathToFileURL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2] || DEFAULT_URL;
  const out = await verifyLive(url);

  console.log(`verify-live: ${url}`);
  for (const r of out.rows) {
    const mark = r.missing ? '????' : r.ok ? ' ok ' : 'DIFF';
    console.log(`  [${mark}] ${r.label.padEnd(12)} published=${String(r.published ?? '-').padStart(4)}  snapshot=${String(r.expected).padStart(4)}`);
  }

  if (out.status === 'verified') {
    console.log('\nverified: the published numbers are the repo\'s numbers.');
    process.exit(0);
  }
  if (out.status === 'failed') {
    const bad = out.rows.filter((r) => !r.ok).map((r) => r.label).join(', ');
    console.error(`\nFAILED: the deployed site disagrees with data/ecosystem.json on: ${bad}`);
    console.error('The deploy is stale or wrong. Run `npm run build:site`, commit, and redeploy.');
    process.exit(1);
  }
  console.error(`\nunverifiable: ${out.reason}`);
  console.error('This is not a pass. Nothing was checked.');
  process.exit(2);
}
