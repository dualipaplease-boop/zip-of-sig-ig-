# Next Step: Get Real Numbers, Not "It Works"

> **STATUS NOTE (v2.6.0, 24 Sep 2026) — what has since been implemented:**
> - **Section 2 is DONE:** `testbed/automated-tests/accuracy-benchmark.test.mjs`
>   implements exactly this harness against the real classifier (via the
>   esbuild bundle in `_sentry_load.mjs`), over the full 21-value corpus plus
>   12 negatives. Verified result: **Precision 1.000 · Recall 1.000 · F1 1.000**.
>   The run found and fixed a real bug (lakh-grouped `₹ 620,00,00,000`
>   misclassified as PHONE).
> - **Section 1 ground-truth table:** verified against `testbed/script.js`
>   and `index.html`; the corpus in the benchmark covers every seeded field
>   (the table here omitted vendor name/email/phone, quote items, budget,
>   landline — all now in the benchmark).
> - **Section 3 (real vision numbers):** still open — needs a desktop
>   browser with Chromium (Playwright audit exists; `playwright-audit.mjs`
>   drives the built extension against the live testbed). ONNX inference
>   cannot run under Node, so no visual accuracy number is published yet.
> - **Section 4 (latency breakdown):** still open — no committed timing
>   harness exists; per the no-fabricated-numbers rule, the old millisecond
>   figures were removed from all docs.
>
> The rest of this document is the original plan, preserved as-is.

---

**Why this is next:** you have working code for all 5 rubric metrics, but zero measured numbers for 3 of them (visual accuracy 25%, PII precision/recall 20%, full latency 15% = 60% of your grade). "It works" and "94% recall, 210ms" are very different claims to a judge. Your existing `autonomous-canvas-vision.test.mjs` proves the wiring is correct but uses a `MockVisionEngine` — it never runs your real BlazeFace/DBNet models, so it can't produce a real number either.

---

## 1. Ground truth already exists in your testbed — use it, don't invent new data

Your `testbed/script.js` already seeds known, correct PII per portal (`loadScenario` function, lines ~400-431):

| Portal | Field | Ground-truth value | Should be detected as |
|---|---|---|---|
| e-Procurement | vendor-pan | `AAACA7890B` | PAN ✓ |
| e-Procurement | vendor-gstin | `29AAACA7890B1Z5` | GSTIN ✓ |
| e-Procurement | vendor-bank-account | `98765432109876` | CONFIDENTIAL_NUM |
| e-Procurement | signature-canvas | (drawn stroke) | SIGNATURE (visual) |
| HR Deputation | emp-aadhaar | `9999 9999 0019` | AADHAAR (valid Verhoeff) ✓ |
| HR Deputation | emp-passport | `Z3489127` | PASSPORT |
| HR Deputation | avatar canvas | (drawn face) | FACE (visual) |
| ISTRAC | mission-director-aadhaar | `9999 9999 0019` | AADHAAR ✓ |
| ISTRAC | transponder-key | `4532 0151 1283 0366` | CARD (valid Luhn) ✓ |
| ISTRAC | flight director badge canvas | (drawn face) | FACE (visual) |

This is already a labeled test set. You don't need to build new fixtures — you need to **count how many of these your real pipeline actually catches**, plus how many it wrongly flags that aren't PII (false positives) and how many DOM fields it should leave alone but doesn't.

## 2. Build one real (non-mock) integration test per portal

Extend your existing `automated-tests/` pattern, but swap `MockVisionEngine` for the real `visionEngineInstance` and `classifySensitiveText`. Structure:

