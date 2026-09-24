# SentryAgent — Architecture (v2.6.0)

This document describes the system **as implemented** in this repository.
Where earlier documentation diverged from the code, the code wins; such
divergences are listed in [docs/CHANGELOG.md](CHANGELOG.md) (v2.6.0
corrections table).

---

## 1. Trust Model in One Paragraph

The **local extension is the security boundary**. A remote reasoning server
is an *optional* advisor: it receives an opaque, sanitized scene graph
(opaque node IDs, semantic tokens, sanitized labels — no raw PII, no pixels,
no cookies/localStorage), and it returns a *proposal* of actions. Every
proposal passes a local validator (`validatePlannedAction`) and a local risk
classifier before anything touches the DOM, and every high-stakes (TIER_4)
action requires explicit human authorization in an on-page modal rendered
with `textContent` only (no HTML parsing of model strings).

```
┌────────────────────────────── BROWSER (trusted) ──────────────────────────────┐
│                                                                                │
│  Web Page ──▶ Track 1 (DOM scanner) ──▶ checksums.ts ──▶ LocalInversionVault   │
│              (content.ts: fieldContext-      (Verhoeff/Luhn/      (token map,  │
│               aware classify)           PAN/GSTIN/IFSC/bank/       in-memory,  │
│                                         name-context)            ephemeral)    │
│                                                                                │
│              Track 2 (vision, L2 only)                                        │
│              visionEngine.ts ──▶ blazeface.onnx (faces)                        │
│                                 ocr-det.onnx (text regions) → ccl.ts clusters  │
│                                 → burnPixelRedaction (in-place pixel burn)     │
│                                                                                │
│  Both tracks ──▶ buildOpaqueSceneGraph (opaqueId + sanitizeLabel)              │
│              ──▶ disclosure.ts: determineDisclosureLevel                       │
│                    L0 → local plan only (zero egress)                          │
│                    L1/L2 → FailClosedEgressVerifier.verifyAndSealPayload       │
│                               (canary + residual check + SHA-256 digest)       │
│                                                                                │
│  Reasoner response ──▶ localPlanner.validatePlannedAction (fail-closed)        │
│                 ──▶ actionDispatcher: effective tier = max(model, local)       │
│                      TIER_4 → Local Risk Gate modal (textContent)              │
│                      TYPE → vault-token / verified-non-sensitive values only   │
│                      NAVIGATE → http(s) anchor href, no credentials            │
│                 ──▶ rehydrateTrackedValues (local) → dispatch DOM event        │
└────────────────────────────────────────────────────────────────────────────────┘
                    │  (L0: nothing leaves)
                    ▼
        POST http://localhost:8000/api/v1/plan
        body: { digestSha256, nodes[], userGoal, history, checklist }
        server: independently recomputes SHA-256(nodes) → mismatch ⇒ 400
        server: LLM (Ollama / Groq / OpenAI-compatible) or built-in heuristic
        response: { digestVerified, verifiedDigest, actions[], checklist[] }
```

---

## 2. Module Map (extension/src)

| Module | Responsibility | Pure (unit-testable in Node)? |
|---|---|---|
| `types/index.ts` | Shared types; `PlannedAction` (wire `value` → internal `payloadValue`); real `ExtensionMessage` union | types only |
| `config.ts` | Endpoints (`http://localhost:8000`), model URLs, ONNX session management | — |
| `privacy/checksums.ts` | Verhoeff (Aadhaar), Luhn (cards), PAN entity-char, GSTIN (embedded PAN), whole-value phone/landline, passport, IFSC, bank account (Luhn-failing 13–19 digits), financial quote, context-gated person name. Classification order is financial **before** phone (lakh-grouped amounts can look like 10-digit mobiles) | ✅ |
| `privacy/vault.ts` | `LocalInversionVault`: ephemeral `Map` token→value; stable tokens per value (reverse index); masked inspection view; `rehydrate()` replaces tokens locally | ✅ |
| `privacy/disclosure.ts` | Minimum-disclosure ladder: L0 (local only), L1 (anonymized DOM egress), L2 (L1 + on-device vision), L3 (placeholder, capped to L2); `AUTO` → L2 if canvases else L1 | ✅ |
| `vision/visionEngine.ts` | Loads/runs both ONNX models (WebGPU→WASM fallback); verified BlazeFace layout `[ymin,xmin,ymax,xmax,keypoints]`, 0..1 input, explicit-name feeds, int64 `max_detections`; DBNet ImageNet-normalized dynamic input; in-place redaction burning; corner-background stroke detection for signature pads | partial (ORT needs browser) |
| `vision/nms.ts` | `computeIoU` + `applyNMS` (shared, defensive secondary NMS) | ✅ |
| `vision/ccl.ts` | 8-connectivity BFS connected-component labeling for DBNet probability maps | ✅ |
| `network/egressVerifier.ts` | `sanitizeLabel` (pattern-validated PII → vault tokens, overlap resolution); canary (`crypto.getRandomValues`); `verifyAndSealPayload` (canary leak → block; known-value residual → block; SHA-256 digest over canonical node JSON) | ✅ |
| `execution/localPlanner.ts` | `validatePlannedAction` (untrusted model output; unknown/missing tier → TIER_4; >5000 chars or non-string value → null) + `localHeuristicPlan` (deterministic L0/offline fallback; mirrors the server heuristic) | ✅ |
| `execution/actionDispatcher.ts` | Resolves opaqueId → element; `classifyLocalRisk` (independent of model claim); effective tier = `max(model, local)`; TIER_4 modal (100% `textContent`); TYPE guard (vault tokens or strict non-sensitive); NAVIGATE guard (http(s) anchor, no creds); pre-submit rehydration | partial (DOM) |
| `execution/cursorReticle.ts` | Cosmetic mission-control HUD reticle during autonomous actions (all `textContent`, `pointer-events: none`) | — |
| `content/content.ts` | Track 1 scanning (field-context aware), scene graph construction (opaqueId dedupe), vision pass gating (L2), autonomous step loop with local fallback on server failure, submit-interceptor rehydration | partial (DOM) |
| `background/background.ts` | MV3 service worker: multi-hop session loop (survives navigations), `GET_LOCAL_FALLBACK_PLAN` on fetch failure, session state/abort, history + status tracking | — |
| `popup/*` | Cyber-defense console: perimeter status, vault metrics, Scan & Sanitize, Restore, End-to-End Agent Loop, Multi-Hop Session (goal prompt) | — |

