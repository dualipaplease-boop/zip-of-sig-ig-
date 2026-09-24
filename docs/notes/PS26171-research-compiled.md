# SIH26171 — Full Research Compilation

**Problem Statement:** ISRO — On-device Visual Perception for Light-weight Browser Agents
**Deadline:** 30 September 2026

---

## 1. The Core Architecture Question

Strip the ISRO framing away and PS26171 reduces to one question:

> **Where does the trust boundary sit, and what's allowed to cross it?**

Everything else — which CV model, which checksum algorithm, which server framework — is implementation detail on top of that one decision. The eval rubric confirms this: 40% of the weighted score (client resource use + redaction precision) is really scoring *how well you enforce the boundary*, not how smart your agent is.

| Metric | Weight |
|---|---|
| Visual context extraction accuracy | 25% |
| PII detection recall/precision | 20% |
| Redaction precision | 20% |
| Client-side resource utilization | 20% |
| End-to-end latency | 15% |

---

## 2. Three Reference Architectures (where the boundary sits)

### A. SIH competitor consensus — boundary = the browser extension
Every serious repo makes the same call: extension is trusted, server is untrusted, nothing raw crosses. Two genuinely different sub-strategies emerged:

- **ADIII-03's pattern — fuse before you redact.** DOM signal + regex/checksum signal + vision signal computed locally, **union-biased** merge (false negatives treated as worse than false positives), redacted, *then* sent. One boundary crossing, maximally scrubbed.
- **Tushar-cy's pattern — don't cross the boundary unless you have to.** A disclosure ladder (L0–L3) decides *whether* the task even needs to leave the device before running vision at all:
  - L0 — solvable on-device, zero bytes sent
  - L1 — only tokenized/anonymized semantic element tree sent (no screenshot)
  - L2 — sanitized visual *crop* of just the relevant element
  - L3 — full sanitized screenshot, last resort

### B. OpenAI Atlas — boundary = the cloud provider's policy, not the device
Atlas's agent mode reasons server-side over your live browsing context (email, docs, browsing memory). No on-device redaction layer exists — privacy is "trust our policy," not "physically prevent the data leaving." This is the architecture ISRO's problem statement is implicitly reacting against. Useful only as the anti-pattern to cite in your problem framing.

### C. Peter Yared's AgentCloak — boundary = the data representation layer
Doesn't care where compute happens (cloud is fine). Intercepts at the data layer and **generalizes** rather than blocks: `"32" → "30–39"`, `"Berlin" → "EU"`, a name → a consistent pseudonym via a "secure digital twin." This is a SaaS product, not a browser/vision system — but the *generalize-don't-blackout* technique is the one idea worth porting into a vision pipeline, since none of the SIH repos do it.

---

## 3. Competitor Repos — Deep Inspection (actual source code, not just README)

### ADIII-03/privacy_first_browser_agent
Cloned and read directly (`extension/lib/privacy/pii-regex.js`, `fusion.js`):
- **Checksum-gated detection, not shape-matching.** Verhoeff for Aadhaar, Luhn for cards, holder-type char for PAN. A 12-digit string that *looks* like an Aadhaar but fails Verhoeff is ignored — this is why their precision holds at 0.99 against deliberately fake-looking hard negatives.
- **Union-biased fusion with noisy-OR confidence combination.** DOM + regex + vision detections merged via IoU overlap; agreement between sources raises confidence, but any single source can trigger redaction (never requires 2-of-3 agreement).
- **Measured eval (on shipped code, not a separate eval reimplementation):** visual accuracy F1 0.95 (recall 1.00), PII detection F1 0.99, redaction coverage-recall 1.00, client scan ≈4,700 chars/ms, server `/plan` p50 ≈16ms.
- **Honest gaps they admit:** in-browser WebGPU runtime not exercised in their test env (only Node-tested CPU-equivalent core), Firefox "shimmed, not verified."

### Tushar-cy/Privaagent
Cloned and read directly (`extension/src/disclosure/disclosure-planner.ts`):
- **The L0–L3 minimum-disclosure ladder** (detailed above). This is the standout idea — it's the only repo treating "how much to disclose" as a per-task decision rather than a fixed pipeline stage:
  - L0: Solvable entirely on-device, zero network bytes.
  - L1: Sanitized structural/semantic element tree only (no pixels).
  - L2: Sanitized visual crop of active region.
  - L3: Full sanitized viewport screenshot (last resort).

