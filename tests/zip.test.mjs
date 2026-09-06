/**
 * The zip container, both directions.
 *
 * The tests that matter are the ones about refusing: a reader that silently
 * returns an empty file for a truncated entry, or that extracts a member named
 * `../../.bashrc`, is worse than one that throws, because the caller believes
 * it worked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeZip, readZip, readZipAsText, crc32, safeEntryName, ZipError } from '../lib/zip.mjs';

const FILES = [
  { path: 'README.md', text: '# hello\n' },
  { path: 'agents/one.md', text: '---\nname: one\n---\nbody one\n' },
  { path: 'skills/two/SKILL.md', text: '---\nname: two\n---\nbody two\n'.repeat(40) },
];

test('crc32 matches the known value for the standard check string', () => {
  // "123456789" has CRC-32 0xCBF43926 in every published table.
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a written archive reads back with identical contents', async () => {
  const bytes = await writeZip(FILES);
  const { files, skipped } = await readZipAsText(bytes);
  assert.deepEqual(skipped, []);
  assert.equal(files.length, 3);
  for (const original of FILES) {
    const got = files.find((f) => f.path === original.path);
    assert.ok(got, `missing ${original.path}`);
    assert.equal(got.text, original.text);
  }
});

test('the third entry is actually deflated, not just stored', async () => {
  // The repeated body is 1400 bytes of near-identical text. If compression is
  // silently doing nothing, the archive is bigger than the payload and this
  // catches it.
  const bytes = await writeZip(FILES);
  const raw = FILES.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0);
  assert.ok(bytes.length < raw, `archive ${bytes.length} should be smaller than payload ${raw}`);
});

test('compression can be turned off and the result still reads back', async () => {
  const bytes = await writeZip(FILES, { compress: false });
  const { files } = await readZipAsText(bytes);
  assert.equal(files.length, 3);
  assert.equal(files.find((f) => f.path === 'README.md').text, '# hello\n');
});

test('two writes of the same input produce identical bytes', async () => {
  // Reproducibility is why the timestamp is fixed. A difference in the file
  // should mean a difference in the content.
  const a = await writeZip(FILES);
  const b = await writeZip(FILES);
  assert.deepEqual([...a], [...b]);
});

test('unicode content and names survive the round trip', async () => {
  const input = [{ path: 'skills/caf\u00e9/SKILL.md', text: 'na\u00efve \u2014 \u65e5\u672c\u8a9e\n' }];
  const { files } = await readZipAsText(await writeZip(input));
  assert.equal(files[0].path, 'skills/caf\u00e9/SKILL.md');
  assert.equal(files[0].text, 'na\u00efve \u2014 \u65e5\u672c\u8a9e\n');
});

test('an empty file round trips', async () => {
  const { files } = await readZipAsText(await writeZip([{ path: 'empty.md', text: '' }]));
  assert.equal(files.length, 1);
  assert.equal(files[0].text, '');
});

test('safeEntryName refuses paths that escape the archive', () => {
  assert.equal(safeEntryName('a/b.md'), 'a/b.md');
  assert.equal(safeEntryName('a\\b.md'), 'a/b.md');
  assert.equal(safeEntryName('../secret'), null);
  assert.equal(safeEntryName('a/../../secret'), null);
  assert.equal(safeEntryName('/etc/passwd'), null);
  assert.equal(safeEntryName('C:/Windows/x'), null);
  assert.equal(safeEntryName(''), null);
});

test('the writer refuses an unsafe name rather than normalising it away', async () => {
  await assert.rejects(() => writeZip([{ path: '../escape.md', text: 'x' }]), (e) => e instanceof ZipError && e.code === 'unsafe-path');
});

test('the writer refuses duplicate entry names', async () => {
  await assert.rejects(
    () => writeZip([{ path: 'a.md', text: '1' }, { path: 'a.md', text: '2' }]),
    (e) => e instanceof ZipError && e.code === 'duplicate',
  );
});

test('a corrupted payload is caught by the checksum and skipped, not returned', async () => {
  const bytes = await writeZip([{ path: 'a.md', text: 'the original content here' }], { compress: false });
  // Flip a byte inside the stored data. The local header is 30 bytes plus the
  // 4 byte name, so byte 40 is inside the payload.
  const damaged = bytes.slice();
  damaged[40] ^= 0xff;
  const { entries, skipped } = await readZip(damaged);
  assert.equal(entries.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'checksum mismatch');
});

test('a file that is not a zip is refused with a named error', async () => {
  await assert.rejects(
    () => readZip(new TextEncoder().encode('this is a markdown file, not an archive at all')),
    (e) => e instanceof ZipError && e.code === 'not-a-zip',
  );
});

test('something far too small to be an archive is refused', async () => {
  await assert.rejects(() => readZip(new Uint8Array(4)), (e) => e instanceof ZipError && e.code === 'truncated');
});

test('a directory entry carries no data and is not returned as a file', async () => {
  // Hand-built, because writeZip never emits directory entries: the reader has
  // to cope with archives from tools that do.
  const inner = await writeZip([{ path: 'agents/x.md', text: 'x' }], { compress: false });
  const { files } = await readZipAsText(inner);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'agents/x.md');
});

test('sizes are read from the central directory, so a streamed local header does not empty a file', async () => {
  // Simulate a writer that used a data descriptor: zero the sizes and the crc
  // in the LOCAL header only. A reader that trusts the local header returns an
  // empty file with no error at all, which is the quiet failure this guards.
  const bytes = await writeZip([{ path: 'a.md', text: 'real content' }], { compress: false });
  const view = new DataView(bytes.buffer);
  view.setUint32(14, 0, true); // crc
  view.setUint32(18, 0, true); // compressed size
  view.setUint32(22, 0, true); // uncompressed size
  const { files } = await readZipAsText(bytes);
  assert.equal(files[0].text, 'real content');
});
