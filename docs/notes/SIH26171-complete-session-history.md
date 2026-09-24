# SIH26171 — Complete Session History
### Everything discussed, in full detail, nothing condensed

---

## SECTION 1: THE ORIGINAL PROBLEM STATEMENT

**Organization:** ISRO | **Category:** Software | **Theme:** Smart Automation | **Deadline:** 30 September 2026

**Core ask:** Build a privacy-preserving vision agent that runs in the browser:
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

## SECTION 2: WHY ISRO IS PROPOSING THIS

Browser AI agents need to "see" the screen to act on it — but most agentic pipelines are server-side, meaning raw screen content (passwords, PII, internal data, faces on video calls) gets shipped off to a third party just so the AI can observe it. For a government/space agency, that's a hard data-security line, not a nice-to-have.

The proposed fix splits the work:
- **Device**: small local vision model reads the screen and redacts anything sensitive *before* transmission.
- **Server**: gets only the sanitized version, reasons over it, and returns an abstract instruction rather than raw data.

The PII-detection/redaction slice is weighted almost as heavily as the core vision task (40% combined) — privacy-preservation is the deliverable, not a bonus feature.

---

## SECTION 3: MARKET RESEARCH — DOES THIS ALREADY EXIST?

### a) Individual pieces — mature, shipped, solved standalone
- **Local PII text redaction in-browser**: shipped Chrome extensions already do this on outgoing LLM prompts — *Private Guard*, *PrivacyScrubber*, *PII Guardian*, *ChatWall* — 100% on-device, no data leaves the browser.
- **Local vision inference in-browser**: mature — WebGPU + ONNX Runtime Web + Transformers.js can run segmentation, background removal, and even small VLMs (Phi-3-Vision, Gemma-3, Qwen2.5-VL) directly in a tab today.
- **Browser agents that click/scroll/fill forms via AI**: exists — Nanobrowser, Skyvern, Stagehand, WebBrain. Several already market "runs locally, bring your own LLM" as a privacy angle.

### b) The "near same to same" — GUIGuard (arXiv 2601.18842)
A research paper proposing the **exact same architecture** as this problem statement: a three-stage "Trustworthy Local–Remote Hybrid" pipeline:
1. **Privacy Recognition** — identify/localize sensitive regions on-device
2. **Privacy Protection** — apply configurable sanitization operators
3. **Task Execution** — remote agent operates on the protected screenshot

Built **GUIGuard-Bench**: 241 real recorded AI-agent sessions across apps/websites (banking apps, social apps, system settings), 4,000+ screenshots, region-level privacy annotations with human labels for: exact sensitive region, type, risk level, and whether the AI actually needed to see it for the task.

**Detailed failure breakdown from the paper:**
1. **Binary detection ("is there anything private on this screen at all?")** — models did reasonably well: ~89% correct on Android/phone screens, ~63% on PC/desktop screens.
2. **Precise localization ("point to exactly where it is")** — this is where it collapsed: ~52.9% (~53%) correct on phone screens, only ~13.5% correct on desktop screens.
3. **Full correct answer (right location + right type + right risk level + right "is this needed for task" judgment, all together)** — phone: under 9% (8.8%). Desktop: 0.6% — essentially never.

**Why desktop was so much worse than phone:** phone apps show one simple thing at a time (a chat, a form, a single card). Desktop screens are cluttered — many overlapping windows, dense tables, multiple pieces of text crammed close together — much harder to draw a precise box around the exact right item.

**Why some PII categories were harder than others:** surface-level items (a name, an ID number) are easy to spot — they look distinctly like themselves. Info that's only sensitive *by implication* (e.g., shopping history hinting at a health condition, browsing pattern suggesting political views — the "Inferences & Profiling" category) requires reasoning, not pattern-matching, and performed worst of all — recall around 2%, full-correct almost never.

**Underlying reason for failure:** these are big, general-purpose AI models built for broad reasoning, not narrow, repetitive, detail-obsessed spotting tasks. That mismatch is why small specialized detectors (regex, NER, face-detection) tend to outperform "ask one big AI to look at the whole screen and figure it out."

### c) Market conclusion
Nobody has shipped a *product* combining all three: live screen vision + real-time PII redaction + an agentic action loop, all client-side in a browser extension.
- Redaction tools operate on text prompts, not full visual screen state.
- Browser agents automate clicks but send raw screenshots to their BYOK LLM — no redaction step.
- The research world proved the concept (GUIGuard) but current models perform badly at the detection step under real desktop conditions.