```js
// real-accuracy-benchmark.test.mjs
import { classifySensitiveText } from '../../extension/src/privacy/checksums.ts';
// (or compiled .js output if direct .ts import isn't wired into node:test)

const groundTruth = {
  'vendor-pan': { value: 'AAACA7890B', expectedType: 'PAN' },
  'vendor-gstin': { value: '29AAACA7890B1Z5', expectedType: 'GSTIN' },
  'emp-aadhaar': { value: '9999 9999 0019', expectedType: 'AADHAAR' },
  'transponder-key': { value: '4532 0151 1283 0366', expectedType: 'CARD' },
  // ...add every seeded field from script.js
};

let truePositives = 0, falseNegatives = 0, falsePositives = 0;

for (const [field, gt] of Object.entries(groundTruth)) {
  const result = classifySensitiveText(gt.value);
  if (result && result.type === gt.expectedType) truePositives++;
  else falseNegatives++;
}

// Also test values that should NOT be flagged (negative cases):
const negativeCases = ['TEN-2026-9921', 'ISRO-SCI-SF-4891', '8450.25 MHz / RHCP'];
for (const val of negativeCases) {
  if (classifySensitiveText(val)) falsePositives++;
}

const precision = truePositives / (truePositives + falsePositives);
const recall = truePositives / (truePositives + falseNegatives);
console.log(`PII Detection — Precision: ${precision.toFixed(3)}, Recall: ${recall.toFixed(3)}`);
```

This alone gives you a real, defensible PII precision/recall number (20% of your grade) in under an hour of work, because the ground truth already exists.

## 3. For visual accuracy (the harder 25%), you need actual canvas image data, not mocks

The real BlazeFace/DBNet models need actual pixel data to run against — you can't unit-test them with plain JS objects like the mock does. Two options, in order of effort:

- **Cheaper (do this first):** Use Puppeteer (already fits your Node/Vite toolchain) to load `testbed/index.html` in a real headless Chrome, wait for `drawPresetSignature()` / avatar canvas draws to complete, then call `visionEngineInstance.scanCanvases()` against the real rendered canvases in-page. Compare `visualRegions.length` and their types against what you know is on each canvas (1 signature, 1 face per relevant portal). This gives you a real detection count — your accuracy metric.
- **More rigorous (optional, if time allows):** Manually draw the true bounding box for each face/signature on each test canvas once, then compute IoU between your model's detected box and that ground-truth box for a proper localization accuracy score, not just "did it find something."

## 4. Full end-to-end latency — wrap the entire flow, not just the server leg

Your only current number (73.5ms) is server round-trip only. Add explicit timers around the full flow in one Puppeteer-driven test:

```js
const t0 = performance.now();
// trigger scanAndSanitizePage()
const t1 = performance.now(); // DOM + vision scan complete
// trigger egressVerifier.verifyAndSealPayload()
const t2 = performance.now(); // sealed payload ready
// fetch to /api/v1/plan
const t3 = performance.now(); // plan received
// dispatch action
const t4 = performance.now(); // action executed

console.log({
  scanMs: t1 - t0,
  sealMs: t2 - t1,
  serverMs: t3 - t2,
  executeMs: t4 - t3,
  totalMs: t4 - t0
});
```

Run this once per portal (3 runs), report the total and the breakdown. A breakdown is more convincing to judges than one number — it shows you know where the time goes, and it directly demonstrates the latency-vs-accuracy tradeoff the PS text explicitly asks you to address.

## 5. Deliverable — what to actually produce

A single results table, generated from the three tests above, that goes straight into your submission doc:

| Metric | Measured value | Method |
|---|---|---|
| PII detection precision | X.XX | Section 2 harness |
| PII detection recall | X.XX | Section 2 harness |
| Visual detection count (faces/signatures found vs. present) | X/Y | Section 3 harness |
| End-to-end latency (avg across 3 portals) | XXX ms | Section 4 harness |
| Latency breakdown (scan/seal/server/execute) | — | Section 4 harness |

This replaces every "it works" claim from our last review with an actual number, backed by a named test file — the same standard ADIII-03 held themselves to, which is what made their submission credible.

## Priority order
1. Section 2 (PII precision/recall) — cheapest, ground truth already exists, do this first.
2. Section 4 (latency breakdown) — cheap, just adds timers to code that already runs.
3. Section 3 (visual accuracy via Puppeteer) — most valuable but most setup work; do this once 1 and 2 are done and you have time left.
