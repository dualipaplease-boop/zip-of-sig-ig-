import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        content: resolve(__dirname, 'src/content/content.ts'),
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content') return 'content.js';
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  plugins: [
    {
      name: 'remove-import-meta-for-content-script',
      renderChunk(code, chunk) {
        if (chunk.fileName === 'content.js') {
          return code.replaceAll(
            'import.meta.url',
            '(typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("") : window.location.href)'
          );
        }
        return null;
      }
    },
    {
      name: 'copy-manifest-icons-and-wasm',
      closeBundle() {
        if (!existsSync('dist')) mkdirSync('dist');
        copyFileSync('manifest.json', 'dist/manifest.json');
        
        // Ensure icons directory exists
        const distIcons = resolve(__dirname, 'dist/icons');
        if (!existsSync(distIcons)) mkdirSync(distIcons, { recursive: true });
        
        // Copy icons if present
        if (existsSync('icons')) {
          for (const icon of readdirSync('icons')) {
            copyFileSync(resolve('icons', icon), resolve(distIcons, icon));
          }
        }

        // Copy models directory
        const distModels = resolve(__dirname, 'dist/models');
        if (!existsSync(distModels)) mkdirSync(distModels, { recursive: true });
        if (existsSync('public/models')) {
          for (const m of readdirSync('public/models')) {
            copyFileSync(resolve('public/models', m), resolve(distModels, m));
          }
        }

        // Copy ORT wasm and helper scripts to dist
        const ortDist = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
        if (existsSync(ortDist)) {
          for (const f of readdirSync(ortDist)) {
            if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
              copyFileSync(resolve(ortDist, f), resolve('dist', f));
            }
          }
        }
      }
    }
  ]
});