**The actual gap = integration + accuracy under resource constraints, not invention of new primitives.**

---

## SECTION 4: FIT AGAINST EXISTING PERSONAL WORK

| Existing asset | Relevance |
|---|---|
| **Lady LISA — OS-level activity Watcher** (scoped to assistant surfaces after privacy concerns raised) | Same core idea — "observe the screen, act only on what's relevant" — needs retargeting from OS-level to browser DOM/canvas, plus formal redaction instead of scope-limiting |
| **Lady LISA — privacy-scoping design process** | Already went through the "what counts as sensitive, what gets blurred/masked" reasoning once; transfers directly |
| **Lady LISA — local-first, hardware-constrained design philosophy** (built for 4GB VRAM / 16GB RAM) | Directly matches the eval rubric — client-side resource utilization is 20% of the grade |
| **AnyRAG — local embeddings, offline inference, SQLite vector store** | Same "keep it on-device, only send derived data out" pattern, applied here to vision instead of text |

**Genuinely new territory:** browser extension architecture (content script ↔ background ↔ server) and a vision/OCR model pipeline, instead of the speech/text stack worked in previously.

---

## SECTION 5: EARLY SOLUTION SKETCH (first pass, before refinement)

1. **Capture** — grab the visible tab as canvas + read the DOM (cheaper than pure pixel analysis where structure is available).
2. **Local detection pass** (WebGPU via ONNX Runtime Web / Transformers.js):
   - Small face detector (BlazeFace-class) → bounding boxes to blur.
   - OCR on canvas (Tesseract.js WASM) for text regions.
   - Regex/lightweight NER on OCR'd text → flag emails, card numbers, phone numbers, names.
3. **Redact locally, before anything leaves the device** — blur/black-box flagged regions on the canvas itself; mask matched text in the DOM description. Nothing unredacted touches `fetch()`.
4. **Send structured, not raw** — prefer a redacted structured description (element positions, labels, button text) over images where possible; images as fallback only.
5. **Server returns an action, not data** — e.g. "click #submit-btn" or coordinates; client executes locally against the real (unredacted) page.
6. **Latency optimization** — diff against last screen state, only re-run detection on meaningful change, rather than every frame.

---

## SECTION 6: USER SCENARIOS DISCUSSED (in order)

### Scenario 1 — ISRO e-Procurement portal (eproc.isro.gov.in)
- **Procurement** = the process of buying things from outside suppliers/vendors.
- **Procurement officer** = staff member handling that buying process (like a purchasing manager).
- **Bid** = a vendor's offer (price, timeline, quality).
- **Evaluating vendor bids** = comparing offers to pick a winner.
- The portal is old/legacy: requires IE-compatible config (IE = Internet Explorer, an old browser), ActiveX controls (old plug-in software for extra page features), and Class-3 Digital Signature Certificates (an electronic ID/signature file proving identity online, same purpose as a physical signature).
- Screen shows: vendor PAN/GSTIN (tax ID numbers), bank account details, digital signature certificate holder's name, quoted prices (legally tender-confidential pre-award — leaking early can taint the whole bid, a compliance violation).
- A normal cloud AI browser agent would screenshot the whole screen and leak all of this. The ISRO-proposed architecture detects and redacts these fields locally, sends only sanitized structure to the cloud AI, gets back click/scroll instructions, executes locally where real data remains untouched.

### Scenario 2 — ISRO internal HR/deputation portal
- Different flavor: personal data about the employee themselves, not commercial/vendor data.
- Scenario: a scientist applying for foreign travel/deputation for a conference through an internal HR approval system.
- Screen shows: employee ID, service record number, passport number, medical fitness certificate details, salary/allowance figures, supervisor names/approval remarks.
- Same fix: local AI recognizes and blacks out passport number/salary/names before anything leaves the device; only form structure ("step 3 of 5") sent to cloud AI; cloud AI suggests next-step actions without ever seeing the real values.
- Point of this example: shows the concern isn't just about money/tenders — it's about any time an employee's own screen shows something private, which happens constantly in ordinary government paperwork.