### AtharvaSamant4/DrishtiGuard
Cloned and read directly (`apps/extension`, `contracts/v1`, `docs/ARCHITECTURE.md`):
- **Fail-Closed Egress Boundary & Cryptographic Digest:** Treats privacy as an immutable system boundary. The client minimizes the page into an opaque, sanitized scene graph, verifies outbound JSON against residual identifiers and canary tokens, and binds the payload with a **SHA-256 digest**.
- **Opaque Element IDs:** The remote model never sees real DOM selectors; it plans actions only over task-random opaque IDs.
- **Confirmation Boundary:** Consequential actions and stale page states fail closed.

### akashgoudsidduluri/PrivAgent
Cloned and read directly (176 files, ~37.2k lines):
- **Reasoning $\neq$ Authority Architectural Rule:** Downstream LLMs propose actions based on sanitized structural metadata, but the local runtime gates, authorizes, and validates every interaction before and after DOM dispatch.
- **4-Tier Risk Policy Gate:** Categorizes actions by risk level; irreversible or consequential actions require explicit user confirmation.
- **Deterministic Multi-Candidate Completion Check:** Verifies DOM state mutations and effects after action dispatch to confirm the goal was actually completed.

---

## 4. Full Repo Survey — All 18 Cloned Repositories

All 18 repos were cloned via `clone_repos.ps1` into the local `repo/` directory:

| Repo | Category / Focus | Key Mechanism |
|---|---|---|
| `akashgoudsidduluri/PrivAgent` | Full agent loop + Risk gating | Reasoning $\neq$ Authority; 4-tier risk policy; OCR + DOM scanner |
| `Orbitveil-SIH/Orbitveil` | Edge privacy wrapper | Lightweight edge interception; canvas masking |
| `AtharvaSamant4/DrishtiGuard` | Production-target architecture | SHA-256 bound safe envelope; fail-closed verifier; opaque IDs |
| `ADIII-03/privacy_first_browser_agent` | Deterministic privacy engine | Verhoeff/Luhn checksums; union-biased noisy-OR fusion |
| `Tushar-cy/Privaagent` | Adaptive disclosure | L0–L3 disclosure ladder; minimum disclosure planner |
| `Rohinth-S/privacy-focused-browser-agent` | Extension + server prototype | PII regex filters + screenshot blur |
| `nothingmuch18/PrivacyShield-AI` | Visual protection | Element bounding-box redaction |
| `xeno0340/Vision-Guard` | Client vision | WebGPU browser inference experiments |
| `Uday5706/SIH26` | Core prototype | Form automation with scrubbed inputs |
| `jaisinghnegi/Browser` | Extension framework | DOM parser and action replay |
| `MxthThunder/browserxtension` | Early exploration | Client-side DOM parsing |
| `sih2026-ps171-browser-agent` | ISRO PS171 targeted | Screenshot redaction + cloud LLM planner |
| `Privacy_Browser_Extension-kushagraparallel` | Extension prototype | Regex PII masking |
| `Privacy_Browser_Extension-Kushagra9399` | Extension prototype | UI overlay masking |
| `browser_agent` | Agent automation | Browser action execution loop |
| `SIH26171-PrivacyBrowserAgent` | ISRO targeted | DOM tokenization + VLM prompt |
| `sih-2026` | Hackathon project | Basic screen capture + local filtering |
| `SIH26171-ISRO` | PS targeted | Extension skeleton |

---

## 5. Official References & Problem Statement Links

- **Official SIH 2026 portal:** https://www.sih.gov.in/sih2026PS
- **Detailed brief mirror:** https://zaidsayyed.in/tools/sih-problem-statements/sih26171
- **Peter Yared / AgentCloak:** https://theaiinsider.tech/2025/09/29/incountry-raises-10m-in-funding-and-launches-agentcloak-ai-agent-data-protection/
- **OpenAI Atlas analysis:** https://www.npr.org/2025/11/07/nx-s1-5597010/openai-atlas-browser-chatgpt-data-privacy

---

## 6. Official SIH 2026 Process & Constraints

