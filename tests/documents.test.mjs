import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadChapters, saveDocument } from '../documents.mjs';

const root = await mkdtemp(join(tmpdir(), 'typclass-documents-'));
const dir = join(root, '01');
try {
  await mkdir(dir);
  const tutorial = join(dir, '课件.typ');
  const notes = join(dir, '笔记.typ');
  await writeFile(tutorial, 'original tutorial');
  await writeFile(notes, 'original notes');
  const original = (await loadChapters(root))[0];
  const request = { id: '01', pane: 'tutorial', base: original.tutorial, source: 'web edit' };
  const untouched = (await stat(notes)).mtimeMs;
  saveDocument(root, request);
  assert.equal(await readFile(tutorial, 'utf8'), 'web edit');
  assert.equal((await stat(notes)).mtimeMs, untouched, 'saving tutorial must not touch notes');

  await writeFile(tutorial, 'external edit');
  assert.throws(() => saveDocument(root, { ...request, base: 'web edit' }), { status: 409 });
  assert.equal(await readFile(tutorial, 'utf8'), 'external edit', 'stale browser must not overwrite disk');
  assert.equal((await loadChapters(root))[0].tutorial, 'external edit');

  assert.throws(() => saveDocument(root, { id: '01', tutorial: 'legacy', notes: 'legacy' }), { status: 400 });
  assert.throws(() => saveDocument(root, { ...request, id: '../escape' }), { status: 400 });
  assert.throws(() => saveDocument(root, { ...request, pane: '__proto__' }), { status: 400 });
  assert.throws(() => saveDocument(root, { ...request, base: undefined }), { status: 400 });

  const stamp = (await stat(tutorial)).mtimeMs;
  saveDocument(root, { ...request, base: 'external edit', source: 'external edit' });
  assert.equal((await stat(tutorial)).mtimeMs, stamp, 'no-op saves must not touch the file');
  saveDocument(root, { ...request, base: 'external edit', source: 'first writer' });
  assert.throws(() => saveDocument(root, { ...request, base: 'external edit', source: 'second writer' }), { status: 409 });
  assert.equal(await readFile(tutorial, 'utf8'), 'first writer');

  await rm(tutorial);
  assert.throws(() => saveDocument(root, { ...request, base: 'first writer' }), { status: 409 });
  await assert.rejects(readFile(tutorial), { code: 'ENOENT' });
  await rm(dir, { recursive: true });
  assert.throws(() => saveDocument(root, request), { code: 'ENOENT' });
  console.log('document save tests passed: single-file writes, external changes, stale clients, no-op, concurrent writers, deletion');
} finally {
  await rm(root, { recursive: true, force: true });
}
