// SentryAgent - Autonomous Canvas Vision & Disclosure Ladder Integration (v2.6)
//
// Scope (what is real, what is simulated — stated explicitly):
//   REAL (from extension/src via esbuild bundle):
//     - determineDisclosureLevel / allowsRemoteEgress  (privacy/disclosure.ts)
//     - FailClosedEgressVerifier + SHA-256 digest      (network/egressVerifier.ts)
//     - localHeuristicPlan L0 fallback                 (execution/localPlanner.ts)
//     - the live Python reasoning server on :8000      (server/app.py)
//   SIMULATED (documented, cannot run in Node):
//     - the ONNX inference layer (BlazeFace/DBNet need a browser canvas +
//       WASM runtime). The mock emits the same VisualBBox shape the real
//       engine produces; the NMS + CCL primitives the engine uses are
//       unit-tested against the real modules in privacy.test.mjs.
//
// Run (with server):  node --test testbed/automated-tests/autonomous-canvas-vision.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadSentryModules } from './_sentry_load.mjs';

const sentry = await loadSentryModules();
const {
  determineDisclosureLevel,
  allowsRemoteEgress,
  FailClosedEgressVerifier,
  localHeuristicPlan
} = sentry;

const BASE = 'http://localhost:8000';
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── Simulated vision layer (ONNX inference cannot run under Node) ────────────
class MockVisionEngine {
  async scanCanvases(canvases) {
    const regions = [];
    canvases.forEach((canvas, index) => {
      if (canvas.type === 'SIGNATURE') {
        regions.push({
          id: `sig_${index}`,
          type: 'SIGNATURE',
          x: 10, y: 15, width: 240, height: 90,
          confidence: 0.96,
          token: `<REDACTED_SIGNATURE_${index + 1}>`
        });
      }
      if (canvas.type === 'AVATAR') {
        regions.push({
          id: `face_${index}`,
          type: 'FACE',
          x: 15, y: 15, width: 100, height: 100,
          confidence: 0.5, // graph-internal conf gate lower bound (real engine)
          token: `<REDACTED_AVATAR_${index + 1}>`
        });
      }
      if (canvas.type === 'TEXT') {
        regions.push({
          id: `text_${index}`,
          type: 'TEXT_REGION',
          x: 5, y: 5, width: 300, height: 40,
          confidence: 0.87,
          token: `<CANVAS_TEXT_REGION_${index + 1}_1>`
        });
      }
    });
    return regions;
  }
}

