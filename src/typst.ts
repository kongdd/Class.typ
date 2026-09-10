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
      window.$typst.setCompilerInitOptions({
        getModule: () =>
          `${cdn}/@myriaddreamin/typst-ts-web-compiler@${version}/pkg/typst_ts_web_compiler_bg.wasm`,
      });
      window.$typst.setRendererInitOptions({
        getModule: () =>
          `${cdn}/@myriaddreamin/typst-ts-renderer@${version}/pkg/typst_ts_renderer_bg.wasm`,
      });
      window.$typst.use(
        window.TypstSnippet.fetchPackageRegistry(),
        window.TypstSnippet.preloadFontFromUrl('/cjk.ttf'),
      );
    });
  }
  return ready;
}

export async function renderSvg(source: string) {
  await initTypst();
  return window.$typst.svg({ mainContent: source });
}
