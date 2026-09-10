import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, watch } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

const root = dirname(fileURLToPath(import.meta.url));
const contentRoot = join(root, 'content');
const docFiles = { tutorial: '课件.typ', notes: '笔记.typ' };
const juliaProject = join(root, 'julia');
const juliaServices = {
  pluto: {
    name: 'Pluto',
    port: Number(process.env.PLUTO_PORT ?? 8767),
    path: '/pluto/',
    upstreamPath: '/pluto/',
  },
  slider: {
    name: 'PlutoSliderServer',
    port: Number(process.env.PLUTO_SLIDER_PORT ?? 8768),
    path: '/slider/',
    upstreamPath: '/',
  },
};
for (const service of Object.values(juliaServices)) {
  service.target = `http://127.0.0.1:${service.port}${service.upstreamPath}`;
}
const cjkFontPath = [
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
  '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
].find(existsSync);

export function extractTypst(text) {
  return (text.match(/```(?:typst)?\s*\n([\s\S]*?)```/i)?.[1] ?? text).trim();
}

function assertId(id) {
  if (typeof id !== 'string' || !id || /[\\/]|\.\./.test(id)) throw new Error('非法章节');
  return id;
}

async function loadChapters() {
  const dirs = (await readdir(contentRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  return Promise.all(
    dirs.map(async id => {
      const dir = join(contentRoot, id);
      const read = name => readFile(join(dir, name), 'utf8').catch(() => '');
      return {
        id,
        title: id,
        tutorial: await read(docFiles.tutorial),
        notes: await read(docFiles.notes),
      };
    }),
  );
}

async function saveChapter(id, tutorial, notes) {
  const dir = join(contentRoot, assertId(id));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, docFiles.tutorial), tutorial, 'utf8'),
    writeFile(join(dir, docFiles.notes), notes, 'utf8'),
  ]);
}

async function createAgentService() {
  const modelRuntime = await ModelRuntime.create();
  const available = [...(await modelRuntime.getAvailable())].sort((a, b) =>
    `${a.provider}/${a.name ?? a.id}`.localeCompare(`${b.provider}/${b.name ?? b.id}`),
  );
  if (!available.length) throw new Error('Pi 未配置可用模型');

  const models = available.map(model => ({
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
    thinkingLevels: getSupportedThinkingLevels(model),
  }));
  const piSettings = SettingsManager.create(root, getAgentDir());
  const defaultThinkingLevel = piSettings.getDefaultThinkingLevel() ?? 'off';
  const preferredProvider = process.env.PI_PROVIDER ?? piSettings.getDefaultProvider();
  const preferredModel = process.env.PI_MODEL ?? piSettings.getDefaultModel();
  const defaultModel =
    models.find(model => model.provider === preferredProvider && model.id === preferredModel) ??
    models[0];
  const modelByKey = new Map(available.map(model => [`${model.provider}\0${model.id}`, model]));

  const sessionSettings = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: getAgentDir(),
    settingsManager: sessionSettings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: [
      'You edit Typst source code.',
      'Return only the complete valid Typst source.',
      'Do not use Markdown fences or add explanations.',
      'Preserve content that the user did not ask to change.',
    ].join(' '),
    appendSystemPrompt: [],
  });
  await resourceLoader.reload();

  return {
    models,
    defaultModel,
    defaultThinkingLevel,
    async revise(source, instruction, provider, modelId, thinkingLevel) {
      const model = modelByKey.get(`${provider}\0${modelId}`);
      if (!model) throw new Error(`模型不可用：${provider}/${modelId}`);
      if (!getSupportedThinkingLevels(model).includes(thinkingLevel)) {
        throw new Error(`Thinking Level 不可用：${thinkingLevel}`);
      }

      const { session } = await createAgentSession({
        cwd: root,
        model,
        thinkingLevel,
        modelRuntime,
        noTools: 'all',
        resourceLoader,
        sessionManager: SessionManager.inMemory(root),
        settingsManager: sessionSettings,
      });
      let output = '';
      const unsubscribe = session.subscribe(event => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          output += event.assistantMessageEvent.delta;
        }
      });

      try {
        await session.prompt(`User request:\n${instruction}\n\nCurrent Typst source:\n${source}`);
        if (!output.trim()) {
          throw new Error(session.agent.state.errorMessage ?? '模型未返回内容');
        }
        return extractTypst(output);
      } finally {
        unsubscribe();
        session.dispose();
      }
    },
  };
}

