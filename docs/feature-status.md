# SentryAgent — Feature Status Matrix (v2.6.0)

Every feature claimed anywhere in the documentation, classified against what
the code **actually does** in this repository. Classification key:

- ✅ **IMPLEMENTED** — works, covered by at least one automated test or a
  verified manual procedure in this repo.
- 🟡 **PARTIAL** — works in a limited scope; the limitation is stated.
- ⚪ **DOCUMENTED-BUT-MISSING** — described in docs/notes but not in code.
- 🔶 **EXPERIMENTAL** — present but not production-hardened.
- 📋 **PLANNED** — backlog only (see docs/BACKLOG.md).

**Obsolete claims are not listed as features** — they are corrections
(docs/CHANGELOG.md v2.6.0 table).

---

## Core Privacy

| Feature | Status | Evidence / Limitation |
|---|---|---|
| Verhoeff (Aadhaar) validation | ✅ | `checksums.ts`; vectors incl. `9999 9999 0019` in `privacy.test.mjs` |
| Luhn (card) validation | ✅ | `checksums.ts`; `4532 0151 1283 0366` vector |
| PAN (entity-char) + GSTIN (embedded PAN) | ✅ | `checksums.ts`; testbed PAN/GSTIN vectors |
| Email / Indian phone+landline / passport | ✅ | whole-value anchored; landline `+91 80 2839 5000` verified |
| Bank account (13–19 digits, Luhn-failing) | ✅ | v2.6: previously dead code, now active → `CONFIDENTIAL_NUM` |
| IFSC code | ✅ | v2.6: `SBIN0001040` classified |
| Financial quote (₹/Rs/INR, lakh grouping) | ✅ | v2.6: checked *before* phone (lakh-amount false-positive fix) |
| Person name (context-gated) | ✅ | field-hint context or `strict` mode (untrusted model values) |
| PII precision/recall benchmark | ✅ | `accuracy-benchmark.test.mjs`: 21/21 recall, 0 FP on testbed corpus |
| Local Inversion Vault (tokenize/rehydrate/mask) | ✅ | `vault.ts`; session-only memory; masked inspection view |
| Canvas pixel redaction (in-place burn) | ✅ | `burnPixelRedaction` — opaque block + watermark at model boxes |
| Tainted-canvas conservative fallback | ✅ | cross-origin canvas → whole-canvas redaction (never egress) |
| Zero-egress guarantee (no raw PII to server) | ✅ | 3-layer egress defense + canary + residual scan; leak tests in `privacy.test.mjs` |

## Vision

| Feature | Status | Evidence / Limitation |
|---|---|---|
| BlazeFace on-device face detection | ✅ | verified spec (0..1 input, `[ymin,xmin,ymax,xmax,kps]`, dynamic N); browser-only runtime; unit-tested parse/NMS paths |
| Per-face confidence scores | ⚪ | **not exposed by the model graph** — reported as 0.5 gate lower bound (documented; no fabricated scores) |
| DBNet on-device text-region detection | ✅ | verified dynamic input, sigmoid heatmap; browser-only runtime |
| Multi-region CCL segmentation | ✅ | `ccl.ts` (pure module, unit-tested) — 2-cluster test |
| Secondary client IoU-NMS | ✅ | `nms.ts` (pure module, unit-tested) |
| Signature-stroke bounding box | ✅ | corner-background sampling (v2.6 fix), works light+dark backgrounds |
| OCR *recognition* (character transcription) | ⚪ | **not implemented** — detection/redaction only (honestly scoped since v2.5) |
| Committed ONNX timing benchmarks | ⚪ | removed — no committed measurement script; models README says so |
| WebGPU acceleration | 🟡 | attempted first, falls back to WASM; not verified in a sandbox (needs a GPU browser) |

## Disclosure & Egress

| Feature | Status | Evidence / Limitation |
|---|---|---|
| L0 (zero egress, local plan) | ✅ | `disclosure.ts` + `localPlanner.ts`; integration test asserts no egress path |
| L1 (anonymized DOM egress) | ✅ | default for `AUTO` on text-only pages |
| L2 (L1 + on-device vision) | ✅ | `AUTO` on canvas pages; canvas-vision integration test |
| L3 (sanitized full frame) | 🟡 **placeholder** | resolves to L2; no full-frame transport exists (documented, not removed) |
| Canary leak detection | ✅ | random per-session canary; block test in `privacy.test.mjs` |
| SHA-256 payload digest | ✅ | client compute + **server independent recompute** (400 on mismatch) |
| Digest as cryptographic signature | ⚪ | **not a signature** (no shared key) — documented as integrity-only since v2.6 |
| Label sanitization (`sanitizeLabel`) | ✅ | v2.6; pattern-validated, overlap-resolving |

## Reasoning & Execution

| Feature | Status | Evidence / Limitation |
|---|---|---|
| Local heuristic planner (L0/offline) | ✅ | mirrors server heuristic; unit-tested incl. "Bid Amount" intent fix |
| Remote LLM planning (Ollama/Groq/OpenAI-compatible) | 🟡 | wired + heuristic fallback; LLM path itself not exercised in CI (needs a local model) |
| Untrusted-plan validation (fail-closed) | ✅ | `validatePlannedAction`; unknown tier → TIER_4; oversized → null |
| 4-tier local risk gate | ✅ | `classifyLocalRisk` + `max(model, local)`; TIER_4 modal 100% textContent |
| TYPE guard (tokens / verified non-sensitive) | ✅ | strict-context classification; model-supplied names rejected |
| NAVIGATE guard (http(s) anchor, no creds) | ✅ | embedded-credential rejection |
| Multi-hop autonomous session (background worker) | ✅ | `background.ts` loop + popup control; survives navigations; per-step local gate |
| End-to-end agent loop (single step) | ✅ | popup button; live-server e2e test |
| Restore (in-session rehydration) | ✅ | vault round-trip test; works until tab close (by design) |
| Multi-hop session abort from popup UI | 🟡 | abort exists via session state; popup shows start/status — a dedicated Abort button is backlog |

## Testbed & Testing

| Feature | Status | Evidence / Limitation |
|---|---|---|
| 3-portal interactive testbed | ✅ | e-Procurement / HR / ISTRAC; ground-truth PII corpus |
| Node unit suite (real TS via esbuild) | ✅ | 26/26 `privacy.test.mjs` |
| PII accuracy benchmark | ✅ | 3/3 `accuracy-benchmark.test.mjs` (P/R/F1 = 1.000) |
| Live-server wire-protocol e2e | ✅ | 5/5 `e2e-plan.test.mjs` (needs `python3 server/app.py`) |
| Canvas vision + disclosure integration | ✅ | 5/5 `autonomous-canvas-vision.test.mjs` (ONNX layer simulated — documented) |
| Server unit tests | ✅ | 12/12 `server/test_app.py` |
| Playwright full-browser audit | 🟡 | complete script, self-contained testbed server, `HEADLESS` env, exit-75 semantics; **not runnable in this headless sandbox** (no browser installable) — runs on desktop with `npx playwright install chromium` |
| `testbed/simulation/` duplicate | — | **removed v2.6** (cmp-verified byte-identical copies) |

## Backlog (planned, not started)

See [BACKLOG.md](BACKLOG.md): session persistence across reloads (would
require encrypted local storage — design decision pending), OCR
recognition, multi-user/auth server mode, GPU benchmark harness.
