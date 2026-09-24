// SentryAgent - Privacy & Security Audit (v2.6)
// Tests the REAL extension source (extension/src) via an esbuild bundle —
// no re-implemented logic in the tests themselves (see _sentry_load.mjs).
// Covers: checksum validators, local inversion vault, fail-closed egress
// verification (canary + digest + label sanitization), disclosure gating,
// remote-plan validation, and the shared NMS/CCL vision primitives.
//
// Run:  node --test testbed/automated-tests/privacy.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { loadSentryModules } from './_sentry_load.mjs';

const sentry = await loadSentryModules();
const {
  validateVerhoeff,
  validateLuhn,
  validatePAN,
  validateGSTIN,
  classifySensitiveText,
  looksLikePersonName,
  LocalInversionVault,
  determineDisclosureLevel,
  allowsRemoteEgress,
  FailClosedEgressVerifier,
  sanitizeLabel,
  validatePlannedAction,
  localHeuristicPlan,
  computeIoU,
  applyNMS,
  extractTextClusters
} = sentry;

// Ground-truth values from testbed/script.js (the testbed page's PII corpus)
const AADHAAR = '9999 9999 0019';
const AADHAAR_COMPACT = '999999990019';
const PAN1 = 'AAACA7890B';
const PAN2 = 'AAAGP1234M';
const GSTIN = '29AAACA7890B1Z5';
const CARD = '4532 0151 1283 0366';
const PASSPORT = 'Z3489127';
const BANK = '98765432109876';
const IFSC = 'SBIN0001040';
const EMAIL = 'arvind.swaminathan@tenders.gov.in';
const LANDLINE = '+91 80 2839 5000';
const AMOUNT = '₹620,00,00,000.00';

// Helper: opaque scene node in the wire shape used by the egress verifier
const node = (opaqueId, role, sanitizedLabel, extra = {}) => ({
  opaqueId,
  role,
  sanitizedLabel,
  interactive: false,
  boundingBox: { x: 0, y: 0, w: 100, h: 30 },
  ...extra
});

// ─── 1. Verhoeff check digit ─────────────────────────────────────────────────
test('verhoeff: valid Aadhaar from the testbed passes', () => {
  assert.equal(validateVerhoeff(AADHAAR), true);
  assert.equal(validateVerhoeff(AADHAAR_COMPACT), true);
});

test('verhoeff: corrupted check digit fails', () => {
  assert.equal(validateVerhoeff('9999 9999 0018'), false);
  assert.equal(validateVerhoeff('9999 9999 0020'), false);
});

test('verhoeff: random digit strings fail', () => {
  assert.equal(validateVerhoeff('123456789'), false);
  assert.equal(validateVerhoeff('12345678'), false); // wrong length
  assert.equal(validateVerhoeff('abcdefghijkl'), false); // not digits
});

// ─── 2. Luhn check digit ─────────────────────────────────────────────────────
test('luhn: valid card number passes', () => {
  assert.equal(validateLuhn(CARD), true);
  assert.equal(validateLuhn(CARD.replace(/\s/g, '')), true);
});

test('luhn: corrupted card number fails', () => {
  assert.equal(validateLuhn('4532 0151 1283 0367'), false);
  assert.equal(validateLuhn('1234'), false);
  assert.equal(validateLuhn(AADHAAR_COMPACT), false); // Aadhaar is not Luhn
});

// ─── 3. PAN / GSTIN structural validation ────────────────────────────────────
test('pan: valid PANs pass, malformed fail', () => {
  assert.equal(validatePAN(PAN1), true);
  assert.equal(validatePAN(PAN2), true);
  assert.equal(validatePAN('ABCDE1234F'), false); // entity char must be in the allowed set
  assert.equal(validatePAN('INVALID_PAN'), false);
  assert.equal(validatePAN(''), false);
});

test('gstin: valid GSTIN passes, invalid embedded PAN fails', () => {
  assert.equal(validateGSTIN(GSTIN), true);
  assert.equal(validateGSTIN('29ABCDE1234F1Z5'), false);
  assert.equal(validateGSTIN('12345'), false);
});

// ─── 4. Sensitive text classification (real detector) ────────────────────────
test('classification: every testbed PII type is caught', () => {
  assert.equal(classifySensitiveText(AADHAAR)?.type, 'AADHAAR');
  assert.equal(classifySensitiveText(PAN1)?.type, 'PAN');
  assert.equal(classifySensitiveText(GSTIN)?.type, 'GSTIN');
  assert.equal(classifySensitiveText(CARD)?.type, 'CARD');
  assert.equal(classifySensitiveText(PASSPORT)?.type, 'PASSPORT');
  assert.equal(classifySensitiveText(EMAIL)?.type, 'EMAIL');
  assert.equal(classifySensitiveText(LANDLINE)?.type, 'PHONE');
  assert.equal(classifySensitiveText(IFSC)?.type, 'CONFIDENTIAL_NUM');
  // 16-digit bank account: Luhn-failing number → CONFIDENTIAL_NUM (0.85)
  const bank = classifySensitiveText(BANK);
  assert.equal(bank?.type, 'CONFIDENTIAL_NUM');
  assert.ok(bank.confidence < 0.9);
});