async function readJson(request, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function runCode(lang, code) {
  const cmd = lang === 'julia' ? process.env.JULIA || 'julia' : process.env.RSCRIPT || 'Rscript';
  const args = lang === 'julia' ? ['--startup-file=no', '-e', code] : ['-e', code];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('运行超时'));
    }, 20_000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status });
    });
  });
}

async function waitForJuliaService(service, child) {
  let spawnError;
  child.once('error', error => {
    spawnError = error;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`${service.name} 已退出：${child.exitCode}`);
    try {
      const secret = service.secret ? `?secret=${service.secret}` : '';
      const response = await fetch(service.target + secret, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return service.path + secret;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${service.name} 启动超时`);
}

function startJuliaService(service) {
  if (service.ready) return service.ready;
  const notebooks = JSON.stringify(join(juliaProject, 'notebooks'));
  service.secret = service === juliaServices.pluto ? randomBytes(16).toString('hex') : '';
  const code =
    service === juliaServices.pluto
      ? `using Pluto; options = Pluto.Configuration.from_flat_kwargs(; host="127.0.0.1", port=${service.port}, base_url="${service.path}", launch_browser=false); Pluto.run(Pluto.ServerSession(; options, secret="${service.secret}"))`
      : `using PlutoSliderServer; PlutoSliderServer.run_directory(${notebooks}; SliderServer_port=${service.port}, SliderServer_host="127.0.0.1", SliderServer_watch_dir=true, Export_baked_notebookfile=false)`;
  const child = spawn(
    process.env.JULIA || 'julia',
    [`--project=${juliaProject}`, '--startup-file=no', '-e', code],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  service.process = child;
  child.once('exit', () => {
    if (service.process !== child) return;
    service.process = undefined;
    service.ready = undefined;
    service.secret = undefined;
  });
  service.ready = waitForJuliaService(service, child).catch(error => {
    child.kill();
    throw error;
  });
  return service.ready;
}

function proxyPath(requestUrl, service) {
  return service.upstreamPath + requestUrl.slice(service.path.length);
}

function proxyHttp(request, response, service) {
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: service.port,
      path: proxyPath(request.url ?? service.path, service),
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${service.port}` },
    },
    source => {
      response.writeHead(source.statusCode ?? 502, source.headers);
      source.pipe(response);
    },
  );
  upstream.on('error', error => {
    if (response.headersSent) response.destroy(error);
    else sendJson(response, 502, { error: String(error.message ?? error) });
  });
  request.pipe(upstream);
}

