// Loads the REAL extension TypeScript sources into Node via an esbuild bundle,
// so automated tests exercise the shipped implementation (not a re-implementation).
//
// esbuild is resolved from extension/node_modules (createRequire against the
// extension package). The bundled modules here are dependency-free (pure TS) —
// the Chrome-API and onnxruntime-web modules are intentionally excluded.
//
// Usage:
//   const sentry = await loadSentryModules();
//   sentry.validateVerhoeff('999999990019') // true

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXT_ROOT = path.resolve(__dirname, '../../extension');

let cached = null;

export async function loadSentryModules() {
  if (cached) return cached;

  const extRequire = createRequire(path.join(EXT_ROOT, 'package.json'));
  const esbuild = extRequire('esbuild');

  const stamp = `${process.pid}-${Date.now()}`;
  const entry = path.join(os.tmpdir(), `sentry-test-entry-${stamp}.ts`);
  const outfile = path.join(os.tmpdir(), `sentry-test-bundle-${stamp}.mjs`);

  const modules = [
    'src/privacy/checksums.ts',
    'src/privacy/vault.ts',
    'src/privacy/disclosure.ts',
    'src/network/egressVerifier.ts',
    'src/execution/localPlanner.ts',
    'src/vision/nms.ts',
    'src/vision/ccl.ts'
  ];
  fs.writeFileSync(
    entry,
    modules.map(m => `export * from ${JSON.stringify(path.join(EXT_ROOT, m))};\n`).join('')
  );

  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      outfile,
      logLevel: 'silent'
    });
    cached = await import(pathToFileURL(outfile).href);
    return cached;
  } finally {
    fs.rmSync(entry, { force: true });
    // keep outfile for debugging on failure; remove on success
    if (cached) fs.rmSync(outfile, { force: true });
  }
}
