# SentryAgent Testbed & Verification Suite

Interactive 3-portal proving ground **plus** the automated test suites. The
testbed is the project's **ground-truth corpus**: every sensitive value on
the page is mirrored in `automated-tests/accuracy-benchmark.test.mjs`, and
the automated suites assert against it.

---

## Directory

```
testbed/
├── index.html               # 3-portal SPA entrypoint (e-Procurement / HR / ISTRAC)
├── script.js                # Portal logic: PII scenario loading, signature canvas, avatar & satellite renderers
├── style.css                # ISRO government + ISTRAC mission-console theming
├── automated-tests/
│   ├── _sentry_load.mjs                  # esbuild loader: bundles real extension/src TS for Node tests
│   ├── privacy.test.mjs                  # 26 unit tests: checksums, vault, egress, disclosure, planner, NMS, CCL
│   ├── accuracy-benchmark.test.mjs       # PII precision/recall/F1 vs full testbed corpus
│   ├── e2e-plan.test.mjs                 # live-server wire protocol (digest verify/forged/tampered/413)
│   ├── autonomous-canvas-vision.test.mjs # disclosure ladder + real egress + live server (ONNX layer simulated, documented)
│   └── playwright-audit.mjs              # full-browser audit of the built extension (exit 75 = no browser)
├── scripts/
│   └── organize_docs.ps1    # (legacy) docs organization helper
└── evidence/                # empirical benchmark records & validation artifacts
```

> **History:** a `simulation/` subdirectory existed as a byte-identical copy
> of the root files; it was removed in v2.6.0 after `cmp` verification.

---

## Serving the testbed page

There is no required fixed port — any static server works:

```bash
# from the repository root:
python3 -m http.server 3000 --directory testbed
# → http://localhost:3000
```

`playwright-audit.mjs` is self-contained: it starts its own static server
(default port 3100, auto-incrementing if busy) and closes it on exit.

## Portal map (ground truth)

| Portal | Tab ID | Key PII (ground truth) | Visual targets |
|---|---|---|---|
| 1. e-Procurement | `#tab-eproc` | name, email, mobile, PAN `AAACA7890B`, GSTIN `29AAACA7890B1Z5`, IFSC `SBIN0001040`, account `98765432109876`, quote items, `₹ 152,800,000.00` total | vector signature pad canvas |
| 2. HR & Deputation | `#tab-hr` | name, email, Aadhaar `9999 9999 0019` (Verhoeff-valid), passport `Z3489127` | procedural biometric avatar canvas |
| 3. ISTRAC Mission Ops | `#tab-mission` | director name, PAN `AAAGP1234M`, Aadhaar (same valid vector), transponder key `4532 0151 1283 0366` (Luhn-valid), budget `₹ 620,00,00,000`, landline `+91 80 2839 5000` | satellite telemetry canvas (600×220, two text clusters), flight-director avatar, TIER_4 "Authorize Orbital Burn" button |

## Running the suites

```bash
# no server needed:
cd extension
npm run test:unit      # privacy.test.mjs (26) + accuracy-benchmark.test.mjs (3)

# with python3 server/app.py running on :8000:
npm run test:e2e       # e2e-plan.test.mjs (5)
npm run test:integration # autonomous-canvas-vision.test.mjs (5)

# desktop with a Chromium installed (cd extension && npx playwright install chromium):
npm run test:playwright   # HEADLESS=1 for headless (new headless mode)
```

Expected verified results: `26/26`, `3/3` (P=R=F1=1.000), `5/5`, `5/5`,
playwright `0` (desktop) / `75` (no browser). Details: [../docs/testing.md](../docs/testing.md).
