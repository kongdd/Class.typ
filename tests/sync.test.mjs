// All documents and APIs are mocked. This test never writes the real content/ directory.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
const live = { activeId: '01', chapters: [
  { id: '01', title: '第一章', tutorial: 'tutorial on disk', notes: 'notes on disk' },
  { id: '02', title: '第二章', tutorial: 'second tutorial', notes: 'second notes' },
] };
const writes = [];
const errors = [];
let hold;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(initial => {
  const clients = new Set();
  window.publishDocuments = live => {
    window.latestDocuments = live;
    for (const client of clients) client.onmessage?.({ data: JSON.stringify(live) });
  };
  window.latestDocuments = initial;
  window.EventSource = class {
    constructor() {
      clients.add(this);
      setTimeout(() => {
        if (clients.has(this)) this.onmessage?.({ data: JSON.stringify(window.latestDocuments) });
      }, 0);
    }
    close() { clients.delete(this); }
  };
}, live);
await page.route('**/typst.ts', route => route.fulfill({
  contentType: 'text/javascript', body: 'export async function renderSvg() { return "<svg />"; }',
}));
const publish = () => page.evaluate(live => window.publishDocuments(live), live);
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/models') return route.fulfill({ json: {
    models: [{ provider: 'test', id: 'test', name: 'Test model', thinkingLevels: ['off'] }],
    defaultModel: { provider: 'test', id: 'test' }, defaultThinkingLevel: 'off',
  } });
  if (path === '/api/file') {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (hold) await hold;
    const target = live.chapters.find(item => item.id === body.id);
    if (target[body.pane] !== body.base) return route.fulfill({ status: 409, json: {
      error: '磁盘文件已更新，保存已阻止；网页草稿仍保留。',
    } });
    target[body.pane] = body.source;
    await publish();
  }
  return route.fulfill({ json: { ok: true } });
});
const tutorialPane = page.locator('.pane').nth(0);
const notesPane = page.locator('.pane').nth(1);
const tutorial = tutorialPane.locator('textarea');
const notes = notesPane.locator('textarea');
const saveResponse = source => page.waitForResponse(response => response.url().endsWith('/api/file')
  && response.request().postDataJSON().source === source);
try {
  await page.goto(process.env.CHAT_TEST_URL || 'http://127.0.0.1:8766');
  await page.getByRole('button', { name: '第一章', exact: true }).waitFor();
  await tutorialPane.getByRole('button', { name: '编辑', exact: true }).click();
  await tutorialPane.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '第二章', exact: true }).click();
  await page.getByRole('button', { name: '学生', exact: true }).click();
  await page.getByRole('button', { name: '教师', exact: true }).click();
  await page.getByRole('button', { name: '第一章', exact: true }).click();
  await tutorialPane.getByRole('button', { name: '编辑', exact: true }).click();
  await page.waitForTimeout(650);
  assert.equal(writes.length, 0, 'navigation, edit tabs and role changes must not save');

  live.chapters[0].tutorial = 'new tutorial from local editor';
  live.chapters[0].notes = 'new notes from local editor';
  await publish();
  assert.equal(await tutorial.inputValue(), live.chapters[0].tutorial);
  assert.equal(await notes.inputValue(), live.chapters[0].notes);
  await page.waitForTimeout(650);
  assert.equal(writes.length, 0, 'incoming disk changes must not echo back as writes');

  let saved = saveResponse('web notes');
  await notes.fill('web notes');
  assert.equal((await saved).status(), 200);
  assert.deepEqual(writes.at(-1), { id: '01', pane: 'notes', base: 'new notes from local editor', source: 'web notes' });
  assert.equal(live.chapters[0].tutorial, 'new tutorial from local editor');

  saved = saveResponse('unsaved web draft');
  await notes.fill('unsaved web draft');
  live.chapters[0].notes = 'conflicting disk edit';
  await publish();
  assert.equal(await notes.inputValue(), 'unsaved web draft', 'SSE must preserve unsaved drafts');
  assert.equal((await saved).status(), 409);
  await page.getByText('磁盘文件已更新，保存已阻止；网页草稿仍保留。').waitFor();
  assert.equal(live.chapters[0].notes, 'conflicting disk edit');
  assert.equal(await notes.inputValue(), 'unsaved web draft');
  assert.match(await page.getByRole('link', { name: '下载网页草稿' }).getAttribute('href'), /unsaved%20web%20draft/);
  const count = writes.length;
  await publish();
  await page.waitForTimeout(650);
  assert.equal(writes.length, count, 'conflicts must not automatically retry');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '放弃网页修改' }).click();
  assert.equal(await notes.inputValue(), 'conflicting disk edit');

  let release;
  hold = new Promise(resolve => { release = resolve; });
  const started = page.waitForRequest(request => request.url().endsWith('/api/file'));
  await notes.fill('first edit');
  await started;
  await notes.fill('typed while saving');
  await page.getByRole('button', { name: '第二章', exact: true }).click();
  saved = saveResponse('typed while saving');
  release();
  hold = undefined;
  assert.equal((await saved).status(), 200);
  assert.equal(writes.at(-1).base, 'first edit');
  assert.equal(writes.at(-1).id, '01');
  assert.equal(live.chapters[1].notes, 'second notes', 'in-flight saves must stay bound to the original chapter');
  await page.getByRole('button', { name: '第一章', exact: true }).click();
  assert.equal(await notes.inputValue(), 'typed while saving');
  assert.deepEqual(errors, []);
  console.log('sync UI tests passed: live teacher updates, no navigation writes, per-file save, conflict preservation, in-flight edits');
} finally {
  await browser.close();
}
