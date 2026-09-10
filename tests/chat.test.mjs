// Run with the app on :8766 and Playwright installed (or set PLAYWRIGHT_MODULE).
// All API calls and Typst rendering are mocked; no model usage or content writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const requests = [];
const writes = [];
const chapters = [
  { id: '01', title: '01 · 课程导论', tutorial: '= 教学目标', notes: '= 课堂笔记\n待补充内容' },
  { id: '02', title: '02 · 方法与实践', tutorial: '= 方法', notes: '= 方法笔记' },
];
let fail = false;
let pending;
let runResult = { stdout: '42', stderr: 'warning: example', status: 0 };
page.on('pageerror', error => errors.push(error.message));
await page.route('**/typst.ts', route => route.fulfill({
  contentType: 'text/javascript',
  body: 'export async function renderSvg() { return `<svg viewBox="0 0 400 500"><rect width="400" height="500" fill="white"/><text x="30" y="60" font-size="20">Typst 课堂 · 测试预览</text></svg>`; }',
}));
await page.route('**/api/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  let body = {};
  let status = 200;
  if (path === '/api/models') body = {
    models: [
      { provider: 'alpha', id: 'a', name: 'Alpha · 课堂模型', thinkingLevels: ['off', 'high'] },
      { provider: 'beta', id: 'b', name: 'Beta · 快速模型', thinkingLevels: ['off'] },
    ],
    defaultModel: { provider: 'alpha', id: 'a' }, defaultThinkingLevel: 'invalid',
  };
  if (path === '/api/chapters') body = { activeId: '01', chapters };
  if (path === '/api/file') writes.push(request.postDataJSON());
  if (path === '/api/agent' || path === '/api/run') {
    const data = request.postDataJSON();
    requests.push({ path, ...data });
    if (pending) await pending;
    status = fail ? 500 : 200;
    body = fail ? { error: '测试连接失败' } : path === '/api/run'
      ? runResult : { source: `${data.source}\n新增内容` };
  }
  if (path === '/api/live' && request.method() === 'GET') {
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ activeId: '01', chapters })}\n\n` });
    return;
  }
  await route.fulfill({ status, json: body }).catch(() => {});
});

async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
async function send(text) {
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}
async function clear() {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await visible(page.getByRole('heading', { name: '一起完善这堂课' }));
}
try {
  await page.goto(process.env.CHAT_TEST_URL || 'http://127.0.0.1:8766');
  await visible(page.getByText('Alpha · 课堂模型', { exact: true }).first());
  await mkdir('images', { recursive: true });
  await page.screenshot({ path: 'images/chat-welcome.png', fullPage: true });
  const chat = page.getByRole('complementary', { name: 'Pi 课堂助手' });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);

  await page.locator('.chat-settings summary').click();
  assert.equal(await page.getByLabel('思考强度').inputValue(), 'off');
  await page.getByLabel('思考强度').selectOption('high');
  await page.getByLabel('服务商', { exact: true }).selectOption('beta');
  assert.equal(await page.getByLabel('模型', { exact: true }).inputValue(), 'b');
  assert.equal(await page.getByLabel('思考强度').inputValue(), 'off');
  await page.locator('.chat-settings summary').click();

  await page.getByRole('button', { name: '润色表述，保留原意' }).click();
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(requests.length, 0, 'IME confirmation must not send');
  await input.press('Shift+Enter');
  assert.match(await input.inputValue(), /\n/);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await visible(page.getByRole('button', { name: '应用修改', exact: true }));
  assert.equal(requests.at(-1).model, 'b');
  assert.equal(requests.at(-1).thinkingLevel, 'off');
  assert.equal(writes.length, 0, 'generation must not write documents');
  await page.locator('.chat-proposal summary').click();
  await page.screenshot({ path: 'images/chat-proposal.png', fullPage: true });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制源码', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '= 教学目标\n新增内容');

  await page.locator('.sidebar nav button').filter({ hasText: '02 · 方法与实践' }).click();
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await visible(page.getByText('请切回原章节后应用修改。'));
  await page.locator('.sidebar nav button').filter({ hasText: '01 · 课程导论' }).click();
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await visible(page.getByRole('button', { name: '已应用', exact: true }));
  await page.waitForResponse(response => response.url().endsWith('/api/file') && response.request().postDataJSON().source.includes('新增内容'));
  assert.equal(writes.at(-1).pane, 'tutorial');
  assert.match(writes.at(-1).source, /新增内容/);

  await clear();
  const notes = page.locator('.pane').nth(1).locator('textarea');
  await notes.click();
  await send('整理笔记');
  await visible(page.getByRole('button', { name: '应用修改', exact: true }));
  await notes.fill('= 手动编辑，必须保留');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await visible(page.getByText('文档已发生变化，请基于最新内容重新发送，避免覆盖。'));
  assert.equal(await notes.inputValue(), '= 手动编辑，必须保留');

  await clear();
  fail = true;
  await send('重试测试');
  await visible(page.getByRole('button', { name: '重试', exact: true }));
  const original = requests.at(-1);
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await visible(page.getByRole('button', { name: '应用修改', exact: true }));
  assert.deepEqual(requests.at(-1), original, 'retry must preserve the original context');

  await clear();
  await send('/r');
  await visible(page.getByText('请选中代码，或在命令后输入代码。'));
  await send('/r print(42)');
  await visible(page.locator('.msg-code'));
  assert.equal(requests.at(-1).code, 'print(42)');
  assert.equal(await page.locator('.msg-code').textContent(), '42\nwarning: example');
  await clear();
  runResult = { stdout: 'partial', stderr: 'execution failed', status: 1 };
  await send('/julia error("test")');
  await visible(page.getByRole('button', { name: '重试', exact: true }));
  assert.match(await page.locator('.msg-code').textContent(), /退出码：1/);
  await clear();
  await notes.click();
  await notes.press('ControlOrMeta+A');
  await visible(page.getByRole('button', { name: '清除选区' }));
  await send('/r');
  await visible(page.locator('.msg-code'));
  assert.equal(requests.at(-1).code, '= 手动编辑，必须保留');
  await page.getByRole('button', { name: '清除选区' }).click();

  await clear();
  let release;
  pending = new Promise(resolve => { release = resolve; });
  await send('停止测试');
  await visible(page.getByRole('button', { name: '停止等待' }));
  await page.getByRole('button', { name: '停止等待' }).click();
  release();
  pending = undefined;
  await visible(page.getByText('已停止等待，不会应用结果；服务端任务可能仍在运行。'));
  await send('停止后继续发送');
  await visible(page.getByRole('button', { name: '应用修改', exact: true }));
  assert.equal(await page.getByRole('button', { name: '应用修改', exact: true }).count(), 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await chat.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'images/chat-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '学生', exact: true }).click();
  assert.equal(await input.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '应用修改', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('chat UI tests passed: model linkage, IME, apply guards, retry, code output, selection, stop, mobile, read-only');
} finally {
  await browser.close();
}
