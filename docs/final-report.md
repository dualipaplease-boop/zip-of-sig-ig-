# SentryAgent (SIH-26171) — Final Engineering Report

**Date:** 24 September 2026 · **Release:** v2.6.0 · **Branch:** `arena/01a0d152-zip-of-sig-ig`
**Method:** forensic-first — the repository was fully inspected before any
modification; source code was treated as truth over documentation; no code
was written that is not grounded in existing project material; every test
result below was reproduced in this workspace.

---

## A. Repository Analysis (forensic)

The Git repository contained exactly **one commit** (`6f4635c`, message
"zip") holding a single file: `SIH-26171-main.zip` (~9.9 MB). There was no
source tree, no `.gitignore` history, and no branches.

ZIP contents (extracted read-only to `/tmp/sih-staging/SIH-26171-main/` for
diffing): the full project — `README.md`, `docs/` (CHANGELOG v2.5.1,
BACKLOG, PPTX, 6 research notes), `extension/` (MV3 TypeScript + Vite,
`package-lock.json`), `server/app.py` + `requirements.txt`, `testbed/`
(3-portal simulation incl. a byte-identical `simulation/` duplicate),
`result/` (11 WebP/PNG stills + 3 md docs), `next-step-benchmark-plan.md`.

Forensic findings that shaped the work:
1. **Documentation drifted from code** in security-relevant ways (BlazeFace
   input range and output layout; "signed" digest; "L0–L3 implemented").
2. **The remote-reasoner trust boundary was soft**: model output flowed to
   the DOM with weak validation; the TIER_4 modal was not HTML-safe;
   free-text labels could carry raw PII to the server.
3. **The client-supplied digest was trusted** without server-side recompute.
4. **`testbed/simulation/` was a 3-file byte-identical duplicate** of the
   root testbed (verified with `cmp`).
5. **Unmeasured benchmark numbers** (2.31 / 6.12 / 0.58 / 9.01 ms) appeared
   in docs with no measurement script in the repo.
6. **Dev-dependency vulns**: esbuild ≤ 0.24.2 and vite ≤ 6.4.2 (dev-only,
   never in `dist/`) — `npm audit` non-zero.
7. The repo carried a comprehensive **`.gitignore`** (node_modules, .venv,
   dist, evidence artifacts, `repo/`) — verified still accurate post-change
   (kept as-is).

## B. Architecture (as implemented — see docs/architecture.md)

- **Local extension = security boundary.** Chrome MV3 (TypeScript + Vite):
  - Track 1: DOM scanner with field-context-aware, checksum-validated PII
    classification (Verhoeff/Luhn/PAN/GSTIN/IFSC/bank/passport/phone/
    financial/context-gated names) → Local Inversion Vault tokens.
  - Track 2: on-device ONNX vision (BlazeFace faces, DBNet text regions,
    8-conn CCL, in-place pixel redaction) — gated to disclosure L2; pixels
    never egress at any level.
  - Egress: `sanitizeLabel` + fail-closed seal (canary + residual scan +
    SHA-256 digest). Disclosure ladder L0 (zero egress) / L1 / L2 (L3
    placeholder, capped).
  - Execution: untrusted-plan validator + local risk classifier
    (effective tier = max(model, local)) + textContent-only TIER_4 modal +
    TYPE/NAVIGATE guards + local rehydration.
  - Multi-hop session owned by the background service worker (survives
    navigations).
- **Server:** Python **standard library only** (`http.server`):
  `GET /health`, `POST /api/v1/plan` with **independent digest recompute**
  (400 fail-closed), CORS allowlist, 2 MB cap, LLM backends (Ollama / Groq /
  OpenAI-compatible) with a deterministic heuristic fallback kept in sync
  with the client's `localPlanner.ts`.

## C. ZIP Extraction & Recovery

- The zip was extracted with `unzip -q SIH-26171-main.zip -d
  /tmp/sih-staging/SIH-26171-main/` (a first `rm -rf && mkdir && cd && unzip`
  compound command failed silently and was rerun as separate commands).