function proxyUpgrade(request, socket, head, service) {
  const upstream = connect(service.port, '127.0.0.1', () => {
    const headers = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const lower = name.toLowerCase();
      const value =
        lower === 'host'
          ? `127.0.0.1:${service.port}`
          : lower === 'origin'
            ? `http://127.0.0.1:${service.port}`
            : request.rawHeaders[index + 1];
      headers.push(`${name}: ${value}`);
    }
    upstream.write(
      `${request.method} ${proxyPath(request.url ?? service.path, service)} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`,
    );
    if (head.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

process.once('exit', () => {
  for (const service of Object.values(juliaServices)) service.process?.kill();
});

async function main() {
  await mkdir(contentRoot, { recursive: true });
  const liveClients = new Set();
  let liveState = { activeId: '', chapters: await loadChapters() };
  liveState.activeId = liveState.chapters[0]?.id ?? '';
  const broadcast = () => {
    const payload = `data: ${JSON.stringify(liveState)}\n\n`;
    for (const client of liveClients) client.write(payload);
  };
  const refresh = async () => {
    liveState = { ...liveState, chapters: await loadChapters() };
    broadcast();
  };
  let watchTimer;
  watch(contentRoot, { recursive: true }, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => refresh().catch(console.warn), 150);
  });
  const [cjk, agent, vite] = await Promise.all([
    cjkFontPath ? readFile(cjkFontPath) : null,
    createAgentService().catch(error => {
      console.warn(error);
      return null;
    }),
    process.argv.includes('--dev')
      ? import('vite').then(({ createServer }) =>
          createServer({
            configFile: join(root, 'vite.config.ts'),
            server: { middlewareMode: true, allowedHosts: true },
            appType: 'spa',
          }),
        )
      : null,
  ]);

  const server = createServer(async (request, response) => {
    const url = (request.url ?? '/').split('?')[0];
    const juliaService = Object.values(juliaServices).find(service => url.startsWith(service.path));

    if (juliaService) {
      try {
        await startJuliaService(juliaService);
        return proxyHttp(request, response, juliaService);
      } catch (error) {
        return sendJson(response, 502, { error: String(error.message ?? error) });
      }
    }
    if (request.method === 'GET' && url === '/cjk.ttf' && cjk) {
      response.writeHead(200, { 'Content-Type': 'font/ttf' });
      return response.end(cjk);
    }
    if (
      request.method === 'GET' &&
      (url === '/api/pluto' || url === '/api/pluto-slider')
    ) {
      try {
        const service = url === '/api/pluto' ? juliaServices.pluto : juliaServices.slider;
        return sendJson(response, 200, { url: await startJuliaService(service) });
      } catch (error) {
        return sendJson(response, 500, { error: String(error.message ?? error) });
      }
    }
    if (request.method === 'GET' && url === '/api/models') {
      if (!agent) return sendJson(response, 500, { error: 'Pi 未配置可用模型' });
      return sendJson(response, 200, {
        models: agent.models,
        defaultModel: agent.defaultModel,
        defaultThinkingLevel: agent.defaultThinkingLevel,
      });
    }
    if (request.method === 'GET' && url === '/api/chapters') {
      return sendJson(response, 200, liveState);
    }
    if (request.method === 'PUT' && url === '/api/file') {
      try {
        const body = await readJson(request, 500_000);
        if (typeof body.tutorial !== 'string' || typeof body.notes !== 'string') {
          return sendJson(response, 400, { error: '请求参数无效' });
        }
        await saveChapter(body.id, body.tutorial, body.notes);
        await refresh();
        return sendJson(response, 200, { ok: true });
      } catch (error) {
        return sendJson(response, 400, { error: String(error.message ?? error) });
      }
    }
    if (request.method === 'GET' && url === '/api/live') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      liveClients.add(response);
      response.write(`data: ${JSON.stringify(liveState)}\n\n`);
      request.on('close', () => liveClients.delete(response));
      return;
    }
    if (request.method === 'POST' && url === '/api/live') {
      try {
        const body = await readJson(request);
        if (typeof body.activeId !== 'string') return sendJson(response, 400, { error: '请求参数无效' });
        liveState = { ...liveState, activeId: body.activeId };
        broadcast();
        return sendJson(response, 200, { ok: true });
      } catch (error) {
        return sendJson(response, 400, { error: String(error.message ?? error) });
      }
    }
    if (request.method === 'POST' && url === '/api/run') {
      try {
        const body = await readJson(request, 40_000);
        if ((body.lang !== 'julia' && body.lang !== 'r') || typeof body.code !== 'string') {
          return sendJson(response, 400, { error: '请求参数无效' });
        }
        return sendJson(response, 200, await runCode(body.lang, body.code));
      } catch (error) {
        return sendJson(response, 500, { error: String(error.message ?? error) });
      }
    }
    if (request.method === 'POST' && url === '/api/agent') {
      if (!agent) return sendJson(response, 500, { error: 'Pi 未配置可用模型' });
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return sendJson(response, 400, { error: String(error.message ?? error) });
      }
      if (
        typeof body.source !== 'string' ||
        typeof body.instruction !== 'string' ||
        typeof body.provider !== 'string' ||
        typeof body.model !== 'string' ||
        typeof body.thinkingLevel !== 'string' ||
        !body.instruction.trim() ||
        body.source.length > 90_000 ||
        body.instruction.length > 8_000
      ) {
        return sendJson(response, 400, { error: '请求参数无效' });
      }
      try {
        return sendJson(response, 200, {
          source: await agent.revise(
            body.source,
            body.instruction.trim(),
            body.provider,
            body.model,
            body.thinkingLevel,
          ),
        });
      } catch (error) {
        return sendJson(response, 500, { error: String(error.message ?? error) });
      }
    }

    if (vite) return vite.middlewares(request, response);
    sendJson(response, 404, { error: 'Not found' });
  });

  server.on('upgrade', (request, socket, head) => {
    const service = Object.values(juliaServices).find(item =>
      (request.url ?? '').startsWith(item.path),
    );
    if (!service) return socket.destroy();
    startJuliaService(service)
      .then(() => proxyUpgrade(request, socket, head, service))
      .catch(() => socket.destroy());
  });

  const port = Number(process.env.TYPST_AGENT_PORT ?? 8766);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Typst 课堂: http://127.0.0.1:${port}`);
  });
}

if (process.argv.includes('--self-test')) {
  assert.equal(extractTypst('```typst\n= Hello\n```'), '= Hello');
  assert.equal(extractTypst('= Hello'), '= Hello');
  console.log('self-test passed');
} else {
  await main();
}
