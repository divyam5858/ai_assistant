import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'widget/dist');

async function build() {
  console.log('[Build] Building Standalone AI Assistant SDK...');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const entryPoint = path.resolve(rootDir, 'widget/src/sdk.js');

  // Build standard unminified bundle with sourcemap
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    outfile: path.resolve(distDir, 'assistant.js'),
    format: 'iife',
    globalName: 'AssistantSDKBundle',
    loader: {
      '.css': 'text'
    },
    sourcemap: true,
    target: ['es2020']
  });

  // Build minified production bundle
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    outfile: path.resolve(distDir, 'assistant.min.js'),
    format: 'iife',
    globalName: 'AssistantSDKBundle',
    loader: {
      '.css': 'text'
    },
    sourcemap: false,
    target: ['es2020']
  });

  const stats = fs.statSync(path.resolve(distDir, 'assistant.js'));
  const minStats = fs.statSync(path.resolve(distDir, 'assistant.min.js'));

  console.log(`[Build] Bundle generated: widget/dist/assistant.js (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`[Build] Minified bundle: widget/dist/assistant.min.js (${(minStats.size / 1024).toFixed(1)} KB)`);
  console.log('[Build] Build completed successfully.');
}

build().catch(err => {
  console.error('[Build] Build failed:', err);
  process.exit(1);
});

