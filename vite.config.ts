import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  plugins: [react()],
  server: { host: '127.0.0.1' },
  build: { outDir: '../dist', emptyOutDir: true },
});
