"""Unit tests for the SentryAgent reasoning server (stdlib only).

Run from the repository root:
    python -m unittest discover -s server -p "test_*.py"
or:
    python server/test_app.py

Covers:
  * /health endpoint
  * independent SHA-256 digest verification (accept + tamper rejection)
  * malformed JSON / oversize body handling
  * heuristic planner risk tiering (submit goal -> TIER_4)
  * CORS origin allowlist behavior
  * 404 handling
"""

import json
import sys
import os
import threading
import unittest
import urllib.request
import urllib.error
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app  # noqa: E402


class ServerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Bind to an ephemeral port on loopback so tests never clash.
        cls.httpd = app.build_httpd(port=0, host='127.0.0.1')
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    # --- helpers -------------------------------------------------------
    def post_plan(self, nodes, goal='Submit official tender bid', tamper=False,
                  extra_headers=None, omit_digest=False):
        digest = app.recompute_nodes_digest(nodes)
        payload = {
            "timestamp": int(uuid.uuid4().int % 10**12),
            "digestSha256": digest,
            "disclosureLevel": "L1",
            "userGoal": goal,
            "nodes": nodes,
        }
        if tamper:
            # Mutate a node AFTER the digest was computed.
            payload["nodes"][0]["sanitizedLabel"] = payload["nodes"][0]["sanitizedLabel"] + " (tampered)"
        if omit_digest:
            del payload["digestSha256"]
        headers = {"Content-Type": "application/json", "X-Sentry-Digest": digest}
        if extra_headers:
            headers.update(extra_headers)
        req = urllib.request.Request(
            self.base + '/api/v1/plan',
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read().decode('utf-8')), dict(resp.headers)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8')), dict(e.headers)

    def submit_nodes(self):
        return [
            {
                "opaqueId": "node_btn_submit_tender",
                "role": "BUTTON",
                "sanitizedLabel": "Submit Official Tender Bid",
                "interactive": True,
                "boundingBox": {"x": 50, "y": 350, "w": 220, "h": 45},
            },
            {
                "opaqueId": "node_input_quote",
                "role": "INPUT",
                "sanitizedLabel": "<CONFIDENTIAL_VAL_1>",
                "interactive": True,
                "boundingBox": {"x": 50, "y": 150, "w": 300, "h": 40},
            },
        ]

    # --- tests ---------------------------------------------------------
    def test_health_endpoint(self):
        with urllib.request.urlopen(self.base + '/health', timeout=10) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode('utf-8'))
        self.assertEqual(data['status'], 'HEALTHY')
        self.assertEqual(data['digestVerification'], 'independent-recompute')

    def test_digest_verified_and_tier4_plan(self):
        status, data, _ = self.post_plan(self.submit_nodes())
        self.assertEqual(status, 200)
        self.assertTrue(data['digestVerified'])
        self.assertEqual(data['status'], 'SUCCESS')
        self.assertEqual(len(data['actions']), 1)
        action = data['actions'][0]
        self.assertEqual(action['targetOpaqueId'], 'node_btn_submit_tender')
        self.assertEqual(action['riskTier'], 'TIER_4')
        self.assertEqual(action['action'], 'CLICK')
        # Digest echoed back must equal the independently recomputed value.
        self.assertEqual(data['verifiedDigest'], app.recompute_nodes_digest(self.submit_nodes()))

    def test_tampered_nodes_rejected_fail_closed(self):
        status, data, _ = self.post_plan(self.submit_nodes(), tamper=True)
        self.assertEqual(status, 400)
        self.assertFalse(data['digestVerified'])
        self.assertIn('Digest mismatch', data['error'])

    def test_missing_digest_rejected(self):
        status, data, _ = self.post_plan(self.submit_nodes(), omit_digest=True)
        self.assertEqual(status, 400)

    def test_malformed_json_rejected(self):
        req = urllib.request.Request(
            self.base + '/api/v1/plan',
            data=b'{not json',
            headers={"Content-Type": "application/json"},
            method='POST',
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(ctx.exception.code, 400)

    def test_unknown_path_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.base + '/nope', timeout=10)
        self.assertEqual(ctx.exception.code, 404)

    def test_cors_allowlisted_origin_echoed(self):
        status, _, headers = self.post_plan(self.submit_nodes(),
                                            extra_headers={'Origin': 'http://localhost:3000'})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000')

    def test_cors_extension_origin_allowed(self):
        status, _, headers = self.post_plan(self.submit_nodes(),
                                            extra_headers={'Origin': 'chrome-extension://abc123'})
        self.assertEqual(headers.get('Access-Control-Allow-Origin'), 'chrome-extension://abc123')

    def test_cors_unlisted_origin_not_allowed(self):
        status, _, headers = self.post_plan(self.submit_nodes(),
                                            extra_headers={'Origin': 'https://evil.example.com'})
        # The plan itself still succeeds (local trust domain), but no CORS
        # header may be emitted for an unlisted origin.
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_heuristic_fill_goal_targets_input(self):
        nodes = [
            {"opaqueId": "node_input_a", "role": "INPUT",
             "sanitizedLabel": "Vendor PAN", "interactive": True,
             "boundingBox": {"x": 1, "y": 1, "w": 10, "h": 10}},
        ]
        status, data, _ = self.post_plan(nodes, goal='Fill vendor details')
        self.assertEqual(status, 200)
        action = data['actions'][0]
        self.assertEqual(action['action'], 'TYPE')
        self.assertEqual(action['targetOpaqueId'], 'node_input_a')
        # The fallback planner must only ever emit vault tokens, never raw PII.
        self.assertEqual(action.get('value'), '<CONFIDENTIAL_VAL_1>')

    def test_empty_nodes_yields_no_actions(self):
        status, data, _ = self.post_plan([], goal='Submit tender')
        self.assertEqual(status, 200)
        self.assertEqual(data['actions'], [])

    def test_digest_recomputation_matches_json_stringify_semantics(self):
        # Mirror of the extension's JSON.stringify(nodes): compact separators,
        # raw UTF-8 (no \u escapes), insertion-order keys.
        nodes = [{"opaqueId": "n₁", "sanitizedLabel": "₹ 4,850,000.00", "role": "INPUT"}]
        js_style = json.dumps(nodes, separators=(',', ':'), ensure_ascii=False)
        self.assertEqual(app.recompute_nodes_digest(nodes),
                         __import__('hashlib').sha256(js_style.encode('utf-8')).hexdigest())


if __name__ == '__main__':
    unittest.main(verbosity=2)
