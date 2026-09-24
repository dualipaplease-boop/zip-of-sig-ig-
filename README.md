# SentryAgent — Privacy-Preserving Browser Agent

> **Smart India Hackathon (SIH 2026) · Problem Statement SIH26171 (ISRO)**
> **Theme:** Smart Automation / Software
> **Architecture:** Dual-Track Perception with a Local Safety Boundary (trustworthy local–remote hybrid)
> **Current release:** v2.6.0 — see [docs/CHANGELOG.md](docs/CHANGELOG.md)

SentryAgent is a Chrome (Manifest V3) extension that scans a web page for
sensitive data, redacts it in place, and can autonomously complete multi-step
form tasks. Its defining property: **the local extension is the security
boundary.** A remote LLM reasoner (optional) only ever sees opaque node IDs,
semantic tokens, and sanitized labels — never raw PII, never pixels — and its
output is treated as untrusted until it passes the local risk gate.

---

## 1. Directory Structure

```
.
├── extension/                  # Chrome MV3 extension (TypeScript + Vite)
│   ├── src/                    #   modules: privacy/, vision/, execution/, network/, background/, content/, popup/
│   ├── public/models/          #   ONNX models (BlazeFace 536 KB, DBNet 4.7 MB) + verified spec
│   ├── dist/                   #   production build (load THIS into Chrome)
│   ├── manifest.json           #   MV3 manifest (v2.6.0)
│   └── package.json            #   build + test scripts
├── server/                     # Central reasoning engine (Python, standard library only)
│   ├── app.py                  #   POST /api/v1/plan + GET /health, independent digest recompute
│   ├── requirements.txt        #   (no third-party dependencies)
│   └── test_app.py             #   12 unit tests
├── testbed/                    # Interactive 3-portal proving ground + automated tests
│   ├── index.html, script.js, style.css   # e-Procurement / HR / ISTRAC portals (ground-truth PII corpus)
│   ├── automated-tests/        #   Node test suites (unit, benchmark, e2e, integration, playwright)
│   └── evidence/               #   validation artifacts
├── docs/                       # Architecture, security audit, feature status, testing, changelog
├── result/                     # Empirical evidence: portal screenshots/stills + walkthrough
└── tools/                      # ONNX verification scripts (model spec proofs)
```

---

## 2. Quick Start (verified commands)

Prerequisites: **Node.js ≥ 20** (with `npm`), **Python 3.10+** (standard
library only — no pip installs needed for the server).

### Step 1 — Start the reasoning server (optional but recommended)

```bash
python3 server/app.py
# → listens on http://localhost:8000  (GET /health, POST /api/v1/plan)
```

Without the server the extension still works: it falls back to the local
heuristic planner and stays fully functional (zero egress).

### Step 2 — Build the extension

```bash
cd extension
npm install          # first time only
npm run build        # → tsc (strict) + vite build → dist/
```

### Step 3 — Load the extension into Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the **`extension/dist`** directory

### Step 4 — Open the testbed

```bash
# from the repository root:
python3 -m http.server 3000 --directory testbed
```

Then open <http://localhost:3000> in Chrome, click **⚡ Load Realistic PII
Scenario**, and use the SentryAgent popup:

- **Scan & Sanitize** — redacts PII in the DOM and canvas pixels in place
- **🤖 Run End-to-End Agent Loop** — one supervised autonomous step
- **🛰️ Start Multi-Hop Session** — background-worker driven multi-step
  session (survives navigations; every high-stakes step still requires
  on-page confirmation at the Local Risk Gate)
- **Restore** — re-hydrates the original values locally (one session, in-memory)

### Step 5 — Run the tests

```bash
# Node unit + benchmark (no server needed)
cd extension
npm run test:unit        # 26 privacy/security tests + PII accuracy benchmark

# Live-server suites (server from Step 1 must be running)
npm run test:e2e         # wire protocol: valid/forged/tampered digests, 413
npm run test:integration # canvas vision + disclosure ladder + live server

# Server unit tests
python3 -m unittest discover -s server -p "test_*.py"   # 12/12

# Browser audit (needs a Chromium: cd extension && npx playwright install chromium)
npm run test:playwright  # exits 75 (EX_UNAVAILABLE) if no browser is installed
```

Exact expected results for every suite: [docs/testing.md](docs/testing.md).

---

## 3. What the system guarantees (and what it does not)

| Guarantee | How |
|---|---|
| **No raw PII reaches the remote reasoner** | Local Inversion Vault tokenizes values in the DOM; `sanitizeLabel()` scrubs labels; the egress verifier fails closed on any residual known value or canary leak |
| **No pixels leave the device** | Vision (BlazeFace/DBNet ONNX) runs entirely in-browser; only opaque tokens/labels egress |
| **Model output is untrusted** | `validatePlannedAction` rejects structurally invalid actions; the local risk classifier can only raise (never lower) the tier; the TIER_4 modal renders with `textContent` only |
| **Payload integrity** | Client computes a SHA-256 digest; the server **independently recomputes** it and rejects mismatches (HTTP 400). This is an integrity check for a local trust domain — not a cryptographic signature (no shared key); see [docs/security-audit.md](docs/security-audit.md) |
| **High-stakes actions require a human** | TIER_4 actions (submit/authorize/burn) halt at the on-page Local Risk Gate modal |
| **L0 = zero egress** | Disclosure ladder L0 never contacts the server; the local planner produces the plan |

**Limitations (stated honestly):** L3 disclosure is a type-level placeholder
(capped to L2); the Playwright browser audit requires a desktop environment
with a Chromium install; no committed timing benchmarks exist for the ONNX
models (previous millisecond figures were unmeasured and are no longer
published). Full status: [docs/feature-status.md](docs/feature-status.md).

---

## 4. Documentation Map

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | End-to-end data flow, trust boundaries, module map |
| [docs/security-audit.md](docs/security-audit.md) | Boundary-by-boundary audit, findings, digest-as-integrity analysis |
| [docs/feature-status.md](docs/feature-status.md) | Implemented / partial / missing / planned — no pretending |
| [docs/testing.md](docs/testing.md) | Every test suite, exact commands, verified results |
| [docs/developer-guide.md](docs/developer-guide.md) | Dev workflow, adding a PII type, build internals |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Full release history incl. v2.6.0 corrections table |
| [extension/public/models/README.md](extension/public/models/README.md) | Empirically verified ONNX model specifications |