test('classification: financial quotes are confidential', () => {
  assert.equal(classifySensitiveText(AMOUNT)?.type, 'CONFIDENTIAL_NUM');
  assert.equal(classifySensitiveText('Rs. 5,12,340.00')?.type, 'CONFIDENTIAL_NUM');
});

test('classification: harmless text is NOT flagged', () => {
  assert.equal(classifySensitiveText('Submit the official tender bid'), null);
  assert.equal(classifySensitiveText('TENDER/2026/091'), null);
  assert.equal(classifySensitiveText('Step 3 of 5'), null);
  assert.equal(classifySensitiveText(''), null);
  assert.equal(classifySensitiveText(null), null);
});

test('name detection: context-gated, testbed names detected', () => {
  // bare name without identity context → NOT classified (context-gated)
  assert.equal(classifySensitiveText('Arvind Swaminathan'), null);
  // with a name-field context → classified PERSON
  assert.equal(classifySensitiveText('Arvind Swaminathan', { id: 'applicant-name' })?.type, 'PERSON');
  // strict mode (untrusted model output) classifies name-like text
  assert.equal(classifySensitiveText('Dr. K. S. Radhakrishnan', { strict: true })?.type, 'PERSON');
  // company names never look like person names
  assert.equal(looksLikePersonName('Acme Technologies Pvt Ltd'), false);
  assert.equal(looksLikePersonName('Tender No 12'), false); // digits
  assert.equal(looksLikePersonName('Sunita R. Namboodiri'), true);
});

// ─── 5. Local Inversion Vault (real implementation) ──────────────────────────
test('vault: tokenization is opaque and idempotent', () => {
  const vault = new LocalInversionVault();
  const token = vault.tokenize(AADHAAR_COMPACT, 'AADHAAR');
  assert.match(token, /^<AADHAAR_ID_1>$/);
  // idempotent: same plaintext → same token
  assert.equal(vault.tokenize(AADHAAR_COMPACT, 'AADHAAR'), token);
  // reverse index is value-keyed by design: the same real value keeps one
  // stable token for the whole session, even when re-tokenized with a type
  assert.equal(vault.tokenize(AADHAAR_COMPACT, 'PHONE'), token);
  // a different value gets the next counter for its type
  const second = vault.tokenize('123456789012', 'AADHAAR');
  assert.match(second, /<AADHAAR_ID_2>/);
});

test('vault: rehydration round-trip (including embedded tokens)', () => {
  const vault = new LocalInversionVault();
  const t = vault.tokenize(PAN1, 'PAN');
  assert.match(t, /<PAN_NO_1>/);
  assert.equal(vault.rehydrate(t), PAN1);
  const embedded = `PAN: ${t}, submitted by authorized signatory`;
  assert.equal(vault.rehydrate(embedded), `PAN: ${PAN1}, submitted by authorized signatory`);
  // unknown text passes through untouched (never throws)
  assert.equal(vault.rehydrate('no tokens here'), 'no tokens here');
  assert.equal(vault.isToken(t), true);
  assert.equal(vault.isToken('not a token'), false);
});

test('vault: inspection view is always masked', () => {
  const vault = new LocalInversionVault();
  const t = vault.tokenize(BANK, 'CONFIDENTIAL_NUM');
  const entries = vault.getInspectionEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].token, t);
  assert.ok(entries[0].maskedReal.includes('•'));
  assert.ok(!entries[0].maskedReal.includes(BANK));
  assert.equal(vault.getCountsByType()['CONFIDENTIAL_NUM'], 1);
});

// ─── 6. Fail-closed egress verifier (real implementation) ────────────────────
test('egress: clean scene passes with a real SHA-256 digest', async () => {
  const verifier = new FailClosedEgressVerifier();
  const nodes = [
    node('node_0_d1', 'INPUT', 'Tender Reference Number', { interactive: true }),
    node('node_1_d2', 'BUTTON', 'Submit Official Bid', { interactive: true }),
    node('node_2_d3', 'CANVAS', 'Signature Pad')
  ];
  const result = await verifier.verifyAndSealPayload(nodes, [], 'L2');
  assert.equal(result.success, true);
  assert.ok(result.payload);
  assert.match(result.payload.digestSha256, /^[0-9a-f]{64}$/);

  // The digest must be the genuine SHA-256 of the canonical node JSON
  const canonical = JSON.stringify(nodes);
  assert.equal(
    result.payload.digestSha256,
    createHash('sha256').update(canonical, 'utf8').digest('hex')
  );
  // Canvas regions counted
  assert.equal(result.payload.visualRegionsCount, 1);
});

