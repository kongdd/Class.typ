/// <reference types="vite/client" />

interface Window {
  $typst: {
    setCompilerInitOptions: (opts: unknown) => void;
    setRendererInitOptions: (opts: unknown) => void;
    use: (...args: unknown[]) => void;
    addSource: (path: string, source: string) => Promise<void> | void;
    mapShadow: (path: string, content: Uint8Array) => Promise<void> | void;
    svg: (opts: { mainContent?: string; mainFilePath?: string }) => Promise<string>;
  };
  TypstSnippet: {
    fetchPackageRegistry: () => unknown;
    withAccessModel: (model: unknown) => unknown;
    withPackageRegistry: (registry: unknown) => unknown;
    preloadFontFromUrl: (url: string) => unknown;
  };
  TypstCompileModule: {
    MemoryAccessModel: new () => unknown;
    FetchPackageRegistry: new (model: unknown) => any;
  };
}
