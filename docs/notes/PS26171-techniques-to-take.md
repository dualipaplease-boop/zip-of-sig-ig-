# PS26171 — What You Can Legitimately Take (Techniques, Not Code)

**Rule of thumb:** ideas/techniques below are free to use — copyright protects specific code expression, not general concepts. Implement each in your own code, your own naming, your own structure. Don't copy files.

---

## Techniques by Source

### From ADIII-03 — Checksum-validated PII + union-biased fusion
- **What:** Don't just regex-match PII shapes — validate them against real checksums before redacting. Verhoeff algorithm (1969, public) for Aadhaar, Luhn algorithm (1954, public) for cards, holder-type character check for PAN. A 12-digit string that *looks* like an Aadhaar but fails Verhoeff gets ignored — keeps precision high without hurting recall.
- **Fusion rule:** combine DOM-signal + regex-signal + vision-signal detections via bounding-box overlap (IoU), merge with noisy-OR confidence combination. Bias toward union (redact if *any* source flags it), never intersection — a missed PII leak is worse than an over-redaction.
- **Why it's fine to take:** Luhn and Verhoeff are public standard algorithms used by UIDAI and card networks themselves. "Union-biased multi-signal fusion" is standard security-engineering practice (fail-safe defaults), not an invention.

### From Tushar-cy — Minimum-disclosure ladder (L0–L3)
- **What:** Before running anything expensive, decide *how much* needs to leave the device for this specific task:
  - L0 — solvable on-device, zero bytes sent
  - L1 — only tokenized/anonymized semantic element tree sent (no screenshot)
  - L2 — sanitized visual *crop* of just the relevant element
  - L3 — full sanitized screenshot, last resort only
- **Why it matters for your score:** this is what keeps latency + resource utilization (35% of rubric combined) good even after adding a real vision model — most interactions never need to hit L2/L3 at all.
- **Why it's fine to take:** this is "progressive disclosure" / "least privilege," a decades-old general security design pattern, not owned by any one team.

### From DrishtiGuard — Cryptographic egress proof
- **What:** Before any network request leaves the device, hash the exact outbound payload (SHA-256) and validate it against a schema that proves no raw PII slipped through. Element references sent to the server are task-random opaque IDs (`node_7a4f`-style), never real selectors or values.
- **Why it's fine to take:** SHA-256 is a public standard hash function; "validate outbound payload before sending" is a standard defense-in-depth pattern (egress filtering), used broadly in security engineering.

### From PrivAgent — OCR for canvas/image-rendered PII (the standout idea)
- **What:** DOM-only scanning is blind to signature pads, scanned documents, canvas-rendered forms, and closed Shadow DOM content. Run OCR on regions your vision model flags as "text-shaped, not a face" — feed the extracted text through your normal regex/checksum pipeline.
- **Also worth taking:** stale-target safety (re-verify an element still exists/hasn't moved right before executing an action, don't blindly trust a plan made a few hundred ms ago), fail-closed behavior on provider/API errors (don't act on ambiguous or failed responses).
- **Why it's fine to take:** OCR-then-classify is a standard computer vision pipeline pattern, not an invention.
- **The gap they left open — your actual opportunity:** despite all of the above, PrivAgent has **no real on-device vision model** anywhere in their codebase (verified directly — no WebGPU/ONNX/ViT/face-detection files exist). Their "Visual Context Accuracy: 98.5%" metric tests coordinate math (`mapDOMToScreenshot`), not actual visual perception. This is worth 25% of the grade — the single biggest line item — and the hardest-working team in the research doesn't appear to have it for real.

### From Peter Yared / AgentCloak — Generalize instead of blackout
- **What:** For text/structured PII, replace the value with a category token or generalized bucket (`<PERSON_1>`, `age_bracket(dob)` → "30–39") instead of pure blackout. Same pipeline stage, same cost (you already know the PII type from the detector that triggered redaction) — just a different string write. Keeps the downstream planner more useful without leaking the real value.
- **The one hard constraint:** only for text/DOM-detected PII, where it's free. For vision-detected PII (faces, signatures), blackout stays the default — generalizing a face needs a *second* inference pass (an attribute-estimation model), which costs real latency and hurts your resource/latency scores. Don't generalize vision PII unless the signal is already free from surrounding DOM context.
- **Why it's fine to take:** this is AgentCloak's general *technique* (data generalization for privacy, a well-known field called "k-anonymity"/"data minimization" in privacy engineering, decades old), not their specific commercial product or code. Porting it on-device is actually a legitimate improvement over their off-device SaaS version, not a copy.

---

## What the Problem Statement Actually Requires (mandatory, not optional)

From the official PS text, not the rubric — separate requirements:

**Client-side (extension, Chrome + Firefox):**
- A **real local Vision Transformer (ViT) or equivalent CV model**, running via WebGPU, that reads the screen — stated twice in the PS text, explicitly on-device
- Local bounding-box redaction / semantic obfuscation / masking — "must be clearly demonstrated"
- Dynamic detection + redaction: blur faces, black out passwords, mask PII

**Server-side:**
- Receives only anonymized visual context
- Centralized LLM/VLM interprets it, returns processed data or a UI action ("click submit," "scroll down")
- Any offline-deployable model allowed; cloud-hosted is explicitly permitted *during SIH*

**Overall:**
- A full **end-to-end task** must be demonstrated, not just isolated components
- PS text explicitly states: **"balance inference latency vs. accuracy"** — going all-in on vision accuracy at the cost of speed is directly discouraged by ISRO's own wording

---

## Grading Weights (for prioritization)

| Metric | Weight |
|---|---|
| Visual context extraction accuracy | **25%** |
| PII detection recall & precision | 20% |
| Redaction precision | 20% |
| Client-side resource utilization | 20% |
| End-to-end latency | 15% |

Grouped: **65% is privacy correctness** (visual + PII + redaction), **35% is performance** (resources + latency).

---

## Build Priority Order

1. **A real, working, on-device vision model.** Non-negotiable, biggest single opportunity — the hardest-working competitor doesn't have one. Doesn't need to be fancy (small quantized face/text-region detector via ONNX + WebGPU is enough).
2. **OCR on flagged canvas/image regions**, paired with #1, feeding your existing PII pipeline.
3. **Checksum-validated PII detection** (Luhn/Verhoeff) — cheap, high payoff on the 20% precision/recall line.
4. **Disclosure-ladder gating** — decide before you look; keeps latency/resources good once #1 adds real weight.
5. **Generalize-over-blackout for text PII** — free improvement to downstream usefulness, same cost as blackout.
6. **A demo that can't flake live** — deterministic/local fallback planner as the default path; don't depend on an external API being up during judging.

## What Not to Do

- Don't copy file structure, function names, comments, or code verbatim from any of the above repos — implement your own version of each technique
- Don't try to match PrivAgent's breadth (separate dashboard app, 3 custom demo sites, 50-file test suite) — that's effort with no direct rubric payoff; you don't have their time budget
- Don't skip the vision model to save time — it's the one requirement stated twice in the PS text and worth more alone than resources+latency combined
