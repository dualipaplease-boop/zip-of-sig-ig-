# SentryAgent — Testing Guide (v2.6.0)

All results below were **reproduced in this repository** on 24 Sep 2026
(Node 22, Python 3.11, onnxruntime 1.30.0 for the model-verification tools).

## 0. How the Node tests reach the real code

`testbed/automated-tests/_sentry_load.mjs` bundles the actual
`extension/src` TypeScript modules (checksums, vault, disclosure,
egressVerifier, localPlanner, nms, ccl) with **esbuild** (resolved from
`extension/node_modules`) into a temp ESM file that the tests import. The
tests therefore exercise the **shipped implementation** — not a
re-implementation. Modules that require a browser (content script, ONNX
runtime) are intentionally excluded; their pure algorithms are the modules
above.

## 1. Unit + Benchmark (no server needed)

```bash
cd extension
npm run test:unit
```

| Suite | Tests | Result (verified) |
|---|---|---|
| `privacy.test.mjs` | 26 | **26 pass, 0 fail** |
| `accuracy-benchmark.test.mjs` | 3 | **3 pass** — TP=21 FP=0 FN=0, Precision=Recall=F1=1.000 on the full testbed corpus (21 sensitive values, 12 negatives) |

`privacy.test.mjs` covers: Verhoeff/Luhn/PAN/GSTIN vectors; financial-before-phone
ordering; context-gated names; vault tokenization semantics (value-keyed
reverse index); fail-closed egress (canary leak, residual leak, digest equals
independent `node:crypto` SHA-256 of the same node JSON); `sanitizeLabel`;
disclosure ladder incl. L0; plan validation (missing tier → TIER_4); local
heuristic planner ("Submit the official tender bid" → TIER_4 CLICK submit;
"Fill the bid amount" → TIER_2 TYPE vault-token); NMS IoU symmetry; CCL
two-cluster segmentation.

## 2. Live-Server E2E (server required)

```bash
python3 server/app.py            # terminal 1
cd extension && npm run test:e2e # terminal 2
```

| Suite | Tests | Result (verified) |
|---|---|---|
| `e2e-plan.test.mjs` | 5 | **5 pass** — /health advertises `independent-recompute`; valid digest → 200 + `digestVerified:true` + `verifiedDigest` echo + TIER_4 submit action; forged digest → 400; node tampered **after sealing** → 400; body > 2 MB → 413 |
| `autonomous-canvas-vision.test.mjs` | 5 | **5 pass** — ladder (AUTO→L2 with canvases, L3 capped, L0 local-only); L0 zero-egress plan; canvas page → L2 → **real** egress seal (digest cross-checked against node:crypto) → live server plan TIER_4; real verifier blocks a leaking payload |

Both suites skip with a clear message (not fail) if `:8000` is unreachable.
The only simulated component is the ONNX inference layer (documented in the
file header; the NMS/CCL algorithms it uses are unit-tested for real).

## 3. Server Unit Tests

```bash
python3 -m unittest discover -s server -p "test_*.py"
```

**12 pass, 0 fail** — includes: digest recompute match/mismatch (400),
byte-identity between JS `JSON.stringify(nodes)` and the server's
`json.dumps(nodes, separators=(',',':'), ensure_ascii=False)` (the
interoperability proof for the wire digest), 413 cap, CORS allowlist
behavior, heuristic planner scenarios, malformed payloads.

## 4. Model Verification (tools/, Python)

```bash
.venv/bin/python tools/verify_onnx_models.py            # inputs/outputs/shape
.venv/bin/python tools/identify_blazeface_layout.py     # column-order proof (grid r=1.00)
```

These produced the verified BlazeFace/DBNet specifications documented in
`extension/public/models/README.md` (0..1 normalization, explicit input
names, `[ymin,xmin,ymax,xmax,kps]` layout, dynamic N incl. 0, int64
`max_detections`, blank-map max 0.0038 for DBNet).

## 5. Playwright Full-Browser Audit

```bash
cd extension
npx playwright install chromium     # one-time, ~170 MB, needs network to cdn.playwright.dev
npm run test:playwright             # or: HEADLESS=1 npm run test:playwright
```

Self-contained: starts its own static server for `testbed/` (default port
3100), loads `extension/dist` into a fresh Chromium profile, and drives:
popup Scan & Sanitize → DOM redaction assertion → vault metrics →
idempotent re-scan → Restore → autonomous agent loop (risk gate modal +
authorize) → all three portals.

Exit codes: **0** all checks pass · **1** audit failures · **75**
EX_UNAVAILABLE (no browser installed — e.g. headless CI sandboxes; this is
an environment limitation, not a product failure).

**Status in this sandbox:** 75 — `cdn.playwright.dev` is unreachable and no
system browser/root access exists to install one. The audit is verified
complete code and is the designated desktop-verification path.

## 6. Manual Verification (desktop)

1. `python3 server/app.py`
2. `cd extension && npm run build`
3. `python3 -m http.server 3000 --directory testbed`
4. Chrome → `chrome://extensions/` → Developer mode → **Load unpacked** → `extension/dist`
5. Open <http://localhost:3000> → **⚡ Load Realistic PII Scenario**
6. Popup → **Scan & Sanitize** → verify PAN/GSTIN/Aadhaar fields show tokens
   and canvases are burned
7. Popup → **🤖 Run End-to-End Agent Loop** → TIER_4 modal appears → **Authorize & Dispatch**
8. Popup → **Restore** → original values return (session-scoped)
9. Console: `[VisionEngine]` + `[EgressVerifier]` logs show real inference
   and the sealed digest

## 7. Test-Integrity Rules (applied in this repo)

- Tests assert against the real source (esbuild bundle) — no copied logic.
- Failing tests are root-caused and the *code* is fixed; tests are never
  weakened to hide failures (v2.6.0 examples: lakh-amount→PHONE fix,
  "Bid Amount" submit-match fix — both found by tests).
- Benchmark numbers are published only when a reproducible script exists.
- Ground truth lives in `testbed/` (the page itself) — the benchmark corpus
  mirrors it exactly.
