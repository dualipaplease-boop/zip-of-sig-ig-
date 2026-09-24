# SIH26171 — On-device Visual Perception for Light-weight Browser Agents

**Organization:** Indian Space Research Organisation (ISRO)
**Category:** Software
**Theme:** Smart Automation
**Deadline:** 30 September 2026

---

## Background

AI agents are becoming omnipresent and can play an important role in digital interactions. If an agentic AI pipeline has access to visual context and screen states, it can assist users in complex workflows and automate many tasks. Most agentic AI pipelines are deployed server-side, which limits the type of data a user can share with them.

Deploying a local agent on the user's machine — particularly in the browser — could eliminate the need to share sensitive data with a server. Since local systems generally have fewer resources than servers and cannot host a full pipeline, only non-sensitive data (screen structure, application fields, etc.) should be sent to the server for processing.

Modern browser APIs (WebGPU, WebAssembly) and local inference libraries (ONNX Runtime Web, Transformers.js) have unlocked the ability to run lightweight ML models directly on the client. The aim is to bridge local and cloud environments: leveraging the reasoning power of cloud/server-based AI while strictly enforcing data privacy on the client side.

## Description

Participants must build a **privacy-preserving vision agent that runs in the browser**:

- Implement a client-side architecture where a local Vision Transformer (ViT) or equivalent CV model "reads" the user's screen and makes decisions based on it.
- If visual context needs to be sent to a server, it must be sanitized first — sensitive/PII data redacted (via DOM tags or other methods) before any network request.
- Dynamically detect and redact sensitive elements: blur faces, black out passwords, mask PII, etc.
- Only anonymized, unidentifiable data should be transmitted to a central server, which is aware of the redaction scheme and can process data accordingly.
- The server processes the sanitized context and returns actionable commands for the browser agent to execute.
- Participants must balance inference latency vs. accuracy.

## Expected Solution

A working prototype consisting of a **client-side extension** and a **server**, demonstrating:

### Client-side (extension/JS) — running in Chrome, Firefox
- **Local Vision Processing:** a client-side vision model (e.g., via WebGPU) that evaluates the current screen state.
- **Privacy Preserving Filter:** mechanism for sanitizing sensitive/personal visual data — local bounding-box redaction, semantic obfuscation, masking, etc. Must be clearly demonstrated.

### Server-side
- **Server Side Integration:** transmission of anonymized visual context to a centralized LLM/VLM, which interprets the sanitized data and returns either processed data (re-ingested by the client) or a UI action (e.g., "click the submit button," "scroll down") for the client to execute.
- Any offline-deployable (open-source/open-weights) model may be used server-side; cloud-hosted versions are allowed during SIH.
- An end-to-end task assisting the user must be demonstrated.

## Evaluation Criteria

| Metric | Weight |
|---|---|
| Accuracy of visual context extraction from screen | 25% |
| Recall & precision for detection of sensitive/PII data | 20% |
| Precision of redaction | 20% |
| Client-side resource utilization | 20% |
| Overall end-to-end latency of the provided task | 15% |

## Suggested Skills / Stack Areas
Computer Vision · Mobile/Browser Extension Dev · IoT/Embedded · On-device inference (WebGPU/WASM, ONNX Runtime Web, Transformers.js)

---

## Links to Search / Verify

- **Official SIH 2026 portal:** https://www.sih.gov.in/sih2026PS
- **Detailed brief mirror (Zaid Sayyed's SIH tool):** https://zaidsayyed.in/tools/sih-problem-statements/sih26171
- **Full problem statement list (searchable):** https://zaidsayyed.in/tools/sih-problem-statements

*Note: Always cross-check the latest wording, evaluation criteria, and submission counts against the official sih.gov.in portal, since mirrors may lag or the official listing may be revised.*
