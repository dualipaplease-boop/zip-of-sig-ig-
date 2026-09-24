# SentryAgent — Developer Guide (v2.6.0)

## 1. Environment

| Tool | Version used | Notes |
|---|---|---|
| Node.js | ≥ 20 (22 tested) | `npm` ships with it |
| Python | 3.10+ (3.11 tested) | server needs **only the standard library** |
| Chrome | latest stable | MV3, WebGPU optional (WASM fallback) |
| onnxruntime (Python) | 1.30.0 | only for `tools/` model verification (`.venv/`) |
| esbuild | via `extension/node_modules` | used by the Node test loader |

## 2. Daily Workflow

```bash
# build (type-check + bundle)
cd extension && npm run build

# watch mode while iterating on UI/logic
npm run dev                      # vite build --watch

# fast feedback (no server needed)
npm run test:unit

# full loop
python3 server/app.py &          # or: .venv/bin/python server/app.py
npm run test:all                 # unit + benchmark + e2e + integration
```

`npm run build` = `tsc && vite build`. `tsc` uses `strict` — do not
`any`-escape around the egress boundary.

### Build internals (vite.config.ts)

- Entry points: `src/popup/popup.html`, `src/content/content.ts`,
  `src/background/background.ts` → `dist/` with flat `content.js` /
  `background.js` (MV3 requirements) + hashed `assets/`.
- A `renderChunk` plugin rewrites `import.meta.url` inside `content.js`
  (classic-script content scripts have no module scope).
- `closeBundle` copies `manifest.json`, `icons/`, `public/models/*.onnx`,
  and the ORT `.wasm`/`.mjs` files into `dist/` — **the load path for
  Chrome is always `extension/dist`, never `extension/` itself.**
- `onnxruntime-web` is bundled into `content.js` (~448 kB, ~126 kB gzip).

## 3. Adding a New PII Type (checklist)

1. `types/index.ts` — extend `PIIType`.
2. `privacy/checksums.ts`
   - add a validator if a checksum/structure exists (prefer validation over
     regex alone — the whole design is checksum-gated),
   - add it to `classifySensitiveText` at the **right priority** (order
     matters; see the documented sequence; financial must stay before phone),
   - export the validator (tests import it).
3. `privacy/vault.ts` — `getTokenPrefix` for the new type (token shape
   `<PREFIX_N>`).
4. `network/egressVerifier.ts` — if the value can appear inside free text,
   add a `LABEL_PATTERNS` entry with a validator (patterns are
   overlap-resolved; earlier/longer wins).
5. `testbed/automated-tests/privacy.test.mjs` — valid + invalid vectors.
6. `testbed/` ground truth (optional): add the value to a portal and to the
   `accuracy-benchmark.test.mjs` corpus so precision/recall track it.
7. Run `npm run test:unit` — precision must stay at 1.000 on the corpus.

## 4. Adding a Remote Action Verb (do this rarely)

Extend `VALID_ACTIONS` in **both** `execution/localPlanner.ts` and the
server's heuristic — then add a guarded case in
`actionDispatcher.ts`. The guard must fail closed. Unreviewed verbs are the
single most dangerous extension of this system.

## 5. Server

- Stdlib only. `PORT`/`HOST`/`LLM_PROVIDER`/`LLM_API_KEY`/`LLM_BASE_URL`/
  `LLM_MODEL` env vars.
- Wire digest: `SHA-256(json.dumps(nodes, separators=(',',':'), ensure_ascii=False))`.
  If you change the server's canonicalization, update
  `server/test_app.py`'s byte-identity test *and* the client's
  `verifyAndSealPayload` (it uses `JSON.stringify`, which matches for the
  opaque node shapes — non-ASCII is not escaped by either).
- The LLM prompt (SYSTEM_PROMPT) is advisory; the client-side gate is the
  control. Never "fix" a client issue by tightening the prompt alone.

## 6. Testing Conventions

- Node tests import the real modules via `_sentry_load.mjs` (esbuild
  bundle). To test a new pure module, add its path to the `modules` list
  there.
- Live-server suites must **skip with a message** (not fail) when `:8000`
  is down — see `maybeSkip`/`serverReachable` patterns.
- Vision: keep algorithms pure (`nms.ts`, `ccl.ts`) and unit-test those;
  test the ORX glue with the Playwright audit on desktop.
- Never commit unmeasured benchmark numbers (see models README policy).

## 7. Where Things Are (cheat sheet)

| I want to… | Go to |
|---|---|
| Change what counts as sensitive | `extension/src/privacy/checksums.ts` |
| Change token formats | `extension/src/privacy/vault.ts` |
| Change what may egress | `extension/src/network/egressVerifier.ts` |
| Change disclosure policy | `extension/src/privacy/disclosure.ts` |
| Change what the model may do | `extension/src/execution/localPlanner.ts` + `actionDispatcher.ts` |
| Change the on-page confirmation UX | `extension/src/execution/actionDispatcher.ts` (modal section) |
| Change the server's fallback plan | `server/app.py` (`heuristic_goal_planner`) — keep in sync with `localPlanner.ts` |
| Add a portal/PII ground truth | `testbed/index.html` + `testbed/script.js` |
| Record a release | `docs/CHANGELOG.md` (append, never rewrite history) |