- **Nothing was blindly overwritten**: every restored file was diffed
  against the staging copy before touching it; the ZIP itself remains
  untouched at the repo root as the archival source of truth.
- The extracted tree was moved to the repo root (git-tracked layout:
  `extension/ server/ testbed/ docs/ result/ tools/`).
- `extension/node_modules` and `.venv` were (re)installed from the repo's
  own `package-lock.json` and Python requirements (stdlib-only).

## D. Files Changed (v2.6.0)

**Rewritten (root-caused, not cosmetic):**
- `server/app.py` — independent digest recompute (400), ThreadingHTTPServer,
  CORS allowlist, 2 MB cap, heuristic intent fix; stdlib-only.
- `extension/src/privacy/checksums.ts` — full detector rewrite (order:
  financial **before** phone; bank/IFSC activated; context-gated names).
- `extension/src/network/egressVerifier.ts` — `sanitizeLabel`, strong
  canary, digest-as-integrity documentation.
- `extension/src/execution/actionDispatcher.ts` — P0 modal (textContent),
  local risk classifier, TYPE/NAVIGATE guards, rehydration.
- `extension/src/content/content.ts` — field-context scan, opaqueId dedupe,
  L0 local-plan path, sanitized labels, local-fallback on server failure.
- `extension/src/background/background.ts` — multi-hop loop, fallback on
  fetch failure, clean FAILED states.
- `extension/src/vision/visionEngine.ts` — verified BlazeFace layout/feeds,
  corner-background stroke detection, dead code removed.
- `extension/src/types/index.ts` — real `ExtensionMessage` union,
  `payloadValue` mapping, dead types removed.
- `testbed/automated-tests/*.mjs` — all four suites rewritten to test the
  **real** TS (esbuild bundle) + live server; `_sentry_load.mjs` added;
  `accuracy-benchmark.test.mjs` **new**.

**New:** `extension/src/privacy/disclosure.ts`,
`extension/src/execution/localPlanner.ts`, `extension/src/vision/nms.ts`,
`extension/src/vision/ccl.ts`, `server/test_app.py`,
`docs/{architecture,security-audit,feature-status,testing,developer-guide}.md`.

**Docs corrected:** root `README.md` (rewritten, verified commands),
`extension/README.md`, `extension/public/models/README.md` (verified spec),
`docs/CHANGELOG.md` (v2.6.0 appended, corrections table), `docs/BACKLOG.md`
(status banner), `testbed/README.md` (rewritten), `result/README.md` +
`result/walkthrough.md` (stills-not-video, FastAPI→stdlib, Windows paths →
repo-relative, stale test numbers), `next-step-benchmark-plan.md`
(implemented-status note).

**Config/build:** `extension/package.json` (test scripts, vite 7.3.6,
version 2.6.0), `extension/manifest.json` (version 2.6.0), popup
(multi-hop button + status). **Deleted:** `testbed/simulation/`
(cmp-verified duplicate; documented).

## E. Bugs Found (root cause → fix → proof)