async function serverReachable() {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

// ─── 1. Disclosure ladder (real implementation, incl. L0) ────────────────────
test('ladder: AUTO escalates to L2 only when canvases exist', () => {
  assert.equal(determineDisclosureLevel(0, 'AUTO'), 'L1');
  assert.equal(determineDisclosureLevel(1, 'AUTO'), 'L2');
  assert.equal(determineDisclosureLevel(3, 'AUTO'), 'L2');
});

test('ladder: explicit levels honored; L3 capped to L2; L0 is local-only', () => {
  assert.equal(determineDisclosureLevel(2, 'L1'), 'L1');
  assert.equal(determineDisclosureLevel(0, 'L2'), 'L2');
  assert.equal(determineDisclosureLevel(5, 'L3'), 'L2');
  assert.equal(determineDisclosureLevel(5, 'L0'), 'L0');
  assert.equal(allowsRemoteEgress('L0'), false, 'L0 must NEVER permit remote egress');
});

test('L0: zero bytes egress — local planner produces the plan, no fetch', async () => {
  // Content script with level L0 plans locally and never contacts the server.
  const level = determineDisclosureLevel(2, 'L0');
  assert.equal(level, 'L0');
  assert.equal(allowsRemoteEgress(level), false);

  const plan = localHeuristicPlan('Sign and submit commercial tender bid', [
    { opaqueId: 'node_input_tender_id', role: 'INPUT', sanitizedLabel: 'Tender Reference', interactive: true },
    { opaqueId: 'node_canvas_signature', role: 'CANVAS', sanitizedLabel: 'Signature Pad', interactive: true },
    { opaqueId: 'node_btn_sign_and_submit', role: 'BUTTON', sanitizedLabel: 'Sign and Submit Commercial Bid', interactive: true }
  ]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'CLICK');
  assert.equal(plan[0].targetOpaqueId, 'node_btn_sign_and_submit');
  assert.equal(plan[0].riskTier, 'TIER_4');
  console.log('✓ L0 session planned locally with zero egress:', plan[0].action, '→', plan[0].targetOpaqueId);
});

// ─── 2. Full autonomous step on a canvas page (real egress, live server) ─────
test('integration: canvas page → L2 → real egress seal → live server plan', async t => {
  if (!(await serverReachable())) {
    t.skip(true, 'reasoning server not reachable on :8000 — start it with: python3 server/app.py');
    return;
  }

  const visionEngine = new MockVisionEngine();
  const egressVerifier = new FailClosedEgressVerifier(); // REAL fail-closed verifier

  const mockDOM = {
    inputs: [
      { id: 'tender_id', value: 'TEN-2026-9921' },
      { id: 'bidder_aadhaar', value: '<AADHAAR_ID_1>' } // vault token, raw value in vault
    ],
    canvases: [
      { id: 'contractor_digital_signature_pad', type: 'SIGNATURE' },
      { id: 'director_avatar', type: 'AVATAR' }
    ],
    buttons: [{ id: 'btn_sign_and_submit', textContent: 'Sign and Submit Commercial Bid' }]
  };

  // Step 1: background sends AUTO; content script resolves the level
  const activeLevel = determineDisclosureLevel(mockDOM.canvases.length, 'AUTO');
  assert.equal(activeLevel, 'L2', 'must escalate AUTO → L2 when canvases exist');

  // Step 2: vision pass runs (simulated inference; real pipeline otherwise)
  const visualRegions = await visionEngine.scanCanvases(mockDOM.canvases);
  assert.ok(visualRegions.length > 0, 'vision pipeline must detect regions on a canvas page');
  assert.equal(visualRegions[0].type, 'SIGNATURE');

  // Step 3: build the opaque scene graph (tokens only, no raw PII)
  const sceneNodes = [
    { opaqueId: 'node_input_tender_id', role: 'INPUT', sanitizedLabel: 'Tender Reference', interactive: true, boundingBox: { x: 50, y: 100, w: 200, h: 35 } },
    { opaqueId: 'node_input_aadhaar', role: 'INPUT', sanitizedLabel: '<AADHAAR_ID_1>', interactive: true, boundingBox: { x: 50, y: 150, w: 200, h: 35 }, tokenType: 'AADHAAR' },
    { opaqueId: 'node_canvas_signature', role: 'CANVAS', sanitizedLabel: visualRegions[0].token, interactive: true, boundingBox: { x: 50, y: 220, w: 250, h: 100 } },
    { opaqueId: 'node_canvas_avatar', role: 'IMAGE', sanitizedLabel: visualRegions[1].token, interactive: false, boundingBox: { x: 300, y: 220, w: 130, h: 130 } },
    { opaqueId: 'node_btn_sign_and_submit', role: 'BUTTON', sanitizedLabel: 'Sign and Submit Commercial Bid', interactive: true, boundingBox: { x: 50, y: 340, w: 280, h: 45 } }
  ];

  // Step 4: REAL fail-closed egress verification
  const knownRealValues = ['9999 4105 7058']; // the raw value the vault protects
  const sealResult = await egressVerifier.verifyAndSealPayload(sceneNodes, knownRealValues, activeLevel, visualRegions.length);
  assert.equal(sealResult.success, true, `seal failed: ${sealResult.error}`);
  const wire = sealResult.payload;
  assert.equal(wire.disclosureLevel, 'L2');
  assert.equal(wire.visualRegionsCount, 2);
  assert.equal(wire.digestSha256, sha256(JSON.stringify(sceneNodes)), 'digest must be the true SHA-256 of the nodes');

  // Step 5: transmit to the live reasoner
  const res = await fetch(`${BASE}/api/v1/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...wire, userGoal: 'Sign and submit commercial tender bid' })
  });
  const text = await res.text();
  assert.equal(res.status, 200, `server rejected payload: ${text}`);
  const planData = JSON.parse(text);
  assert.equal(planData.status, 'SUCCESS');
  assert.equal(planData.digestVerified, true);
  assert.ok(Array.isArray(planData.actions) && planData.actions.length > 0);
  assert.equal(planData.actions[0].targetOpaqueId, 'node_btn_sign_and_submit');
  assert.equal(planData.actions[0].riskTier, 'TIER_4');
  console.log('✓ Autonomous canvas step verified end-to-end:', planData.actions[0].action, '→', planData.actions[0].targetOpaqueId, '@', planData.actions[0].riskTier);
});

// ─── 3. Fail-closed: a sanitizer bug that leaks the raw value is blocked ─────
test('integration: raw PII leaking into the scene is blocked by the real verifier', async () => {
  const egressVerifier = new FailClosedEgressVerifier();
  const rawAadhaar = '9999 4105 7058';
  const badNodes = [
    { opaqueId: 'node_input_aadhaar', role: 'INPUT', sanitizedLabel: `Aadhaar ${rawAadhaar}`, interactive: true, boundingBox: { x: 0, y: 0, w: 200, h: 35 } }
  ];
  const result = await egressVerifier.verifyAndSealPayload(badNodes, [rawAadhaar], 'L2');
  assert.equal(result.success, false);
  assert.match(result.error, /Unmasked PII residual/i);
  console.log('✓ Real egress verifier blocked the leaking payload:', result.error);
});
