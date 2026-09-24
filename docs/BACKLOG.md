# SentryAgent — Engineering Feature Backlog

**Project:** SentryAgent (ISRO SIH26171)  
**Target:** Smart India Hackathon 2026 Evaluation  
**Status:** In Progress / Post-v2.6  

> **Status note (v2.6.0):** item 1 (HUD reticle) is **implemented**
> (`execution/cursorReticle.ts`). Item 3 (multi-hop state) is **implemented**
> as a background-service-worker session (`background.ts` + popup control) —
> persistence *across browser restarts* remains open. The "~9.01 ms"
> benchmark referenced in item 2 is **not published** (no committed
> measurement script; see models README policy).

---

## 1. Tactical Sentry HUD Reticle / Cursor (Zero-Dependency)
- **Objective:** Provide visual proof of autonomous agent operation without using third-party bloated libraries (avoiding GSAP or external cursor scripts).
- **Design Philosophy:** Match ISRO / mission-control aerospace aesthetic (cyan/saffron HUD targeting reticle, not a generic consumer mouse arrow).
- **Implementation Specifications:**
  - Inject an isolated DOM element via Shadow DOM (`#sentry-hud-cursor`) to prevent host-page CSS pollution.
  - Implement smooth coordinate translation using native CSS transitions and `requestAnimationFrame`.
  - Add visual states:
    - **Cruising / Scanning:** Subtle crosshair following $(x, y)$ target coordinates.
    - **Lock-On:** Reticle contracts and pulses upon acquiring interactive target node (`LOCKED: node_tender_quote`).
    - **Action Execution:** Radial micro-tap ripple upon dispatching click/input events.
  - **Plagiarism Safeguard:** 100% original code, zero dependencies, <60 lines of vanilla TypeScript/CSS.

---

## 2. Sentry Real-Time Telemetry Audit Stream (Live Privacy Ledger)
- **Objective:** Provide empirical visual evidence to evaluators that 0 bytes of raw PII ever cross the network wire.
- **Design Philosophy:** Display a live mission-control telemetry stream rather than a static post-scan table.
- **Implementation Specifications:**
  - Build a live event-dispatch pipeline connecting `vaultInstance`, `visionEngineInstance`, and `egressVerifierInstance` to the popup HUD.
  - Stream timestamped records with microsecond accuracy:
    - `[PERCEPTION]` Track 1 DOM extraction count and Verhoeff/Luhn validation results.
    - `[WEBGPU-VISION]` BlazeFace & DBNet neural detection latencies (highlighting the ~9.01 ms benchmark).
    - `[VAULT]` Tokenization event mappings (`<PERSON_1>`, `<AADHAAR_ID_1>`).
    - `[EGRESS]` SHA-256 envelope digest seal + zero-leak canary verification.
    - `[POLICY-GATE]` 4-Tier action risk evaluation and user-confirmation modal state.
  - Include an interactive toggle: "Raw User View" vs. "Sanitized Cloud View" vs. "Live Cryptographic Ledger".

---

## 3. Cross-Page Task Checklist & Multi-Hop State Persistence
- **Objective:** Enable the agent to survive page reloads, tab navigation, and multi-step workflows without amnesia.
- **Implementation Specifications:**
  - Persist active session state in `chrome.storage.session` / `chrome.storage.local`.
  - Maintain a sub-goal checklist received from the initial planner (`[Step 1: Authenticate, Step 2: Fill Details, Step 3: Authorize DSC]`).
  - Runner marks items as `DONE` and passes remaining sub-goals back to `/api/v1/plan` after each navigation step.
  - Include a stall-detector: if page state does not change after 3 consecutive actions, trigger recovery re-scan.

---

## 4. Self-Healing Semantic Target Grounding
- **Objective:** Prevent action dispatch failures caused by dynamic SPA re-renders (React/Vue detached DOM nodes).
- **Implementation Specifications:**
  - If an opaque ID (`node_btn_submit`) fails direct lookup, execute a fallback semantic probe:
    1. Search by `data-sentry-idx` attribute.
    2. Search by structural proximity and ARIA role/label matching.
    3. Calculate geometric IoU against the original recorded bounding box.
  - Automatically heal the reference and log the self-healing event in the telemetry stream.

---

## 5. Multi-Domain Privacy Workflows Beyond Form Filling
- **Objective:** Break out of the "toy form-filler" trap and showcase true browser agent utility across diverse enterprise workflows:
  - **Scenario A: Confidential Document & Invoice Audit** (Analyzing canvas-rendered procurement specs and vendor invoices while redacting bank details and signatures).
  - **Scenario B: Executive Dashboard & Email Summarization** (Summarizing confidential project updates or email chains while masking names, salaries, and sensitive URLs).
  - **Scenario C: Mission Telemetry & Operations Console** (Operating operational controls on ISTRAC console while redacting secret transponder codes and flight director biometrics).
