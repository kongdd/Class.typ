/// <reference types="vite/client" />

interface Window {
  $typst: {
    setCompilerInitOptions: (opts: unknown) => void;
    setRendererInitOptions: (opts: unknown) => void;
    use: (...args: unknown[]) => void;
    svg: (opts: { mainContent: string }) => Promise<string>;
  };
  TypstSnippet: {
    preloadFontFromUrl: (url: string) => unknown;
  };
}