- **Dates:** August–December 2026 (Internal college hackathons in September; Idea screening Oct–Nov; 36-hr Grand Finale in December).
- **Rules:** Exactly 6 members per team; ≥1 female member mandatory; max 2 idea submissions per team.
- **Evaluation Weights:** Visual context extraction (25%), PII recall & precision (20%), Redaction precision (20%), Client-side resource utilization (20%), End-to-end latency (15%).

---

## 7. Critical Evaluation of the Initial Session Approach

### What was brilliant and must be kept:
1. **The "One Operation, Three Channels" Insight:** Modifying DOM text at source with placeholder tokens (`[ACCOUNT_NO]`) ensures that rendered screenshots, accessibility trees, and serialized JSON payloads stay 100% in sync without multi-system race conditions.
2. **Sidestepping the GUIGuard Trap:** GUIGuard proved that using a monolithic VLM for visual PII spotting yields an abysmal **13.5% localization accuracy** on desktop. Pure visual guessing fails; deterministic regex/NER + checksum verification is strictly superior for text.

### Critical vulnerabilities identified in review:
1. **The "Where is the Vision Model?" Trap (25% Rubric Weight):**  
   The rubric explicitly allocates **25% to "Accuracy of visual context extraction from screen"** and names "Vision Transformer (ViT) or equivalent CV model". If an implementation relies 95% on DOM scraping + regex without an active on-device vision model, evaluators will dock this entire 25%. An actual WebGPU-accelerated vision model must be part of the pipeline.
2. **Canvas, WebGL, and Shadow DOM Blind Spot:**  
   DOM scraping completely fails on `<canvas>` elements, PDF viewers, digital signature pads, and closed Shadow DOMs. Pure DOM approaches have zero perception on these elements.
3. **The "Reasoning $\neq$ Authority" Vulnerability (Prompt Injection / Hallucination):**  
   If the remote LLM is tricked by adversarial web text or hallucinates an action on a sensitive button, direct execution can cause data loss. The client must enforce a **Local Risk & Policy Gate**.
4. **Dynamic DOM Mutations & Stale Coordinates:**  
   In modern SPAs (React/Vue), coordinates change on scroll or re-render. Relying on raw coordinates leads to misclicks; actions must be grounded against structural fingerprints.

---

## 8. Our Decided Winning Architecture: "SentryAgent"

A **Dual-Track Perception & Local Safety Boundary** architecture designed to maximize all five rubric categories.

```mermaid
flowchart TD
    subgraph Client [Browser Extension: Manifest V3 + WebGPU]
        A[User Task / Trigger] --> B[Dual-Track Perception Engine]
        
        subgraph Perception [Dual Perception Pass]
            B --> B1[Track 1: DOM & A11y Tree Extractor (<15ms)]
            B --> B2[Track 2: WebGPU Visual ViT / NanoDet (<45ms)]
        end

        B1 & B2 --> C[Local Privacy Perimeter]
        
        subgraph Privacy [Privacy & Redaction Core]
            C --> C1[Checksum Regex: Verhoeff, Luhn, PAN]
            C --> C2[WebGPU Face & Signature BBox Redaction]
            C --> C3[Semantic Typed Tokenizer + Inversion Vault]
        end

        C1 & C2 & C3 --> D[Sanitized Scene Graph + Redacted Canvas]
        D --> E{Fail-Closed Egress Verifier}
        E -- Canary / PII Leak Detected --> X[Halt Egress]
        E -- Clean --> F[SHA-256 Bound Minimized Wire Payload]
    end

    subgraph Server [Remote Reasoner / Cloud VLM]
        F --> G[Cloud Reasoner: Qwen2.5-VL / GPT-4o / Claude]
        G --> H[Action Intent on Opaque ID: e.g., CLICK node_42]
    end

    subgraph Execution [Local Execution & Verification]
        H --> I[Local Risk Policy Gate]
        I -- High Risk Action --> J[Require User Confirmation]
        I -- Safe --> K[Token Inversion Vault: Rehydrate real data locally]
        K --> L[Dispatch DOM Event / Action]
        L --> M[Post-Action Mutation Check & State Delta]
    end
```

### Core Architecture Pillars:

1. **Dual-Track Perception:**
   - **Track 1 (DOM / Accessibility Tree):** Fast structural extraction of visible inputs, buttons, labels, and geometry in < 15ms.
   - **Track 2 (WebGPU Visual Model):** Quantized lightweight vision model (**FastViT / MobileNetV4 / NanoDet** via ONNX Runtime Web or Transformers.js). Operates specifically on canvas elements, images, profile pictures, signature pads, and scanned attachments.