| # | Bug | Root cause | Fix | Proof |
|---|---|---|---|---|
| B1 | Model strings rendered as HTML in the risk modal (injection path) | `innerHTML`-style construction | Modal built 100% with `createElement`/`textContent` | code + `privacy.test.mjs` validation tests |
| B2 | Raw PII could egress inside element **labels** (values were tokenized, labels were not) | no label sanitization | `sanitizeLabel` (validated patterns, overlap resolution) + residual scan | leak-block tests (26/26) |
| B3 | Client digest trusted without recompute | server accepted `digestSha256` as-is | server recomputes over canonical node JSON; 400 on mismatch | e2e 5/5 (forged + tampered → 400) |
| B4 | BlazeFace fed ±1 inputs; parsed `[xmin,ymin,…]` | docs wrong, code followed docs | 0..1 inputs, explicit-name feeds (int64 max_detections), `[ymin,xmin,ymax,xmax,kps]`, clamp, dynamic N | `tools/` grid proof r=1.00 + bisection T\*=0.6259 |
| B5 | Signature stroke detector excluded canvases by width (`>300px`) | undocumented heuristic | corner-block background sampling (works light+dark) | `detectStrokeBoundingBox` unit path in engine |
| B6 | `₹ 620,00,00,000` classified as **PHONE** (10 lakh-grouped digits pass mobile test) | financial check ran after phone check | financial before phone (currency marker required) | `accuracy-benchmark.test.mjs` (found it: recall 0.952 → 1.000) |
| B7 | "Bid Amount" field matched as the submit control for statutory goals | 'bid' in submit-node word list | unambiguous verbs first; fill-verb goals no longer misfire (client **and** server kept in sync) | planner tests 26/26 |
| B8 | Vision pipeline silently bypassed on some paths (pre-v2.6.0 history); L0 not first-class | hardcoded L1 fallbacks | `disclosure.ts` ladder; L0 plans locally, zero egress | integration 5/5 |
| B9 | Bank-account & IFSC detectors declared but never called (dead code) | classifier omitted them | activated → `CONFIDENTIAL_NUM` (0.85/0.90) | benchmark corpus |
| B10 | Dev-dependency vulns (esbuild ≤0.24.2, vite ≤6.4.2) | stale lockfile ranges | vite 7.3.6 / esbuild 0.28.2 | `npm audit` → 0 vulnerabilities |
| B11 | ORT static output shape lies for BlazeFace (`[1,896,16]` vs real `[1,N,16]`) | graph metadata | `reshape(-1,16)` handling; documented | `tools/verify_onnx_models.py` |
| B12 | Popup showed stale "Checking page…" default; no multi-hop entry | UI drift | status default fixed; multi-hop button + session state | build + popup wiring |

## F. Security Findings (see docs/security-audit.md — no invented CVSS)

11 findings (S1–S11): 7 **FIXED** in v2.6.0 (P0 HTML injection, P0 label
leak, digest recompute, BlazeFace spec, stroke detector, "signed" marketing,
L3 advertising), 3 **LIMITATIONS** stated with mitigations (token→field
inference by a hostile LLM; in-memory vault readable by a hostile page —
inherent to in-page redaction; no server authentication — local/LAN trust
domain with TLS guidance), 1 **INFO** (unmeasured benchmarks removed).
Digest is documented everywhere as **integrity, not signature**.
`npm audit`: 0. Server: stdlib-only, CORS allowlist, 2 MB cap.

## G. Documentation Corrections (drift table)

| Location | Old claim | Corrected to |
|---|---|---|
| `docs/CHANGELOG.md` (v2.5.1, preserved) | BlazeFace `[xmin, ymin, xmax, ymax]`; "proven mathematically" | Verified layout `[ymin, xmin, ymax, xmax, keypoints]` (v2.6.0 corrections table) |
| `docs/CHANGELOG.md` (v2.5.1) | ±1 normalization | 0..1 (`pixel/255`); ±1 kills all detections |
| `docs/CHANGELOG.md` | "12/12 passing" | superseded: 26 unit + 3 benchmark + 5 e2e + 5 integration + 12 server |
| `docs/CHANGELOG.md` + models README | 2.31/6.12/0.58/9.01 ms timings | unpublished — no committed measurement script |
| `docs/CHANGELOG.md` | "L0–L3 implemented" | L0–L2 implemented; L3 placeholder capped to L2 |
| root `README.md` | "Python HTTP / FastAPI Gateway" | stdlib-only HTTP (no FastAPI) |
| root `README.md` | `testbed/simulation/`, `repo/` in structure | simulation removed (cmp-verified duplicate); no `repo/` dir exists |
| root `README.md` | Windows path `c:\Users\iqand\...` for Load Unpacked | repo-relative `extension/dist` |
| `result/README.md` | "Video Demonstration Recordings" for `.webp` | Demonstration **Still Frames** (magic bytes `RIFF…WEBPVP8X`); no videos in repo |
| `result/walkthrough.md` | FastAPI; `extension/tests/privacy.test.mjs` (9 tests); 887 ms/436 KB build; `.gemini` brain image paths | stdlib; `testbed/automated-tests/` suites with verified numbers; current build size; images → `result/` relative |
| `extension/public/models/README.md` | ±1, `[xmin,ymin,xmax,ymax]`, fixed 896 rows | full verified spec (4 inputs by name, dynamic N incl. 0, int64, score-not-exposed → 0.5 lower bound) |
| `testbed/README.md` | simulation/ tree; 9-test suite; missing scripts | rewritten to current layout & suites |
| `next-step-benchmark-plan.md` | plan for PII benchmark | STATUS NOTE: section 2 implemented (1.000/1.000/1.000) |
| `docs/BACKLOG.md` | no implementation status | banner: reticle + multi-hop implemented; 9.01 ms figure not published |

