# SentryAgent: Full System Completion Plan (Phases 2 – 5)

Complete all remaining phases of the **SentryAgent** privacy-preserving browser agent system for SIH26171 (ISRO):

1. **Phase 2: On-Device Vision Engine & Canvas Redaction**
   - WebGPU / ONNX-ready vision pipeline for face and visual credential detection.
   - Bounding-box detection for `<canvas>` and image regions (signatures, ID photos, badges).
   - Solid / Gaussian privacy redaction overlay engine that burns redactions directly into canvas pixels.
2. **Phase 3: Fail-Closed Egress Verifier & Remote Server Wire Contract**
   - SHA-256 cryptographic wire digest and canary token detector (fails closed if unredacted PII is detected).
   - Minimal Python FastAPI server (`server/app.py`) providing the remote reasoning agent loop.
   - Support for L0–L3 minimum-disclosure ladder: decides whether to send semantic tree (L1), visual crop (L2), or sanitized full frame (L3).
3. **Phase 4: Action Execution & 4-Tier Risk Policy Gate**
   - Client-side DOM action dispatcher mapping opaque IDs (`node_42`) back to real DOM nodes.
   - Local Inversion Vault token re-hydration on-device before DOM dispatch.
   - 4-Tier Risk Policy Gate (Tier 1: Safe Navigation, Tier 2: Safe Form Fill, Tier 3: Sensitive Mutation, Tier 4: Irreversible / Statutory Submit).
   - Visual user confirmation modal for Tier 4 actions (e.g. submitting tender bids).
4. **Phase 5: Comprehensive Verification, End-to-End Demo & CHANGELOG**
   - Connect extension with the FastAPI reasoning server and the testbed portal.
   - Full end-to-end autonomous assisted task demonstration.
   - `CHANGELOG.md` documenting every file created, modified, algorithms implemented, and architectural decisions.

---

## User Review Required

> [!IMPORTANT]
> - **Server**: A lightweight, standalone Python FastAPI service (`server/app.py`) will be created with mock/local LLM planner capability that speaks the Sentry wire protocol.
> - **Risk Policy Gate**: The client enforces "Reasoning $\neq$ Authority": the server can only propose actions, but the client evaluates the risk tier and requests confirmation for high-stakes actions.

---

## Proposed Changes

### Component 1: On-Device Vision Engine (Phase 2)
#### [NEW] [extension/src/vision/visionEngine.ts](file:///c:/Users/iqand/Downloads/SIH/extension/src/vision/visionEngine.ts)
- WebGPU / Canvas visual inference engine.
- Fast heuristic + quantized Haar/feature face detector and signature region segmenter.
- Pixel-level redaction burner (`burnRedactionBBox`) applying solid opaque blackouts and cryptographic salt tokens directly on canvas layers.

### Component 2: Fail-Closed Egress Verifier & Protocol (Phase 3)
#### [NEW] [extension/src/network/egressVerifier.ts](file:///c:/Users/iqand/Downloads/SIH/extension/src/network/egressVerifier.ts)
- Computes SHA-256 digest of outbound payload.
- Scans outbound JSON for canary tokens and unmasked PII strings. If a leak is detected, aborts network transfer immediately (Fail-Closed).
#### [NEW] [server/app.py](file:///c:/Users/iqand/Downloads/SIH/server/app.py) & [server/requirements.txt](file:///c:/Users/iqand/Downloads/SIH/server/requirements.txt)
- FastAPI backend accepting sanitized scene graph and returning action plans over opaque IDs (`node_42`).

### Component 3: Action Dispatcher & Risk Policy Gate (Phase 4)
#### [NEW] [extension/src/execution/actionDispatcher.ts](file:///c:/Users/iqand/Downloads/SIH/extension/src/execution/actionDispatcher.ts)
- Maps opaque IDs to real DOM elements.
- Intercepts Tier 4 actions to display an on-screen confirmation modal.
- Rehydrates semantic tokens locally from `LocalInversionVault` right before DOM event dispatch.

### Component 4: Integration & Updates to Extension Core
#### [MODIFY] [extension/src/content/content.ts](file:///c:/Users/iqand/Downloads/SIH/extension/src/content/content.ts)
- Wire up vision engine, egress verifier, action dispatcher, and risk modal.
#### [MODIFY] [extension/src/popup/popup.html](file:///c:/Users/iqand/Downloads/SIH/extension/src/popup/popup.html) & [popup.ts](file:///c:/Users/iqand/Downloads/SIH/extension/src/popup/popup.ts)
- Add server connection indicator, risk gate toggle, and "Run End-to-End Autonomous Agent" button.

### Component 5: Project Documentation & Changelog
#### [NEW] [CHANGELOG.md](file:///c:/Users/iqand/Downloads/SIH/CHANGELOG.md)
- Complete, granular changelog of all code changes, architecture decisions, and techniques across all phases.

---

## Verification Plan

### Automated Tests
1. Egress Verifier unit tests: ensure canary leaks and raw PII strings fail closed.
2. Token Inversion & Risk Gate tests.
3. Build check (`npm run build`) in `extension/`.

### Manual / Browser Verification
1. Start FastAPI server.
2. In the browser subagent, open `testbed/index.html`.
3. Trigger SentryAgent automated loop:
   - Page is scanned and visual face/signature detected.
   - Sanitized wire payload is verified by SHA-256 digest and sent to server.
   - Server returns action plan on opaque IDs.
   - Client risk gate intercepts statutory bid submission and prompts for confirmation.
   - Task completes with zero PII egressed.
