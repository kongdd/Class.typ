import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const files = { tutorial: '课件.typ', notes: '笔记.typ' };
const missingAsEmpty = error => {
  if (error.code === 'ENOENT') return '';
  throw error;
};

export async function loadChapters(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(async id => ({
    id,
    title: id,
    tutorial: await readFile(join(root, id, files.tutorial), 'utf8').catch(missingAsEmpty),
    notes: await readFile(join(root, id, files.notes), 'utf8').catch(missingAsEmpty),
  })));
}

export function saveDocument(root, { id, pane, base, source }) {
  if (typeof id !== 'string' || !id || id === '.' || /[\\/]|\.\./.test(id)
    || !Object.hasOwn(files, pane) || typeof base !== 'string' || typeof source !== 'string') {
    throw Object.assign(new Error('请求参数无效：保存必须携带原文，请刷新旧页面。'), { status: 400 });
  }
  const dir = join(root, id);
  if (!statSync(dir).isDirectory()) throw new Error('章节不存在');
  const file = join(dir, files[pane]);
  const read = () => {
    try { return readFileSync(file, 'utf8'); } catch (error) { return missingAsEmpty(error); }
  };
  const check = () => {
    if (read() !== base) {
      throw Object.assign(new Error('磁盘文件已更新，保存已阻止；网页草稿仍保留。'), { status: 409 });
    }
  };
  check();
  if (base === source) return;
  const temp = join(dir, `.${files[pane]}.${randomUUID()}.tmp`);
  try {
    let mode = 0o666;
    try { mode = statSync(file).mode; } catch (error) { missingAsEmpty(error); }
    // Synchronous compare/rename serializes this server's saves; external editors do not share its lock.
    writeFileSync(temp, source, { encoding: 'utf8', flag: 'wx', mode });
    check();
    renameSync(temp, file);
  } finally {
    try { unlinkSync(temp); } catch (error) { missingAsEmpty(error); }
  }
}