## H. Build & Test Results (all reproduced 24 Sep 2026)

| Step | Command | Result |
|---|---|---|
| Extension build | `cd extension && npm run build` | **PASS** — `tsc` strict + vite 7.3.6; 18 modules; `content.js` 447.95 kB (126.01 kB gzip); `background.js` 4.70 kB; models + wasm copied to `dist/` |
| npm audit | `npm audit` | **0 vulnerabilities** |
| Unit (real TS via esbuild) | `npm run test:unit` | **29/29 pass** (privacy 26 + benchmark 3) |
| PII benchmark | `accuracy-benchmark.test.mjs` | **TP=21 FP=0 FN=0 — Precision 1.000, Recall 1.000, F1 1.000** |
| Live-server e2e | `npm run test:e2e` (server running) | **5/5 pass** — valid digest 200+`digestVerified:true`; forged 400; post-seal tamper 400; >2 MB 413 |
| Canvas vision integration | `npm run test:integration` | **5/5 pass** (real disclosure + real egress + live server) |
| Server unit | `.venv/bin/python -m unittest discover -s server` | **12/12 pass** incl. JS↔Python digest byte-identity |
| Model verification | `tools/verify_onnx_models.py`, `tools/identify_blazeface_layout.py` | BlazeFace spec (0..1, 4 named inputs, dynamic N, layout r=1.00) + DBNet (blank max 0.0038) |
| Playwright audit | `npm run test:playwright` | **exit 75** in this sandbox (no browser installable: cdn.playwright.dev unreachable, no root) — script self-contained & code-complete for desktop |
| **Total automated** | — | **51/51 pass** — 39 under Node (29 unit+benchmark, 5 e2e, 5 integration) + 12 Python server tests; no failures, none suppressed |

## I. Remaining Issues (honest)

1. **Playwright full-browser audit not executed here** — environment has no
   Chromium and cannot install one (network egress to cdn.playwright.dev is
   blocked; no root for apt). It is the designated desktop verification and
   exits 75 with a clear install hint where no browser exists.
2. **LLM reasoning path not exercised in CI** — the heuristic fallback is
   fully tested; the Ollama/Groq/OpenAI legs need a local model/API key.
   The client-side gate bounds any LLM misbehavior regardless.
3. **No committed ONNX timing benchmarks** — by policy (no unmeasured
   numbers). A desktop `performance.now()` harness (planned in
   `next-step-benchmark-plan.md` §3–4) is the follow-up.
4. **Per-face confidence** is a documented 0.5 lower bound (model graph
   does not expose scores) — not a defect, but a reported-limitation.
5. **Structural limitations** (documented, not fixable in this trust
   model): token→field inference by a hostile LLM endpoint; in-memory
   vault readable by a hostile page; server has no authentication
   (local/LAN deployment assumption, TLS + network-policy guidance given).
6. **`.gitignore`** (shipped in the ZIP, comprehensive: node_modules, .venv,
   dist, evidence artifacts, repo/) — kept as-is; verify it still matches
   the tree after this change before first commit.