test('egress: canary leakage is detected and blocks transmission', async () => {
  const verifier = new FailClosedEgressVerifier();
  // Simulate a bug that smuggles the session canary into an outbound label
  const nodes = [
    node('node_0_d1', 'INPUT', `note: ${verifier.getCanary()} leaked`, { interactive: true })
  ];
  const result = await verifier.verifyAndSealPayload(nodes, [], 'L1');
  assert.equal(result.success, false);
  assert.match(result.error, /canary/i);
});

test('egress: residual known secret blocks transmission', async () => {
  const verifier = new FailClosedEgressVerifier();
  const nodes = [
    // Simulated sanitizer failure: raw Aadhaar + email slipped into labels
    node('node_0_d1', 'INPUT', `Aadhaar ${AADHAAR} entered`, { interactive: true }),
    node('node_1_d2', 'TEXT', `Contact ${EMAIL}`)
  ];
  const result = await verifier.verifyAndSealPayload(nodes, [AADHAAR, AADHAAR_COMPACT, EMAIL], 'L2');
  assert.equal(result.success, false);
  assert.match(result.error, /Unmasked PII residual/i);
});

test('egress: label sanitizer replaces embedded secrets with vault tokens', () => {
  const vault = new LocalInversionVault();
  const label = 'Aadhaar 9999 9999 0019 and PAN AAACA7890B on file';
  const tokenized = sanitizeLabel(label, (v, t) => vault.tokenize(v, t));
  assert.ok(!tokenized.includes('9999'));
  assert.ok(!tokenized.includes('AAACA7890B'));
  assert.match(tokenized, /<AADHAAR_ID_1>/);
  assert.match(tokenized, /<PAN_NO_1>/);
});

test('egress: full seal pipeline on a testbed-like scene leaks nothing', async () => {
  const vault = new LocalInversionVault();
  const verifier = new FailClosedEgressVerifier();

  const aadhaarToken = vault.tokenize(AADHAAR_COMPACT, 'AADHAAR');
  const panToken = vault.tokenize(PAN1, 'PAN');
  const nodes = [
    node('node_0_d1', 'INPUT', `Aadhaar Number (value: ${aadhaarToken})`, {
      interactive: true,
      tokenType: 'AADHAAR'
    }),
    node('node_1_d2', 'INPUT', `PAN Card (value: ${panToken})`, {
      interactive: true,
      tokenType: 'PAN'
    }),
    node('node_2_d3', 'BUTTON', 'Submit Official Bid', { interactive: true }),
    node('node_3_d4', 'CANVAS', 'Signature Pad')
  ];

  const result = await verifier.verifyAndSealPayload(nodes, [
    AADHAAR, AADHAAR_COMPACT, PAN1, GSTIN, CARD, PASSPORT, BANK, IFSC, EMAIL, AMOUNT
  ], 'L2');

  assert.equal(result.success, true);
  const json = JSON.stringify(result.payload.nodes);
  for (const secret of [AADHAAR, AADHAAR_COMPACT, PAN1, GSTIN, CARD, PASSPORT, BANK, IFSC, EMAIL, AMOUNT]) {
    assert.ok(!json.includes(secret), `secret leaked: ${secret}`);
  }
  // digest is reproducible for identical nodes
  const again = await verifier.verifyAndSealPayload(nodes, [], 'L2');
  assert.equal(again.payload.digestSha256, result.payload.digestSha256);
});

// ─── 7. Disclosure level gating (real implementation) ────────────────────────
test('disclosure: AUTO with canvas ⇒ L2 (remote), without ⇒ L1 (local only)', () => {
  assert.equal(determineDisclosureLevel(2, 'AUTO'), 'L2');
  assert.equal(determineDisclosureLevel(0, 'AUTO'), 'L1');
});

test('disclosure: explicit levels honored; L3 capped to L2; L0 is local-only', () => {
  assert.equal(determineDisclosureLevel(5, 'L0'), 'L0');
  assert.equal(determineDisclosureLevel(5, 'L1'), 'L1');
  assert.equal(determineDisclosureLevel(0, 'L3'), 'L2'); // capped
  assert.equal(allowsRemoteEgress('L0'), false);
  assert.equal(allowsRemoteEgress('L1'), true); // anonymized DOM tree may egress
  assert.equal(allowsRemoteEgress('L2'), true);
});

