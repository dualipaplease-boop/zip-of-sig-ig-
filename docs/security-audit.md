# SentryAgent — Security & Privacy Audit (v2.6.0)

Scope: every network and trust boundary in the system as implemented in this
repository. **No CVSS scores are assigned** — CVSS requires an exploitable
vulnerability in a deployed product with a defined attack surface; several
items here are *architectural limits* or *mitigated findings*, and scoring
them would be meaningless theater. Each finding is classified:
**FIXED** (was exploitable/leaky, now remediated in v2.6.0), **LIMITATION**
(structural, documented, with mitigations), or **INFO** (behavior to know).

The audit question applied at every boundary: *can raw sensitive data leave
the device here, and can untrusted input reach the DOM here?*

---

## 1. Boundary: Web Page → Extension (inbound)

**FIXED (P0) — untrusted model/remote output can no longer reach the DOM as
HTML or execute code.**

- Before v2.6.0, action values from the reasoner flowed toward the DOM with
  weaker validation; the confirmation path was vulnerable to HTML
  injection via model-supplied strings.
- Now: `validatePlannedAction` (localPlanner.ts) rejects non-objects,
  unknown action verbs, missing/oversized targets, and non-string values.
  Unknown or missing risk tiers fail **conservative** (TIER_4, the highest
  scrutiny), never permissive.
- The TIER_4 confirmation modal (actionDispatcher.ts) is built exclusively
  with `createElement` + `textContent` — model strings are never parsed as
  HTML. A prompt-injection that makes the model say `<img onerror=…>` gets
  displayed as inert text.
- TYPE actions only accept (a) vault tokens (rehydrated locally just before
  dispatch) or (b) values that pass a **strict** sensitive-text check
  (context-strict mode: even name-like text from the model is rejected).
- NAVIGATE actions only follow `http(s)` anchor `href`s on real `<a>`
  elements, with embedded-credential detection (user:pass@, access_token,
  …) → rejected.
- The reticle, modal, and HUD never use `innerHTML`.

**INFO — content script sees the page's DOM.** Inherent to any
form-sanitizing extension; `host_permissions: <all_urls>` is required for
the feature. Values are read in-memory, tokenized, and never sent raw.

## 2. Boundary: Extension → Reasoning Server (egress)

This is the most critical boundary. Three independent layers:

**Layer 1 — tokenization at the source (vault.ts + checksums.ts).**
Field values are replaced by semantic tokens (`<AADHAAR_ID_1>`, `<PAN_NO_1>`,
`<CONFIDENTIAL_VAL_1>`, `<PERSON_1>`) in the DOM *before* scene-graph
construction. Classification is checksum-validated where a checksum exists
(Verhoeff, Luhn, PAN entity char, GSTIN) and context-gated for names.

**Layer 2 — label sanitization (egressVerifier.sanitizeLabel).**
Element labels/visible text that contain sensitive substrings (e.g. a
heading "Authorized signatory: 98451 23456") are pattern-matched,
checksum-validated, and replaced with tokens. Overlapping matches resolve
to the earlier/longer (more specific) pattern.

**Layer 3 — fail-closed pre-flight seal (verifyAndSealPayload).**
Before any bytes leave: (a) canary leak check — a random per-session canary
embedded in the pipeline must not appear in the serialized payload;
(b) known-value residual scan — every real value the vault holds is
searched for in the serialized nodes; (c) SHA-256 digest computed over the
canonical node JSON. Any failure aborts transmission.

**LIMITATION — the digest is an integrity check, not a cryptographic
signature.** The server recomputes the digest over the received nodes and
rejects mismatches (HTTP 400). This detects corruption, middle-box
modification, and client/server serialization drift **within a local trust
domain**. It does not authenticate the client (no shared key, no client
certificate) and does not prevent a compromised *client* from sealing a
payload it constructed. For a LAN/localhost deployment (this system's
stated deployment), that is the correct level of assurance; publishing it
as a "signed wire protocol" would be wrong, and the docs no longer do.

**FIXED (P0) — residual-PII gap in labels.** Earlier builds tokenized field
*values* but not free-text *labels*; a label containing a phone number or
PAN would egress raw. `sanitizeLabel` closes this.

**LIMITATION — the LLM can reason about tokens.** The server (and the LLM
it calls) sees `<PERSON_1>` next to a label like "Employee Full Name". An
adversary who controls the LLM endpoint could infer *which* token is which
field. The values themselves remain unrecoverable locally; the mapping is
the residual exposure. Mitigation: tokens are session-scoped, the server is
localhost-bound, and L0 mode eliminates the channel entirely.

## 3. Boundary: Server → LLM Backends

**INFO.** The LLM provider (Ollama local / Groq / OpenAI-compatible)
receives the *same* sanitized scene graph plus the SYSTEM_PROMPT. No PII.
API keys are read from env vars (`LLM_API_KEY`) only — never committed,
never logged.

**LIMITATION — prompt-injection from page content into the LLM.** Sanitized
labels are model input; a malicious page could craft label text to steer
the LLM. Consequence is bounded by the client-side gate: whatever the LLM
proposes must pass `validatePlannedAction`, the local risk classifier, and
the TIER_4 modal. The worst case is a *suggested* click the user can deny —
not a leak (labels were already sanitized) and not arbitrary code (no JS
execution path from model output).