### Scenario 3 — Bank call center agent / customer support dashboard
- Completely different domain — private company, not government.
- A customer service rep on a call pulls up a customer's account in CRM-style support software (used by banks, telecoms, insurers).
- Screen shows: customer's full account number, Aadhar/PAN or national ID, recent transaction amounts and merchant names, phone number, address, sometimes card details.
- Support dashboards are typically a mess — many tabs, nested menus, old clunky interfaces (same pain as the ISRO portals, private-sector version).
- Same problem: an off-the-shelf cloud AI browser assistant would leak all this constantly, across thousands of calls a day — a banking-regulation violation, not just embarrassing.
- Same fix applies identically.
- Conclusion drawn: this isn't a niche "government secrecy" problem — it's the same shape of problem anywhere sensitive on-screen data + AI-assisted navigation of a clunky interface coexist: banks, hospitals, insurance, telecom support, HR software, government portals. Likely why ISRO picked this as a competition problem — solving it well has value far beyond ISRO's own systems.

---

## SECTION 7: TERMINOLOGY CLARIFIED DURING SESSION

- **Redaction** = blacking out/hiding the sensitive part of something before anyone else sees it (same concept as black bars over lines in a government document, applied to a screen/image).
- **OCR (Optical Character Recognition)** = technology that reads text trapped inside an image/pixels and converts it into actual searchable/processable text characters. Clarified: OCR is the *solution* to the "text inside an image" problem, not blocked by images — that's literally its purpose.
- **NER (Named Entity Recognition)** = a small, purpose-built model trained only to classify whether a given word/phrase is a name, company, etc. — doesn't reason about anything, just classifies.
- **WebGPU** = browser-level tool that lets a website or extension use the computer's GPU (graphics card) directly, instead of only the CPU. GPUs are much faster at the parallel math AI inference requires (same kind of math used in rendering graphics/video games).
- **ONNX Runtime Web / Transformers.js** = libraries that take an already-trained AI model and know how to run it via WebGPU under the hood, without needing to write low-level graphics code. Analogy given: WebGPU is the "engine," these libraries are the "steering wheel and pedals."
- **Accessibility tree** = a simplified, text-only structural summary of a webpage, originally built for screen readers (for blind users). Lists every element with:
  - **Role** — what kind of thing it is ("button," "textbox," "heading")
  - **Name** — computed from visible text content; this is where **displayed values** show up
  - **Value** — for inputs, mirrors what's actually typed (`input.value`); this is where **entered values** show up
  - **Description / State** — extra context (checked, disabled, etc.)
  - Confirmed: it is computed *live* from the real DOM every time it's read — not a separate static structure. This means changing the underlying DOM text/value automatically updates the accessibility tree too.
  - Important catch discussed: if masking only changes *visual* appearance (CSS-only trick) without touching the real underlying text/attribute, the accessibility tree will still expose the real value, since it reads actual content/attributes, not rendered pixels. Masking must happen at the data level, not just the visual/styling level.
  - Images in the accessibility tree only appear as Role="image" + Name=`alt` text — no pixel data at all, by design (text-only structure, for screen readers).
- **DOM (Document Object Model)** = the full underlying page code/structure — more detailed than the accessibility tree, but noisier and can be fragile when JavaScript changes things dynamically.
- **Browser agent** = AI software that can actually use a browser like a person: read a page, click, type, scroll, switch tabs, navigate, carrying out multi-step tasks based on plain-language instructions — not just answering questions about a page.

---

## SECTION 8: WHY "BROWSER AGENT" SPECIFICALLY (vs. "security preprocessor" or generic edge AI)

- A **preprocessor** only describes the passive half of the system — its job ends the moment it hands off clean data; it doesn't act on what comes back.
- An **agent** specifically means something that closes the loop: perceives, decides, AND acts. The problem statement explicitly requires the server to return actions ("click submit," "scroll down") that something must receive and carry out — that acting-on-the-world step is why the word "agent" is used. The requirement to demonstrate "an end-to-end task" confirms this — a task getting *done*, not just data getting cleaned.
- "Browser" specifically (not generic "edge AI"): because the browser is where almost all of this kind of task actually lives (forms, dashboards, portals — all the scenarios discussed). Also because browser extensions already have controlled, sandboxed access to the page's DOM/pixels, and WebGPU/WASM already allow real local inference inside that sandbox — genuinely buildable right now, unlike a vague "generic edge device" framing.
- Underlying goal, stripped of ISRO framing: the browser-agent industry currently forces a choice between sending your screen to the cloud and getting a capable agent, OR keeping everything local and getting a dumb one. Nobody has proven both — real task-completion capability AND a hard privacy guarantee — at once. That's the actual gap.

---

