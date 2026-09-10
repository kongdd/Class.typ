const cdn = 'https://cdn.jsdelivr.net/npm';
const version = '0.8.0-rc3';

let ready: Promise<void> | null = null;

function waitTypst() {
  if (window.$typst) return Promise.resolve();
  return new Promise<void>(resolve => {
    document.getElementById('typst')?.addEventListener('load', () => resolve(), { once: true });
  });
}

export function initTypst() {
  if (!ready) {
    ready = waitTypst().then(() => {
      const { MemoryAccessModel, FetchPackageRegistry } = window.TypstCompileModule;
      class LocalPackageRegistry extends FetchPackageRegistry {
        resolvePath(spec: { namespace: string; name: string; version: string }) {
          if (spec.namespace === 'local') {
            return `/packages/${spec.namespace}/${spec.name}-${spec.version}.tar.gz`;
          }
          return super.resolvePath(spec);
        }
        resolve(
          spec: { namespace: string; name: string; version: string },
          context: {
            untar: (data: Uint8Array, cb: (path: string, data: Uint8Array, mtime: number) => void) => void;
          },
        ) {
          if (spec.namespace !== 'local') return super.resolve(spec, context);
          const url = this.resolvePath(spec);
          if (this.cache.has(url)) return this.cache.get(url)!();
          const data = this.pullPackageData(spec);
          if (!data) return;
          const dir = `/@memory/fetch/packages/${spec.namespace}/${spec.name}/${spec.version}`;
          const entries: [string, Uint8Array, Date][] = [];
          context.untar(data, (path, bytes, mtime) => {
            entries.push([`${dir}/${path.replace(/^\.\//, '')}`, bytes, new Date(mtime)]);
          });
          const write = () => {
            for (const [path, bytes, time] of entries) this.am.insertFile(path, bytes, time);
            return dir;
          };
          this.cache.set(url, write);
          return write();
        }
      }
      const memory = new MemoryAccessModel();
      window.$typst.setCompilerInitOptions({
        getModule: () =>
          `${cdn}/@myriaddreamin/typst-ts-web-compiler@${version}/pkg/typst_ts_web_compiler_bg.wasm`,
      });
      window.$typst.setRendererInitOptions({
        getModule: () =>
          `${cdn}/@myriaddreamin/typst-ts-renderer@${version}/pkg/typst_ts_renderer_bg.wasm`,
      });
      window.$typst.use(
        window.TypstSnippet.withAccessModel(memory),
        window.TypstSnippet.withPackageRegistry(new LocalPackageRegistry(memory)),
        window.TypstSnippet.preloadFontFromUrl('/cjk.ttf'),
      );
    });
  }
  return ready;
}

function assetsFrom(source: string) {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:image|bibliography|csv)\(\s*"([^"]+)"/g)) {
    const path = m[1].replace(/^\.\//, '');
    if (!path.startsWith('/') && !path.includes(':')) out.push(path);
  }
  return out;
}

export async function renderSvg(source: string, dir = 'doc') {
  await initTypst();
  const main = `/${dir}/main.typ`;
  await window.$typst.addSource(main, source);
  await Promise.all(
    assetsFrom(source).map(async name => {
      const res = await fetch(encodeURI(`/files/${dir}/${name}`));
      if (!res.ok) return;
      const buf = new Uint8Array(await res.arrayBuffer());
      const path = `/${dir}/${name}`;
      if (/\.(typ|bib|txt|csv)$/i.test(name)) {
        await window.$typst.addSource(path, new TextDecoder().decode(buf));
      } else {
        await window.$typst.mapShadow(path, buf);
      }
    }),
  );
  return window.$typst.svg({ mainFilePath: main });
}
