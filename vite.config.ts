import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  root: 'web',
  publicDir: '../public',
  optimizeDeps: {
    exclude: ['web-tree-sitter']  // Prevent prebundling issues (Vite bug workaround)
  },
  build: {
    target: 'esnext',  // Required for top-level await
    outDir: '../dist/web',
    emptyOutDir: true
  },
  server: {
    port: 3000
  }
});
