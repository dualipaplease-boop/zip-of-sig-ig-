# SIH26171 — On-device Visual Perception for Light-weight Browser Agents
### Session notes: problem, rationale, market research, and fit

---

## 1. The problem statement

**Organization:** ISRO | **Category:** Software | **Theme:** Smart Automation | **Deadline:** 30 Sept 2026

Build a **privacy-preserving vision agent that runs in the browser**:

- A local Vision Transformer (or equivalent CV model) "reads" the user's screen client-side.
- Before any visual context is sent to a server, it must be sanitized — PII detected and redacted (blurred faces, blacked-out passwords, masked personal data) via DOM tags or local CV.
- Only anonymized, unidentifiable data is transmitted to a central server.
- The server processes the sanitized context and returns actionable commands (e.g. "click submit," "scroll down") for the client to execute.
- Must balance inference latency vs. accuracy on constrained client hardware.

**Deliverable:** a working prototype — browser extension (Chrome/Firefox) + server — demonstrating an end-to-end assisted task.

**Evaluation weights:**
| Metric | Weight |
|---|---|
| Accuracy of visual context extraction | 25% |
| Recall & precision of PII/sensitive-data detection | 20% |
| Precision of redaction | 20% |
| Client-side resource utilization | 20% |
| End-to-end latency | 15% |

---

## 2. Why ISRO is proposing this

Browser AI agents need to "see" the screen to act on it — but most agentic pipelines are server-side, meaning raw screen content (passwords, PII, internal data, faces on video calls) gets shipped off to a third party just so the AI can observe it. For a government/space agency, that's a hard data-security line, not a nice-to-have.

The proposed fix splits the work:
- **Device**: small local vision model reads the screen and redacts anything sensitive *before* transmission.
- **Server**: gets only the sanitized version, reasons over it, and returns an abstract instruction rather than raw data.

The PII-detection/redaction slice is weighted almost as heavily as the core vision task (40% combined) — privacy-preservation **is** the deliverable, not a bonus feature.

---

## 3. Does this already exist? — Research findings

### a) The individual pieces — mature, shipped, solved
- **Local PII text redaction in-browser**: shipped Chrome extensions already do this on outgoing LLM prompts — *Private Guard*, *PrivacyScrubber*, *PII Guardian*, *ChatWall* — 100% on-device, no data leaves the browser.
- **Local vision inference in-browser**: mature — WebGPU + ONNX Runtime Web + Transformers.js can run segmentation, background removal, and even small VLMs (Phi-3-Vision, Gemma-3, Qwen2.5-VL) directly in a tab today.
- **Browser agents that click/scroll/fill forms via AI**: exists — Nanobrowser, Skyvern, Stagehand, WebBrain. Several already market "runs locally, bring your own LLM" as a privacy angle.

### b) The "near same to same" — GUIGuard (arXiv 2601.18842)
A research paper proposing the **exact same architecture** as this problem statement: a three-stage "Trustworthy Local–Remote Hybrid" pipeline —
1. **Privacy Recognition** — identify/localize sensitive regions on-device
2. **Privacy Protection** — apply configurable sanitization operators
3. **Task Execution** — remote agent operates on the protected screenshot

They built **GUIGuard-Bench**: 630 GUI agent trajectories, 13,830 screenshots, region-level privacy annotations.

**Key result — this is the important part:** when benchmarking current state-of-the-art GUI agents on this exact task, privacy-recognition accuracy was only **13.3% on Android and 1.4% on PC**. The architecture is validated; the execution quality is currently poor, especially on dense desktop-style UIs.

### c) Market conclusion
Nobody has shipped a *product* combining all three: live screen vision + real-time PII redaction + an agentic action loop, all client-side in a browser extension.
- Redaction tools operate on text prompts, not full visual screen state.
- Browser agents automate clicks but send raw screenshots to their BYOK LLM — no redaction step.
- The research world has proven the concept but current models perform badly at the detection step under real desktop conditions.

**The actual gap = integration + accuracy under resource constraints, not invention of new primitives.**

---

## 4. Fit against my own work

| Existing asset | Relevance |
|---|---|
| **Lady LISA — OS-level activity Watcher** (scoped to assistant surfaces after privacy concerns raised) | Same core idea — "observe the screen, act only on what's relevant" — just needs retargeting from OS-level to browser DOM/canvas, plus formal redaction instead of scope-limiting |
| **Lady LISA — privacy-scoping design process** | Already went through the "what counts as sensitive, what gets blurred/masked" reasoning once; transfers directly |
| **Lady LISA — local-first, hardware-constrained design philosophy** (built for 4GB VRAM / 16GB RAM) | Directly matches the eval rubric — client-side resource utilization is 20% of the grade |
| **AnyRAG — local embeddings, offline inference, SQLite vector store** | Same "keep it on-device, only send derived data out" pattern, applied here to vision instead of text |

**Genuinely new territory:** browser extension architecture (content script ↔ background ↔ server) and a vision/OCR model pipeline, instead of the speech/text stack I've worked in so far.

---

## 5. Proposed solution sketch

1. **Capture** — grab the visible tab as canvas + read the DOM (cheaper than pure pixel analysis where structure is available).
2. **Local detection pass** (WebGPU via ONNX Runtime Web / Transformers.js):
   - Small face detector (BlazeFace-class) → bounding boxes to blur.
   - OCR on canvas (Tesseract.js WASM) for text regions.
   - Regex/lightweight NER on OCR'd text → flag emails, card numbers, phone numbers, names.
3. **Redact locally, before anything leaves the device** — blur/black-box flagged regions on the canvas itself; mask matched text in the DOM description. Nothing unredacted touches `fetch()`.
4. **Send structured, not raw** — prefer a redacted structured description (element positions, labels, button text) over images where possible; images as fallback only.
5. **Server returns an action, not data** — e.g. "click #submit-btn" or coordinates; client executes locally against the real (unredacted) page.
6. **Latency optimization** — diff against last screen state, only re-run detection on meaningful change, rather than every frame.

**Where the real dev effort goes:** keeping the full pipeline fast enough on modest hardware (graded explicitly) while catching edge-case PII (handwriting-style fonts, PII embedded inside images rather than as text) — not proving redaction is possible in principle.