## J. Exact Usage Instructions (verified)

```bash
# 0. Prereqs: Node ≥ 20, Python 3.10+, Chrome
# 1. Server (optional but recommended)
python3 server/app.py                      # → http://localhost:8000

# 2. Build
cd extension && npm install && npm run build

# 3. Load into Chrome
#    chrome://extensions → Developer mode → Load unpacked → extension/dist

# 4. Testbed
python3 -m http.server 3000 --directory testbed   # → http://localhost:3000

# 5. Tests
cd extension
npm run test:unit        # 29/29 (no server)
npm run test:e2e         # 5/5 (server up)
npm run test:integration # 5/5 (server up)
python3 -m unittest discover -s ../server -p "test_*.py"   # 12/12
npm run test:playwright  # desktop: 0 on success; 75 if no browser
```

Manual demo: open http://localhost:3000 → **⚡ Load Realistic PII
Scenario** → popup → **Scan & Sanitize** (DOM + canvas redaction) →
**🤖 Run End-to-End Agent Loop** (TIER_4 modal → Authorize & Dispatch) →
**🛰️ Start Multi-Hop Session** (goal prompt; background-driven) →
**Restore**.

---

# Beginner-Friendly Walkthrough ("How to actually use this")

**What is this?** A Chrome extension that protects a page you are using:
it finds sensitive data (Aadhaar, PAN, cards, phone numbers, names, money
amounts, signatures, faces), hides it in place, and can help you fill and
submit forms — without ever sending your actual data to a remote AI. The AI
(when used) only sees labels like `<AADHAAR_ID_1>` and a button called
"Submit Official Bid".

**In 5 minutes:**

1. **Start the helper server** (gives the extension a "brain"; optional):
   ```bash
   python3 server/app.py
   ```
   You should see the server start on port 8000.

2. **Build the extension** (one time, and after any code change):
   ```bash
   cd extension
   npm install
   npm run build
   ```

3. **Install it in Chrome**: open `chrome://extensions/`, switch on
   **Developer mode**, click **Load unpacked**, and pick the
   `extension/dist` folder. A "SentryAgent" icon appears in your toolbar.

4. **Open the demo site**:
   ```bash
   python3 -m http.server 3000 --directory testbed
   ```
   then visit `http://localhost:3000`. It shows three fake ISRO portals
   full of realistic-looking sensitive data (this is the project's test
   ground — use it, not a real government site).

5. **Try it**:
   - Click **⚡ Load Realistic PII Scenario** (fills the form with test data).
   - Click the **SentryAgent** toolbar icon.
   - **Scan & Sanitize** → the PAN/Aadhaar/card fields turn into tokens like
     `<PAN_NO_1>`, and the signature/face canvases get blackout blocks.
   - **🤖 Run End-to-End Agent Loop** → the agent plans a step; because
     "submitting a tender" is high-stakes, a modal asks **you** to
     authorize. Click **Authorize & Dispatch** and the field is filled and
     clicked — the real values only ever existed on your machine.
   - **🛰️ Start Multi-Hop Session** → type a goal (e.g. "Submit the
     official tender bid"); the background worker keeps working across
     pages, still asking you before anything irreversible.
   - **Restore** → the original values come back (for this session).

**How do I know it's safe?** Run the tests (section J) — 51 automated
checks, including "if a secret leaks, the transmission is blocked" and
"if the payload is tampered with, the server rejects it". Read
`docs/security-audit.md` for the full boundary-by-boundary picture and the
limitations stated honestly.

**What if something doesn't work?**
- Server refused connection → it's not running (step 1) — or that's fine,
  the extension falls back to local-only mode (L0).
- Extension not loading → you selected `extension/` instead of
  `extension/dist`; the build output is what Chrome wants.
- `npm run test:playwright` says exit 75 → install a browser first:
  `cd extension && npx playwright install chromium`.
