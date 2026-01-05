import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Ensure dist directory exists
mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['cli/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',  // Match engines.node requirement
  format: 'esm',
  outfile: 'dist/cli.mjs',
  external: ['web-tree-sitter', 'commander'],  // Loaded at runtime, not bundled
  banner: {
    js: '#!/usr/bin/env node',
  },
});

// Copy WASM files to dist/ so CLI can find them at runtime
// (build-wasm.sh also does this, but this ensures it happens on every build)
try {
  if (existsSync('public/tree-sitter.wasm')) {
    copyFileSync('public/tree-sitter.wasm', 'dist/tree-sitter.wasm');
  }
  if (existsSync('public/tree-sitter-systemverilog.wasm')) {
    copyFileSync('public/tree-sitter-systemverilog.wasm', 'dist/tree-sitter-systemverilog.wasm');
  }
  console.log('CLI build complete. WASM files copied to dist/');
} catch (e) {
  console.warn('Warning: Could not copy WASM files. Run build:wasm first.');
}