## 3. Server (server/app.py)

- **Standard library only** (`http.server.ThreadingHTTPServer`, `hashlib`,
  `json`, `urllib`). No FastAPI, no pip installs.
- `GET /health` — status, LLM provider, `digestVerification: independent-recompute`.
- `POST /api/v1/plan` — validates the body (object, `nodes` array, ≤ 2 MB),
  **recomputes** `SHA-256(json.dumps(nodes, separators=(',',':'), ensure_ascii=False))`
  and compares with the client's `digestSha256`; mismatch ⇒ HTTP 400
  `{digestVerified:false, expectedDigest, receivedDigest}`. On success the
  plan response carries `{digestVerified:true, verifiedDigest, planId,
  actions[], checklist[]}`.
- **LLM providers:** `LLM_PROVIDER=auto|ollama|groq|openai` (env:
  `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`). If all LLMs are unreachable,
  a built-in deterministic heuristic planner (kept consistent with
  `localPlanner.ts`) serves plans — the system never fails silently.
- CORS: allowlist of `chrome-extension://`, `null` (file://), and
  localhost origins only.
- The SYSTEM_PROMPT to the LLM reiterates: operate only on opaque IDs and
  tokens; never guess PII; every action must target a valid `opaqueId`;
  honor risk tiers. **Prompt compliance is not a security control** — the
  client-side gate is.

## 4. Disclosure Ladder (implemented semantics)

| Level | Egress | When |
|---|---|---|
| L0 | **None.** Local heuristic plan only. | Explicit user request |
| L1 | Anonymized opaque scene graph (no canvas pixel access) | `AUTO` on text-only pages |
| L2 | L1 + on-device vision enabled (pixels redacted in place; only tokens/labels egress) | `AUTO` on canvas pages; explicit L2 |
| L3 | **Placeholder — resolves to L2.** No "sanitized full frame" transport exists in this build. | — |

## 5. Risk Tiers

| Tier | Meaning (enforced locally, not by the model) |
|---|---|
| TIER_1 | Browsing/engagement (focus, scroll, benign clicks) |
| TIER_2 | Data entry of non-sensitive or vault-token values |
| TIER_3 | Navigation / sensitive-context input; elevated scrutiny |
| TIER_4 | Irreversible statutory actions (submit, authorize, burn, delete) — **halts at the Local Risk Gate modal** |

The model may *raise* a tier (conservative); it can never lower it below the
local classifier's assessment.

## 6. Testbed (testbed/)

A single-page, 3-portal simulation used as the **ground-truth corpus**:

1. **e-Procurement** — tender quotes, PAN `AAACA7890B`, GSTIN
   `29AAACA7890B1Z5`, IFSC `SBIN0001040`, bank account `98765432109876`,
   vendor name/email/phone, vector signature pad canvas.
2. **HR & Deputation** — employee name/email, Aadhaar `9999 9999 0019`
   (Verhoeff-valid), passport `Z3489127`, procedural biometric avatar canvas.
3. **ISTRAC Mission Operations** — director name/PAN/Aadhaar, Luhn
   transponder key `4532 0151 1283 0366`, budget `₹ 620,00,00,000`, landline
   `+91 80 2839 5000`, satellite telemetry canvas (600×220, two text
   clusters for CCL), flight-director avatar canvas, TIER_4 "Authorize
   Orbital Burn" button.

The complete PII corpus (21 sensitive values + 12 documented negatives) is
encoded in `testbed/automated-tests/accuracy-benchmark.test.mjs`.