## SECTION 9: HOW REAL BROWSER AGENTS WORK (industry research)

**Real products researched:**
- **Claude in Chrome (Anthropic)** — Chrome extension; side panel; reads pages, clicks, types, works across tabs; can run scheduled/background tasks.
- **Perplexity Comet** — an entire browser built around the agent concept, not just an extension.
- **OpenAI (via ChatGPT)** and **Google (Gemini Auto Browse in Chrome)** — building the same category.

**Why they all want this:** most useful internet tasks (booking, comparing prices, forms, checking statements) only exist as websites made for humans to click through — no clean API/connection point for software. So an AI that wants to complete real-world tasks has to operate the browser the same way a human does.

**Honest limitation noted:** one benchmark (OSWorld 2.0) found even the strongest model completed only about 1 in 5 realistic multi-step tasks correctly — an early, actively-competitive category, not a finished/reliable technology yet.

**The agent loop, four parts:**
1. **Perception** — read the current page.
2. **Reasoning** — decide the next single step toward the goal.
3. **Action** — click, type, scroll, navigate.
4. **Verification** — check what changed, then loop back to step 1.

**Perception, specifically — three channels, ranked by real-world preference:**
1. **Accessibility tree** — cheapest, most reliable; preferred by production tools (e.g., Microsoft's Playwright MCP explicitly avoids screenshots and relies only on this).
2. **Raw DOM** — more detail than the accessibility tree, but noisier/more fragile.
3. **Screenshot** — used as a last-resort fallback, mainly for things that aren't real page elements (canvas-drawn UIs, legacy visual-only systems, images).

General real-world pattern confirmed: **accessibility tree first → raw DOM if needed → screenshot only as last resort.** Noted this matches, independently, what was worked out in this session before this was confirmed by outside research.

---

## SECTION 10: DOM-FIRST REALIZATION (user-driven insight)

- User's own reasoning: since it's a browser extension, page content (what the user typed + how the page is structured/displayed) can be read directly — meaning OCR can potentially be skipped for most standard pages.
- Confirmed correct, with nuance:
  - **What's free from the DOM, no OCR needed:** all actual text (labels, paragraphs, table contents); live user-typed input (`input.value`); structure/layout (what's a button, what's nested where, visible vs. hidden); visual styling as data if needed.
  - **Where OCR/vision is still genuinely needed:** actual images/photos/scanned documents/faces (pixel content, not text); apps that render everything onto a single `<canvas>` instead of normal HTML elements (Figma, some dashboards/PDF viewers) — DOM sees only a blob, no readable text inside.
- Caveat raised: a purely DOM-based build, while genuinely useful, would not fully satisfy ISRO's explicit spec (which repeatedly names "Vision Transformer," "reads the screen," "blur faces") — the vision/CV path is the part they're actually testing as the hard, unsolved piece (per the GUIGuard findings). Recommended approach for the time-limited build: DOM-reading as the reliable main spine, plus one small, deliberately-chosen vision/OCR piece layered on top (e.g., face-blurring or OCR on one canvas element) to visibly demonstrate the vision requirement without needing a full production-grade CV pipeline.

---

## SECTION 11: OBJECTIVES OF THE PROBLEM STATEMENT, DISTILLED AND RANKED

Full list of what ISRO's spec is actually asking for, pulled directly from the text:
1. A local vision model reading the screen client-side (the "edge AI" piece).
2. A sanitizing filter that decides what's sensitive and strips/redacts before anything is sent (non-negotiable core — 40% of score combined).
3. A server that reasons only on the sanitized version.
4. That server returns actions, not data (e.g., "click this," "scroll down"), executed by the client.
5. A full working end-to-end demo — one complete task shown running through the whole chain live, not four disconnected pieces demoed separately.
6. Acceptable performance on normal/weak client hardware (20% of grade — explicit constraint, not an afterthought).
7. Low end-to-end latency (15% of grade) — correctness alone isn't enough if the loop is too slow to be usable; explicitly framed as balancing latency vs. accuracy.

**Priority table discussed for the ~18-day build window:**
| Piece | Essential for demo? |
|---|---|
| Local text/PII detection + blackout | Yes — heart of the grading rubric |
| Local face-blur | Nice-to-have — stretch goal |
| Full Vision Transformer reading pixels | Can substitute with OCR + DOM reading (cheaper, still "reads the screen") |
| Server sending back real click actions | Yes, but can be simple rule-based logic, not a full agentic LLM |
| One complete end-to-end task | Yes — pick ONE task and make it work reliably |
| Handling every kind of PII | No — pick 2-3 clear categories (emails, phone numbers, card numbers) and nail those |

---

## SECTION 12: POINTS 5, 6, 7 EXPLAINED IN DEPTH (as separately requested)

**Point 5 — full working end-to-end demo:** means showing one continuous, live chain — screen read → sensitive bits blacked out → cleaned version sent to server → server decides an action → browser performs that action → something visibly changes on screen as a result — all in one run, on one task. Not separate clips of each piece working alone. Example given: form-filling — screen read, name/email fields flagged and hidden, server says "click next field and type 'submit,'" extension actually does it live.

**Point 6 — client-side resource utilization:** about how much CPU/GPU/RAM the local AI eats up. Concern: a heavy vision model needing a powerful GPU would technically satisfy "reads the screen locally" but make an ordinary laptop unusable in practice. ISRO explicitly grades whether the local AI stays light and runs fine on an ordinary laptop, not just high-end hardware. Directly tied back to the user's own hardware constraint (i5, RTX 3050, 4GB VRAM, 16GB RAM) as a natural design target — if it runs comfortably there, it's likely hitting what ISRO wants.

**Point 7 — end-to-end latency:** the total time for the whole chain in Point 5, start to finish (capture → detect → redact → send → server reply → action executed). If that loop takes many seconds every time the AI needs to look at the screen again, the tool becomes impractical even if every step is individually accurate. Explicitly weighed against accuracy on purpose per the original spec's own wording ("balance inference latency vs. accuracy").

**Combined meaning of 5+6+7:** together they test whether this is a real, usable browser extension prototype — not just a proof-of-concept sketch.

---

## SECTION 13: "IS THIS FEASIBLE / WHY NO COMPETITION" DISCUSSION

- Clarified: the architecture is conceptually simple ("simple to draw"), but simple-to-draw ≠ simple-to-build-well; the actual difficulty is engineering execution (speed/accuracy tuning, edge cases), not the concept itself.
- Why no one's solved it well already, two reasons discussed:
  1. Low urgency — most people using AI browser tools aren't handling government-secret pricing or bank details on screen, so there's been no big commercial push for this specific combination (see-locally + redact-locally + still-let-AI-act).
  2. Genuine difficulty — the one serious attempt (GUIGuard) tried the "obvious" approach (ask a big AI to look at the whole screen and spot sensitive info) and got only 1.4% accuracy on desktop — meaning the easy-sounding version doesn't work, and nobody has yet built the boring, layered (small dedicated detectors) version as a finished product.
- Conclusion: "no competition" here means "market didn't demand it + the one real attempt found it's harder than it looks" — a fundamentally different situation from a market gap due to lack of any real problem.
- Recommendation given: worth submitting IF scoped down hard for the ~18-day deadline — pick one narrow, reliably-working slice rather than attempting the full ISRO spec end-to-end; a small thing that works beats a big thing that's 70% done on demo day.

---

## SECTION 14: CREATIVE IDEAS PROPOSED BY USER, AND FEASIBILITY VERDICTS

### Idea A — Mirrored/cloned shadow tab with substituted values
User's proposal: open the same site in a second, background/localhost-style tab; whatever is typed in the real tab gets mirrored into the clone but with different (fake/encrypted) values instead of the real ones; the AI operates on/reasons about this clone instead of the real page.

**Research finding:** the underlying mirroring mechanic is real — an existing open-source extension called **MirrorTab** captures clicks/typing on one tab and replays them live onto a second tab, proving the raw plumbing works.

**Verdict — not recommended, for concrete reasons:**
- The clone tab would need its own valid authenticated session; most sensitive sites (banking, HR, procurement) require login, and fake typed values would be rejected/error out or show a broken, invalid version of the workflow.
- Sites actively detect duplicate/near-identical parallel sessions on the same account as a fraud/bot signal — risk of the real account getting flagged or locked, a worse outcome than the privacy problem being solved.
- Doesn't add anything beyond simpler local redaction/tokenization (Idea B) — same end goal ("AI sees structure, not real values") achieved with far fewer moving parts and no new failure modes (session-sync issues, auth, bot detection).
- Overall recommendation: drop this one, build the simpler approach instead.

### Idea B — Reversible "star it out" masking (password-field-style), applied to any sensitive field
User's proposal: apply the same masking logic passwords already use (shown as dots, revealed via a visibility toggle) to every sensitive field, with a way to bring the real value back when needed.

**Verdict — confirmed as a genuinely good, real insight; recommended to build.**
- Precedent: password managers already do exactly this — real value stored, dots displayed, only the tool itself can reveal it.
- Mechanism agreed on: detect sensitive value → swap for a placeholder/token (e.g. `[FIELD_3]`) in the actual underlying DOM data (not just a CSS visual trick) → keep a local-only map of placeholder → real value inside the extension's own storage → whatever leaves the device (screenshot, structured data sent to cloud AI) only ever sees the placeholder → when the real action needs to happen (e.g. actual form submission), the extension looks up the real value locally and substitutes it back in, right before executing, never over the network.
- Clarified this solves two distinct leaks with one mechanism:
  - The "someone glances at the screen / takes a screenshot" leak — screen shows stars.
  - The "data going out over the network to the cloud AI" leak — cloud AI only ever receives the placeholder.
- Later refined further (Section 15) into the single-operation insight: masking the underlying DOM data once automatically produces a masked accessibility tree AND a masked screenshot, since both are just downstream views of the same source data — no need for three separate masking systems.

### Idea C (raised alongside B) — automatic star-masking specifically at screenshot-capture time, reversible via the extension, framed as creating "a new column" accessible only via the extension
Effectively the same underlying mechanism as Idea B, described from the screenshot/visual angle rather than the network-sending angle. Folded into the same recommended design — same real-value-behind-a-placeholder logic, applied at both the visual (what's shown/screenshotted) and network (what's sent to the server) layers, using the same token/map system underneath.

---

## SECTION 15: THE "ONE OPERATION, THREE CHANNELS" REALIZATION

**User's reasoning walked through, step by step:**
1. Established what actually gets sent to a cloud AI besides a screenshot: real systems typically send screenshot **plus** a structured text description (DOM or accessibility tree) — because pixel coordinates/screenshots alone are unreliable for telling an AI exactly what to click; structured text is what makes "click the Submit button" reliable.
2. This meant: masking only the screenshot while leaving structured text unmasked would still leak real values through that second channel.
3. Key simplification reached: a screenshot is just a rendered photo of whatever the DOM currently contains. So if the actual DOM value/text is changed (swapped for stars/placeholder) at the source, BOTH the screenshot (naturally renders the masked version) AND the structured text sent to the cloud AI (already masked, since it's read after the swap) are automatically covered.
4. Conclusion: **one masking operation at the DOM/data level, not two or three separate ones** — collapses the whole problem into a single fix point.
5. Confirmed remaining gap: this does nothing for actual image/video pixel content (a real photo of a face inside an `<img>` tag) — masking DOM *text* doesn't touch pixel data sitting inside media elements. That case still needs its own separate handling:
   - Simple route: CSS blur applied directly to flagged image/video elements before the screenshot is taken — no AI model needed, pure styling change, effective because it changes what's actually rendered/captured.
   - Selective route: an actual local face-detection model, for cases needing to distinguish "this image has a face" from "this image is just a logo/icon."

---

## SECTION 16: REAL-TIME LOCAL VISION MODELS — MEDIAPIPE DISCUSSION

- User referenced Zoom's background blur, Google Meet's face blurring, Snapchat/Instagram filters as proof that fast, narrow, real-time local detection models are achievable in consumer products, and asked to get "those" models specifically.
- Research finding: the exact proprietary models (Zoom's, Meet's, Snapchat's specific implementations) are not available/obtainable directly — they're each company's own proprietary trained models.
- However, the equivalent open, usable technology exists: **MediaPipe** (Google's open-source framework), specifically **MediaPipe Face Detection**, runnable via **TensorFlow.js**, directly in-browser, no server needed. **BlazeFace** also named as the same class of tiny, real-time, browser-friendly face-detection model.
- Conclusion: same category of model, same real-time performance class as the consumer products referenced, genuinely usable inside a browser extension — just under the open/public name (MediaPipe/BlazeFace + TensorFlow.js) rather than the proprietary in-house versions.
- This directly reinforces the earlier distinction (Section on GUIGuard findings) between narrow, single-job detection models (fast, proven at consumer scale — Zoom/Meet/Snapchat-class) versus a full general-reasoning VLM "looking at the whole picture" (slow AND less accurate, per GUIGuard's own findings).

---

## SECTION 17: FULL DATA-CATEGORY TAXONOMY (final, consolidated version)

What can actually appear on a webpage, fully enumerated across the conversation:

1. **Entered values** — what the user types into a field (`input.value`); editable; lives in the DOM/accessibility tree Value property.
2. **Displayed values** — text the server already sent and is showing on-screen (e.g. account numbers in a table, a name in a profile header); not user-editable; lives in the DOM/accessibility tree as text content/Name property.
3. **Images/media** — actual photos, avatars, scanned documents, video thumbnails; pixel data, not text; DOM manipulation cannot alter what's *inside* an image; only appears in the accessibility tree as Role="image" + `alt` text (no pixel data there at all).
4. **Canvas-drawn content** — some sites (signature pads, certain dashboards, design tools) draw the whole interface as one image via code instead of real page elements; to the DOM/accessibility tree, this looks like a single blob with nothing readable inside, same practical problem as images.
5. **Hidden/background data** — technically present in the page's code but not currently visible (hidden fields, metadata); exists in the DOM even though a screenshot wouldn't show it.
6. **URL** — raised as an additional, previously-uncovered channel: web addresses can carry sensitive data directly in the address itself (e.g., an account number or email embedded in a query string); needs the same text-masking treatment (regex/pattern detection) before being read/forwarded, since it's a separate channel from the on-page accessibility tree/DOM content.

**What does NOT need masking (structural/non-personal data):**
- Roles and hierarchy (what kind of element something is, nesting) — categorical, not personal.
- Positions/coordinates — geometry, needed for the AI to aim actions like "click here," not sensitive.
- Interactive states (checked/unchecked, enabled/disabled, expanded/collapsed) — structural, not personal.
- The user's own task instruction to the agent — already deliberately shared by the user, not extracted from the page.

---

## SECTION 18: ACCESSIBILITY TREE — DETAILED PROPERTIES (as specifically researched)

Confirmed via direct lookup:
- **Role** — the type of element ("button," "textbox," "heading," "image," etc.)
- **Name** — the accessible name; for most elements, computed from visible text content (this is where **displayed values** live); can also be overridden by attributes like `aria-label`.
- **Value** — present for input-type elements (textboxes, sliders); mirrors the actual current value (this is where **entered values** live).
- **Description** — additional context, separate from Name (via `aria-describedby` etc.).
- **States** — e.g. checked, disabled, expanded.

Confirmed: the accessibility tree is **computed live from the real DOM** at query time — it is not a separately-maintained static structure. This was the basis for confirming that masking the underlying DOM data (not just its CSS appearance) automatically produces a correctly-masked accessibility tree as well, since both draw from the same live source.

Confirmed: images in the accessibility tree carry **no pixel data whatsoever** — only Role="image" and the `alt` text as Name. The tree was built for screen readers (for blind users), so it is inherently text-only by design. This directly answered the question of whether images could be "blurred out of the accessibility tree" — there was nothing pixel-based there to blur in the first place; the only thing needing masking in that channel is the `alt` text itself, using the same text-masking treatment as any other sensitive text.

---

## SECTION 19: FINAL CONSOLIDATED ARCHITECTURE (as it stood by the end of the session)

**One-sentence summary:** A browser extension that reads the page mostly through the accessibility tree/DOM (fast, free, accurate), falls back to local vision/OCR only where DOM data can't explain what's on screen, masks anything sensitive at the data source (not just visually) before anything leaves the device, and lets a cloud AI return actions based only on the sanitized version.

**Full pipeline:**

1. **Read the page** — accessibility tree/DOM first: structure, roles, positions, states, text content (both displayed and entered), and the current URL. Screenshot only as a fallback for canvas-drawn content or where structure alone isn't sufficient.

2. **Detect what's sensitive, locally:**
   - Regex for fixed-pattern items (emails, phone numbers, card/account-style numbers, PAN/GSTIN-style formats) run over text content and the URL.
   - Small NER model for names/companies (things without a fixed pattern shape).
   - Flag image/media elements for the visual step (avatars, uploaded documents, faces) — via simple heuristics (size/position) for a demo, or a local face-detector (MediaPipe/BlazeFace via TensorFlow.js, or ONNX Runtime Web / Transformers.js) for a more real implementation.

3. **Mask at the source, once:**
   - Swap flagged text values/content for placeholder tokens (e.g. `[NAME]`, `[ACCOUNT_NO]`) directly in the underlying DOM data/value (not merely a CSS visual trick), so the change propagates automatically to both the accessibility tree and any screenshot taken afterward.
   - Keep a local-only map (placeholder → real value) inside the extension's own storage, never transmitted, so the real value can be restored on-device when needed.
   - Apply the same masking treatment to the URL if it contains sensitive patterns.

4. **Blur flagged images locally** — CSS blur on flagged image/video/canvas elements before any screenshot is captured (simple, no-AI route), or a local face-detector for selectivity (real route) — the one channel that genuinely requires separate handling, since masking DOM text does not touch pixel content.

5. **Send only the sanitized version to the cloud AI** — structure, positions, states (all safe/non-personal by nature), masked text, masked URL, blurred images if any screenshot is included at all.

6. **Cloud AI reasons and responds with an action** — e.g. "click this," "type into that field," "scroll here" — based only on the sanitized version; can be a lightweight rule-based system or small hosted model for the demo, not necessarily a full frontier-scale reasoning system.

7. **Execute locally, with real data restored** — immediately before the action actually needs to happen (e.g. a real form submission), the extension looks up the real value from its local map and substitutes it back in — entirely on-device, never sent over the network.

**Result:** the cloud AI receives everything it structurally needs to reason and act (what things are, where they are, what state they're in) while every piece of actual personal/sensitive content — typed or displayed, text or image, even in the URL — stays on the device the entire time, only ever leaving in masked form.

**Scoped-down version recommended for the ~18-day build window:**
- Must-have: accessibility-tree/DOM reading + regex/NER masking on text + one complete demo task running reliably end-to-end (e.g. a form-filling flow).
- Stretch, if time allows: one small vision piece (face-blur OR OCR-on-canvas) to visibly demonstrate the vision requirement ISRO explicitly asked for.
- Explicitly skipped for the demo: redacting every possible PII category; a fully autonomous reasoning agent server-side; matching ISRO's full Vision Transformer spec pixel-for-pixel.

**Why this specific shape maps to the grading rubric (recap):** accurate extraction (accessibility tree/DOM read is highly accurate) → PII recall/precision (regex+NER reliable on text) → redaction precision (source-level masking is deterministic — no partial misses like there might be from a vision-only pass) → low resource use (accessibility tree/DOM reading is nearly free; local face-detection via WebGPU is lightweight; avoids the failure mode of a full general-reasoning VLM) → low latency (not running heavy vision on every frame, only on meaningful change, and mostly relying on cheap structural reads rather than image analysis).

---

## TOOLS AND TECHNIQUES NAMED ACROSS THE SESSION (consolidated list)

- **WebGPU** — browser access to GPU for fast local AI inference.
- **ONNX Runtime Web** — library to run trained models via WebGPU in-browser.
- **Transformers.js** — library to run trained models via WebGPU in-browser, alternative/complementary to ONNX Runtime Web.
- **Tesseract.js** — WASM-based OCR library, for reading text out of images/canvas content.
- **MediaPipe (Face Detection)** — Google's open-source framework for real-time local detection tasks (the open equivalent of what powers Google Meet's background blur).
- **BlazeFace** — small, real-time, browser-friendly face-detection model (same class used by MediaPipe).
- **TensorFlow.js** — the library MediaPipe-based models run through in-browser.
- **Regex (pattern matching)** — for fixed-format PII (emails, phone numbers, card/account numbers, PAN/GSTIN-style IDs).
- **NER (Named Entity Recognition)** — small local model for detecting names/companies (non-fixed-pattern PII).
- **MirrorTab** — existing open-source extension proving tab-to-tab action mirroring is technically possible (relevant to the rejected Idea A, mirrored/cloned tab).
- **Playwright MCP (Microsoft)** — cited as a real production example that deliberately favors the accessibility tree over screenshots for browser automation.
- **Reference existing redaction extensions found in market research:** Private Guard, PrivacyScrubber, PII Guardian, ChatWall (all text-prompt-level PII redaction, not full-screen/visual).
- **Reference existing browser-agent products/projects found in market research:** Nanobrowser, Skyvern, Stagehand, WebBrain, Claude in Chrome, Perplexity Comet, ChatGPT's agent mode, Google Gemini Auto Browse.
- **GUIGuard / GUIGuard-Bench (arXiv 2601.18842)** — the closest existing academic "near same to same" work, proposing the identical three-stage local-remote hybrid architecture and providing the benchmark accuracy numbers referenced throughout.