## 4. Boundary: Model Output → Execution (inbound, local)

Covered in §1. Additional guarantees:

- **Effective tier = max(model claim, local classifier).** The local
  classifier (actionDispatcher.classifyLocalRisk) independently flags
  NAVIGATE → TIER_3, submit/bid/tender/authorize/burn-labeled clicks →
  TIER_4, sensitive-context input → TIER_3. The model can only raise.
- **No arbitrary action verbs.** `VALID_ACTIONS = {CLICK, TYPE, FOCUS,
  SCROLL, NAVIGATE}`; everything else is null.
- **Rehydration is the only path that touches real values**, and it
  operates in-page memory immediately before dispatch.

## 5. Boundary: Vision Pipeline (pixels)

**INFO — pixels never leave the device at any disclosure level.**
BlazeFace and DBNet run in-browser (onnxruntime-web, WebGPU→WASM). Canvas
pixels are read via `getImageData` (same-origin canvases only; a
*tainted* cross-origin canvas throws and is handled by redacting the whole
canvas as a conservative fallback — the leak direction is *more* redaction,
never egress).

**FIXED (P1) — BlazeFace misconfiguration that would have redacted nothing
or the wrong region.** Verified empirically (tools/verify_onnx_models.py):
inputs are 0..1 (not ±1), fed by explicit name; output layout is
`[ymin, xmin, ymax, xmax, keypoints]` (not `[xmin, ymin, …]`); `N` can be 0
and ORT's static shape metadata is unreliable. The engine now parses the
verified layout and clamps coordinates. Per-box score is not exposed by the
graph → confidence is reported as the 0.5 gate lower bound, not a
fabricated number.

**FIXED (P2) — stroke detector background bug.** `detectStrokeBoundingBox`
previously excluded canvases by width (`> 300px`) — neither correct nor
described. Replaced with corner-block background sampling
(Manhattan distance > 60, alpha > 50, brightness < 120), which works on
both light and dark backgrounds.

## 6. Boundary: Storage & Persistence

**INFO — the vault is memory-only.** Tokens and real values exist in the
content script's memory for the tab's lifetime; `chrome.storage` is used
only for UI preferences. Closing the tab destroys the vault. Restore works
within a session; after a page reload the original DOM values are gone
(re-hydration is impossible by design — that is the point).

**LIMITATION — in-memory values are readable by a compromised same-origin
page's JS.** Any extension with `scripting` over `<all_urls>` shares this
exposure class; there is no browser API for truly secret in-page values.
The threat model assumes the page itself is not hostile (the user is
actively using it); a hostile page can trivially read its own form fields
without SentryAgent.

## 7. Boundary: Server Deployment

- Binds `0.0.0.0` for development convenience (env-overridable). **Deploy
  guidance:** for anything beyond a trusted LAN, put it behind TLS and
  restrict by network policy — the protocol has no authentication (see §2
  LIMITATION).
- CORS allowlist: `chrome-extension://`, `null` (file://), localhost
  prefixes only. Other origins get no CORS headers (browser blocks).
- 2 MB request cap → 413 (DoS surface reduction).
- `ThreadingHTTPServer` with daemon threads; body read is bounded; JSON
  parse errors → 400, never a stack trace to the client.

## 8. Supply Chain

- `npm audit` on the extension: **0 vulnerabilities** (after bumping
  `vite` 6.4.2 → 7.3.6 / esbuild 0.28.2 — both were dev-only toolchain
  vulns, never shipped in `dist/`).
- ONNX models: sha256-pinned by presence in the repo; spec verified with
  `tools/verify_onnx_models.py` (onnxruntime 1.30.0).
- Server: **zero third-party dependencies** (stdlib only).
- Playwright (dev-only) for the browser audit.

## 9. Findings Summary

| # | Boundary | Severity | Status |
|---|---|---|---|
| S1 | Model output → DOM (HTML/JS injection) | High (pre-v2.6) | **FIXED** — textContent modal, strict validation, local risk gate |
| S2 | Labels leaking raw PII to server | High (pre-v2.6) | **FIXED** — `sanitizeLabel` + fail-closed residual scan |
| S3 | Client digest trusted without recompute | Medium (pre-v2.6) | **FIXED** — server independent recompute, 400 on mismatch |
| S4 | BlazeFace spec wrong (±1, column order) | Medium | **FIXED** — verified layout, clamped parsing |
| S5 | Stroke detector width bug | Low | **FIXED** — corner-background sampling |
| S6 | Digest marketed as "signed" | Info | **FIXED** — documented as integrity-only |
| S7 | L3 disclosure advertised | Info | **FIXED** — capped to L2, documented as placeholder |
| S8 | LLM can map tokens→fields | Low (structural) | **LIMITATION** — localhost trust domain; L0 eliminates channel |
| S9 | Compromised page reads in-memory vault | Medium (structural) | **LIMITATION** — inherent to in-page redaction; threat model documented |
| S10 | No server authentication | Medium (structural) | **LIMITATION** — local/LAN deployment; TLS + network policy guidance |
| S11 | No committed ONNX timing benchmarks | Info | **FIXED** — unmeasured numbers removed from docs |
