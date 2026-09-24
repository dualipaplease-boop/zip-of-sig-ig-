# SentryAgent Browser Extension (Manifest V3)

**Target:** Chrome / Chromium Browsers (Manifest V3, TypeScript, Vite)  
**Security Guarantee:** Zero-PII Egress Boundary with On-Device Neural Vision  

---

## Directory Organization & Module Architecture

```
extension/
├── public/
│   └── models/               # Standalone ONNX Neural Network Weights
│       ├── blazeface.onnx    # 536 KB: Real-time Facial Biometrics Detector
│       ├── ocr-det.onnx      # 4.75 MB: DBNet Text-Region Neural Detector
│       └── README.md         # Model specs, tensor shapes, and normalization formulas
├── src/
│   ├── background/           # Service Worker Autonomous Runner
│   │   └── background.ts     # Persistent session owner across tab reloads (solves multi-hop amnesia); local fallback on server failure
│   ├── content/              # Content Script Coordinator
│   │   └── content.ts        # Dual-track perception (Track 1 DOM + Track 2 Canvas Vision), field-context aware
│   ├── execution/            # Action Execution & Safety Boundary
│   │   ├── actionDispatcher.ts # "Reasoning ≠ Authority" 4-tier risk gate; textContent-only modal; TYPE/NAVIGATE guards
│   │   ├── localPlanner.ts   # Untrusted-plan validator + deterministic L0/offline fallback (mirrors server heuristic)
│   │   └── cursorReticle.ts  # Zero-dependency tactical HUD targeting cursor
│   ├── network/              # Fail-Closed Egress Boundary
│   │   └── egressVerifier.ts # Label sanitizer, canary leak filter, residual-PII scan, SHA-256 integrity digest
│   ├── popup/                # Cyber-Defense Mission Control UI
│   │   ├── popup.html        # Telemetry console, live counters, scan/autonomous/multi-hop triggers
│   │   ├── popup.ts          # UI controller communicating with active tab & background
│   │   └── popup.css         # ISRO military-grade cyber styling
│   ├── privacy/              # Deterministic PII Engine, Vault & Policy
│   │   ├── checksums.ts      # Verhoeff (Aadhaar), Luhn (Cards), PAN 4th-char, GSTIN, phone/landline, passport, IFSC, bank, ₹, context-gated names
│   │   ├── vault.ts          # Ephemeral Inversion Vault (<PERSON_1>, <AADHAAR_ID_1>)
│   │   └── disclosure.ts     # Minimum-disclosure ladder: L0 (zero egress) → L1 → L2 (L3 placeholder, capped)
│   ├── types/                # TypeScript Wire Contracts & Schemas
│   │   └── index.ts          # Shared interfaces, session state, risk tiers, action types, ExtensionMessage union
│   └── vision/               # On-Device WebGPU/WASM Vision Pipeline
│       ├── visionEngine.ts   # ONNX Runtime Web session loader; verified BlazeFace layout; in-place redaction burning
│       ├── nms.ts            # Pure IoU + NMS (unit-tested)
│       └── ccl.ts            # Pure 8-connectivity CCL for DBNet probability maps (unit-tested)
├── dist/                     # Production build output loaded via chrome://extensions
├── manifest.json             # Chrome Manifest V3 configuration
├── package.json              # Dependencies and automated test scripts
├── tsconfig.json             # TypeScript compiler configuration
└── vite.config.ts            # Vite bundler with automatic ONNX and WASM asset copy
```

---

## How to Build and Load
1. **Compile:**
   ```bash
   npm install        # first time
   npm run build      # tsc (strict) + vite build → dist/
   ```
2. **Load into Browser:**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** and select the `extension/dist` folder.

## Tests

| Command | Suite |
|---|---|
| `npm run test:unit` | `privacy.test.mjs` (26) + `accuracy-benchmark.test.mjs` (3) — real TS via esbuild, no server needed |
| `npm run test:e2e` | `e2e-plan.test.mjs` (5) — live server wire protocol (start `python3 server/app.py`) |
| `npm run test:integration` | `autonomous-canvas-vision.test.mjs` (5) — disclosure + real egress + live server |
| `npm run test:all` | all four suites above |
| `npm run test:playwright` | full-browser audit of `dist/` (needs `npx playwright install chromium`; exit 75 = no browser) |
| `npm run test:server` | server unit tests (12) via `python3 -m unittest` |

Full details and verified results: [../docs/testing.md](../docs/testing.md).