// ─── 8. Remote plan validation (real implementation) ─────────────────────────
test('planner: malformed remote actions are rejected fail-closed', () => {
  // missing target rejected
  assert.equal(validatePlannedAction({ action: 'CLICK' }), null);
  // unknown action rejected (no arbitrary model verbs)
  assert.equal(validatePlannedAction({ action: 'RUN_JS', targetOpaqueId: 'x', riskTier: 'TIER_1' }), null);
  // missing tier → fail conservative: TIER_4, not a silent low-risk action
  const noTier = validatePlannedAction({ action: 'CLICK', targetOpaqueId: 'submit-btn' });
  assert.ok(noTier);
  assert.equal(noTier.riskTier, 'TIER_4');
  // wire-format `value` accepted and mapped to payloadValue
  const wire = validatePlannedAction({
    action: 'TYPE',
    targetOpaqueId: 'bid-amount',
    value: '50000',
    riskTier: 'TIER_2'
  });
  assert.ok(wire);
  assert.equal(wire.action, 'TYPE');
  assert.equal(wire.payloadValue, '50000');
  // oversized value rejected
  assert.equal(
    validatePlannedAction({ action: 'TYPE', targetOpaqueId: 'x', value: 'x'.repeat(5001), riskTier: 'TIER_2' }),
    null
  );
  // non-string value rejected
  assert.equal(validatePlannedAction({ action: 'TYPE', targetOpaqueId: 'x', value: 50000, riskTier: 'TIER_2' }), null);
});

test('planner: local heuristic plan matches server behavior on the testbed', () => {
  // statutory goal → TIER_4 click on the submit node
  const plan = localHeuristicPlan('Submit the official tender bid', [
    { opaqueId: 'bid-amount', role: 'INPUT', sanitizedLabel: 'Bid Amount (Rs)', interactive: true },
    { opaqueId: 'submit-btn', role: 'BUTTON', sanitizedLabel: 'Submit Official Bid', interactive: true }
  ]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'CLICK');
  assert.equal(plan[0].targetOpaqueId, 'submit-btn');
  assert.equal(plan[0].riskTier, 'TIER_4');

  // fill goal → TIER_2 TYPE with a vault token (never a raw value)
  const fill = localHeuristicPlan('Fill the bid amount', [
    { opaqueId: 'bid-amount', role: 'INPUT', sanitizedLabel: 'Bid Amount (Rs)', interactive: true },
    { opaqueId: 'submit-btn', role: 'BUTTON', sanitizedLabel: 'Submit Official Bid', interactive: true }
  ]);
  assert.equal(fill.length, 1);
  assert.equal(fill[0].action, 'TYPE');
  assert.equal(fill[0].riskTier, 'TIER_2');
  assert.equal(fill[0].payloadValue, '<CONFIDENTIAL_VAL_1>');

  // zero nodes → empty plan, never a guess
  assert.equal(localHeuristicPlan('do something', []).length, 0);
});

// ─── 9. NMS + CCL (real shared modules used by the vision engine) ────────────
test('nms: identical boxes merge, disjoint boxes survive', () => {
  const kept = applyNMS([
    { x: 10, y: 10, w: 100, h: 100, score: 0.9 },
    { x: 12, y: 11, w: 100, h: 100, score: 0.85 }, // IoU ≈ 0.96 → suppressed
    { x: 500, y: 400, w: 60, h: 60, score: 0.7 } // disjoint → kept
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].score, 0.9);
});

test('nms: iou computation is symmetric and zero for disjoint', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 5, y: 5, w: 10, h: 10 };
  const iou = computeIoU(a, b);
  assert.ok(Math.abs(iou - 25 / 175) < 1e-9);
  assert.equal(computeIoU(a, { x: 100, y: 100, w: 5, h: 5 }), 0);
  assert.equal(iou, computeIoU(b, a));
});

test('ccl: two separated text clusters are found; noise is filtered', () => {
  const mapW = 100;
  const mapH = 40;
  const map = new Float32Array(mapW * mapH);
  const paint = (x0, y0, w, h, v = 0.9) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) map[y * mapW + x] = v;
  };
  paint(10, 5, 20, 6); // cluster A
  paint(60, 20, 25, 8); // cluster B
  map[0] = 0.99; // isolated single-pixel noise

  const clusters = extractTextClusters(map, mapW, mapH, { threshold: 0.35, minPixelCount: 8 });
  assert.equal(clusters.length, 2);

  const a = clusters.find(c => c.x === 10);
  const b = clusters.find(c => c.x === 60);
  assert.ok(a && b);
  assert.equal(a.w, 20);
  assert.equal(a.h, 6);
  assert.ok(b.avgScore > 0.8);
});
