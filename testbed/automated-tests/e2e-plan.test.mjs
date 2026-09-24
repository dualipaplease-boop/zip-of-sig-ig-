// SentryAgent - End-to-End Wire Protocol Test (v2.6)
// Exercises the LIVE Python reasoning server (http://localhost:8000):
//   1. /health advertises independent digest recompute
//   2. plan request with a valid client digest → 200, digestVerified:true,
//      verifiedDigest echoes the client digest, TIER_4 statutory action
//   3. forged digest (client claims a digest it did not compute) → 400
//   4. node tampered AFTER sealing (simulated sanitizer failure that
//      swaps in a raw value) → 400 fail-closed
//   5. body > 2 MB → 413
//
// Run (with server running):  node --test testbed/automated-tests/e2e-plan.test.mjs
// Start server:  python3 server/app.py

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = 'http://localhost:8000';

// JS JSON.stringify === Python json.dumps(nodes, separators=(',',':'),
// ensure_ascii=False) for the ASCII opaque scene nodes below; the server
// unit tests assert this byte-identity explicitly.
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const NODES = [
  {
    opaqueId: 'node_btn_submit_tender',
    role: 'BUTTON',
    sanitizedLabel: 'Submit Official Tender Bid',
    interactive: true,
    boundingBox: { x: 50, y: 350, w: 220, h: 45 }
  },
  {
    opaqueId: 'node_input_quote',
    role: 'INPUT',
    sanitizedLabel: '<CONFIDENTIAL_VAL_1>',
    interactive: true,
    boundingBox: { x: 50, y: 150, w: 300, h: 40 }
  }
];

function wirePayload(nodes, digest, goal = 'Submit official tender bid') {
  return {
    timestamp: Date.now(),
    digestSha256: digest,
    disclosureLevel: 'L1',
    userGoal: goal,
    nodeCount: nodes.length,
    nodes
  };
}

async function serverReachable() {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function postPlan(body) {
  return fetch(`${BASE}/api/v1/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const maybeSkip = async t => {
  if (!(await serverReachable())) {
    t.skip(true, 'reasoning server not reachable on http://localhost:8000 — start it with: python3 server/app.py');
    return true;
  }
  return false;
};

test('e2e: /health advertises independent digest recompute', async t => {
  if (await maybeSkip(t)) return;
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'HEALTHY');
  assert.equal(data.digestVerification, 'independent-recompute');
  assert.match(data.version, /^2\.6/);
});

test('e2e: valid digest → 200 with digestVerified:true and TIER_4 submit action', async t => {
  if (await maybeSkip(t)) return;

  const digest = sha256(JSON.stringify(NODES));
  const res = await postPlan(wirePayload(NODES, digest));
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);

  assert.equal(data.status, 'SUCCESS');
  assert.equal(data.digestVerified, true);
  assert.equal(data.verifiedDigest, digest, 'server must echo the independently recomputed digest');
  assert(Array.isArray(data.actions) && data.actions.length > 0);
  assert.equal(data.actions[0].targetOpaqueId, 'node_btn_submit_tender');
  assert.equal(data.actions[0].riskTier, 'TIER_4');
  console.log('✓ valid-digest e2e plan:', JSON.stringify(data.actions[0]));
});

test('e2e: forged digest → 400 fail-closed (server recomputes independently)', async t => {
  if (await maybeSkip(t)) return;

  const forged = 'a'.repeat(64); // client claims a digest it never computed
  const res = await postPlan(wirePayload(NODES, forged));
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.digestVerified, false);
  assert.notEqual(data.expectedDigest, data.receivedDigest);
  assert.match(data.error, /Digest mismatch/i);
});

test('e2e: node tampered after sealing → 400 (raw value injected post-digest)', async t => {
  if (await maybeSkip(t)) return;

  // Seal with clean nodes, then mutate one node as if a sanitizer bug
  // injected a raw value after the digest was computed.
  const digest = sha256(JSON.stringify(NODES));
  const tampered = NODES.map(n =>
    n.opaqueId === 'node_input_quote'
      ? { ...n, sanitizedLabel: 'PAN AAACA7890B' } // raw PII, post-seal
      : n
  );
  const res = await postPlan(wirePayload(tampered, digest));
  assert.equal(res.status, 400, 'tampered payload must be rejected');
  const data = await res.json();
  assert.equal(data.digestVerified, false);
});

test('e2e: body over 2 MB → 413', async t => {
  if (await maybeSkip(t)) return;

  const digest = sha256(JSON.stringify(NODES));
  const big = { ...wirePayload(NODES, digest), padding: 'x'.repeat(2 * 1024 * 1024) };
  const res = await postPlan(big);
  assert.equal(res.status, 413);
});