2. **Semantic Typed Tokenization & Local Inversion Vault:**
   - Rather than masking to generic asterisks (`***`), replace values with semantic tokens:
     - Name $\rightarrow$ `<PERSON_1>`
     - Aadhaar $\rightarrow$ `<AADHAAR_ID_1>`
     - Bid Price $\rightarrow$ `<CONFIDENTIAL_NUM_1>`
     - Photo / Avatar $\rightarrow$ Solid black box with label `[REDACTED_AVATAR]`
   - **Local Inversion Vault:** An ephemeral `Map<string, string>` maintained strictly in extension session storage. The remote AI understands field semantics without seeing actual values. Real values are rehydrated locally at execution time.
3. **Fail-Closed Egress Verifier:**
   - Outbound JSON strings and image bytes are pre-flight scanned for residual PII or canary strings before any network dispatch. If an anomaly is detected, egress is blocked.
4. **Reasoning $\neq$ Authority (Local Risk Gate):**
   - The remote agent only proposes actions using task-random opaque IDs (`node_42`).
   - The local extension evaluates the target element's risk tier:
     - *Low Risk (Navigation, Form Typing):* Executed automatically.
     - *High Risk (Delete, Transfer, Submit Bid):* Pauses and requests user confirmation.

---

## 9. Technology Stack & Rubric Defense

| Component | Selected Technology | Metric Targeted & Defense |
|---|---|---|
| **Extension Core** | TypeScript, React, Vite, Chrome Manifest V3 | Reliable sandbox, clean content-script / background separation. |
| **Local Vision Engine** | **ONNX Runtime Web / Transformers.js (WebGPU)** | **Metric 1 (Visual Accuracy 25%) + Metric 4 (Resources 20%):** Proves genuine on-device vision; runs < 50ms on WebGPU using < 180MB RAM. |
| **Local Vision Model** | **Quantized NanoDet-Plus / FastViT / BlazeFace (ONNX)** | Under 15MB total model bundle; detects faces, signature boxes, and canvas bounds. |
| **Privacy Detection** | Checksum Regex (Verhoeff, Luhn) + Local Mini-NER | **Metric 2 (PII Recall/Precision 20%):** Eliminates false positives via checksum verification; hits near 1.00 precision. |
| **Redaction Layer** | In-DOM Data Tokenizer + HTML5 Canvas BBox Burner | **Metric 3 (Redaction Precision 20%):** Pixel-perfect solid redaction on canvas + synchronized DOM tokenization. |
| **End-to-End Loop** | L0–L3 Disclosure Ladder + Diffed Frame Evaluation | **Metric 5 (Latency 15%):** Avoids redundant vision passes when DOM hasn't mutated; keeps round-trip latency under 400ms. |
| **Remote Reasoner** | Python FastAPI + Qwen2.5-VL / Claude / LiteLLM | Supports open-weights local hosting (Ollama) or cloud fallback. |

---

## 10. Step-by-Step Implementation Roadmap

1. **Phase 1: Extension Foundation & DOM Tokenizer**
   - Setup Manifest V3 scaffolding with TypeScript.
   - Build the local checksum regex suite (Aadhaar Verhoeff, Card Luhn, PAN format, Email, Phone).
   - Implement the in-DOM token substitution and Local Inversion Vault.
2. **Phase 2: WebGPU Vision Layer**
   - Integrate ONNX Runtime Web with WebGPU execution provider.
   - Deploy quantized face/signature detector (< 15MB) for `<canvas>` and `<img>` bounding box masking.
3. **Phase 3: Egress Verifier & Remote Wire Contract**
   - Implement the SHA-256 payload digest and canary verifier.
   - Build the FastAPI server accepting sanitized scene graph and returning opaque-ID actions.
4. **Phase 4: Action Execution & Risk Policy Gate**
   - Implement local DOM event dispatching and local token re-hydration.
   - Add the 4-tier risk gate with visual confirmation modal.
5. **Phase 5: Benchmark & Presentation**
   - Create a side-by-side demo testbed (e.g., mock ISRO e-Procurement tender bid page or HR portal).
   - Show live side-by-side: Real user page vs. Sanitized payload vs. Server execution.

