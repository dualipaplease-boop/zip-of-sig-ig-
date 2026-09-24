"""
SentryAgent Central Reasoning Server (v2.6)
Implements true LLM reasoning over zero-PII Opaque Scene Graphs.

Framework: Python standard library only (http.server). No third-party
dependencies are required (see requirements.txt).

Wire integrity:
  The extension computes a SHA-256 digest over the exact JSON
  serialization of the `nodes` array and sends it as `digestSha256`.
  This server INDEPENDENTLY RECOMPUTES that digest from the received
  nodes and rejects the request (HTTP 400) if the values disagree.
  Note: this is an integrity check for a local trust domain — it is a
  digest, not a cryptographic signature (the server holds no shared
  key and cannot authenticate the client's identity).

Compatible LLM backends:
  - Local Ollama (e.g. qwen2.5, llama3.2, mistral) via http://localhost:11434/v1
  - Groq Cloud API (llama-3.3-70b-versatile)
  - Any OpenAI-compatible endpoint
  - Zero-dependency built-in heuristic planner if every LLM is offline.
"""

import hashlib
import json
import os
import sys
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PORT', 8000))
HOST = os.environ.get('HOST', '0.0.0.0')  # local dev machine; bind conservatively for deployments
LLM_PROVIDER = os.environ.get('LLM_PROVIDER', 'auto')  # 'ollama', 'groq', 'openai', or 'auto'
LLM_API_KEY = os.environ.get('LLM_API_KEY', '')
LLM_BASE_URL = os.environ.get('LLM_BASE_URL', 'http://localhost:11434/v1')
LLM_MODEL = os.environ.get('LLM_MODEL', 'qwen2.5:latest')
MAX_BODY_BYTES = 2 * 1024 * 1024  # 2 MB request cap (fail-closed 413)

# CORS allowlist: only origins that belong to this local system may
# consume the planning API. Anything else receives no CORS headers.
def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    o = origin.lower()
    if o.startswith('chrome-extension://'):
        return True
    if o == 'null':  # file:// pages
        return True
    for prefix in ('http://localhost:', 'http://127.0.0.1:', 'http://[::1]:'):
        if o.startswith(prefix):
            return True
    return False

SYSTEM_PROMPT = """You are SentryAgent's Central Reasoning Brain. You operate as an autonomous browser agent.
CRITICAL SECURITY INVARIANTS:
1. You operate STRICTLY over sanitized, zero-PII UI scene graphs. The screen contains opaque node IDs (e.g. node_btn_submit) and semantic tokens (e.g. <PERSON_1>, <AADHAAR_ID_1>, <CONFIDENTIAL_VAL_1>).
2. NEVER attempt to guess, extract, or hallucinate raw PII. Use existing tokens verbatim.
3. Every action MUST target a valid opaqueId from the provided nodes.
4. Categorize action riskTier:
   - TIER_1: Read-only, focus, scrolling.
   - TIER_2: Typing/selecting non-sensitive form fields.
   - TIER_3: Navigating to external URLs or changing tabs.
   - TIER_4: High-stakes statutory actions (submitting tenders, banking checkout, deleting records, firing rocket burns).
5. Your output is UNTRUSTED input to a local client-side risk gate. The client re-classifies every action and may block or require user confirmation. Never try to bypass client policy.
6. Output format must be STRICT JSON ONLY matching this exact structure:
{
  "thought": "Your concise step-by-step reasoning",
  "checklist": [
    {"id": 1, "description": "Subgoal 1", "done": true},
    {"id": 2, "description": "Subgoal 2", "done": false}
  ],
  "actions": [
    {
      "step": 1,
      "action": "CLICK" | "TYPE" | "FOCUS" | "SCROLL" | "NAVIGATE",
      "targetOpaqueId": "node_xxx",
      "targetLabel": "Readable element label",
      "value": "Optional string value to type (use vault tokens only for sensitive values)",
      "riskTier": "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4",
      "reason": "Why this action is needed"
    }
  ],
  "isFinished": false
}"""

_plan_counter = 0
_plan_counter_lock = threading.Lock()


def next_plan_id(timestamp) -> str:
    global _plan_counter
    with _plan_counter_lock:
        _plan_counter += 1
        return f"plan_{timestamp}_{_plan_counter}"


def recompute_nodes_digest(nodes) -> str:
    """Independently recompute the client's SHA-256 digest.

    The client seals `JSON.stringify(nodes)` (compact separators, raw
    UTF-8). Python's json module preserves key insertion order from the
    wire, so mirroring the serialization here yields byte-identical
    input for the hash.
    """
    canonical = json.dumps(nodes, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    return hashlib.sha256(canonical).hexdigest()


def call_llm_planner(user_goal, nodes, history=None, checklist=None):
    """Attempt to call a real LLM via Ollama, Groq, or an OpenAI-compatible endpoint."""
    history = history or []
    checklist = checklist or []

    prompt_content = f"""USER GOAL: {user_goal}

PREVIOUS ACTIONS COMPLETED:
{json.dumps(history, indent=2) if history else "None. This is Step 1."}

ACTIVE SUBGOAL CHECKLIST:
{json.dumps(checklist, indent=2) if checklist else "None initial. Create the sub-goals."}

CURRENT SANITIZED SCENE GRAPH NODES:
{json.dumps(nodes[:40], indent=2)}

Analyze the scene nodes and user goal. Return the NEXT logical action and updated checklist in strict JSON format."""

    # 1. Try Groq if an API key is provided
    if (LLM_PROVIDER in ['groq', 'auto']) and os.environ.get('GROQ_API_KEY'):
        try:
            return call_openai_compatible(
                base_url="https://api.groq.com/openai/v1",
                api_key=os.environ.get('GROQ_API_KEY'),
                model="llama-3.3-70b-versatile",
                prompt=prompt_content
            )
        except Exception as e:
            print(f"[LLM] Groq call failed: {e}. Falling back...")

    # 2. Try Ollama locally
    if LLM_PROVIDER in ['ollama', 'auto']:
        try:
            return call_openai_compatible(
                base_url=LLM_BASE_URL.rstrip('/'),
                api_key=LLM_API_KEY or "ollama",
                model=LLM_MODEL,
                prompt=prompt_content,
                timeout=5
            )
        except Exception as e:
            print(f"[LLM] Local Ollama call failed/offline: {e}. Using deterministic fallback.")

    # 3. Fallback to the Intelligent Goal-Oriented Heuristic Planner
    return heuristic_goal_planner(user_goal, nodes, history, checklist)


def call_openai_compatible(base_url, api_key, model, prompt, timeout=10):
    url = f"{base_url}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt_content_safe(prompt)}
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"}
    }

    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        res_data = json.loads(resp.read().decode('utf-8'))
        raw_reply = res_data['choices'][0]['message']['content']
        return json.loads(raw_reply)


def prompt_content_safe(prompt: str) -> str:
    """Pass-through kept as a single choke point for future prompt-injection hardening."""
    return prompt


def heuristic_goal_planner(user_goal, nodes, history, checklist):
    """
    Deterministic fallback planner.
    Guarantees zero crashes even when every LLM endpoint is offline.
    Mirrors the client-side local planner (extension/src/execution/localPlanner.ts)
    so behavior is identical whether or not the server/LLM is reachable.
    """
    goal_lower = user_goal.lower()
    planned_actions = []

    # Generate a default checklist if empty
    if not checklist:
        checklist = [
            {"id": 1, "description": "Identify target interactive elements", "done": False},
            {"id": 2, "description": "Execute requested operation", "done": False},
            {"id": 3, "description": "Verify task completion", "done": False}
        ]

    # Intent precedence (kept consistent with extension/src/execution/localPlanner.ts):
    #   1. explicit submit verb  → statutory submission
    #   2. explicit fill verb    → populate a field (wins over the noun "bid",
    #      e.g. "Fill the bid amount" must TYPE, not CLICK submit)
    #   3. statutory nouns only  → submission
    has_submit_verb = any(k in goal_lower for k in ['submit', 'submission', 'authorize', 'burn'])
    has_fill_verb = any(k in goal_lower for k in ['fill', 'enter', 'type', 'quote', 'vendor'])
    has_statutory_noun = any(k in goal_lower for k in ['bid', 'tender'])
    is_statutory = has_submit_verb or (has_statutory_noun and not has_fill_verb)
    is_fill = (not is_statutory) and has_fill_verb

    # Scenario A: statutory / high-stakes submission goal
    if is_statutory:
        # Unambiguous submit verbs first; 'bid'/'tender' only as fallback,
        # because field labels like "Bid Amount" would otherwise be matched
        # as the submit control (verified failure mode in the testbed).
        def _has(n, words):
            return any(w in n.get('sanitizedLabel', '').lower() for w in words)
        submit_node = next((n for n in nodes if _has(n, ['submit', 'authorize'])), None) \
            or next((n for n in nodes if _has(n, ['bid', 'tender'])), None)
        if submit_node:
            planned_actions.append({
                "step": len(history) + 1,
                "action": "CLICK",
                "targetOpaqueId": submit_node['opaqueId'],
                "targetLabel": submit_node.get('sanitizedLabel', 'Submit Target'),
                "riskTier": "TIER_4",
                "reason": f"Fulfill goal: {user_goal} via statutory action node."
            })
            checklist[0]["done"] = True
            checklist[1]["done"] = True

    # Scenario B: fill / enter goal
    elif is_fill:
        input_node = next((n for n in nodes if n.get('role') in ['INPUT', 'TEXTAREA']), None)
        if input_node:
            planned_actions.append({
                "step": len(history) + 1,
                "action": "TYPE",
                "targetOpaqueId": input_node['opaqueId'],
                "targetLabel": input_node.get('sanitizedLabel', 'Target Input'),
                "value": "<CONFIDENTIAL_VAL_1>",
                "riskTier": "TIER_2",
                "reason": f"Populate requested field matching goal: {user_goal}"
            })
            checklist[0]["done"] = True

    # Default fallback: engage first interactive node
    if not planned_actions:
        first_interactive = next((n for n in nodes if n.get('interactive')), None)
        if first_interactive:
            planned_actions.append({
                "step": len(history) + 1,
                "action": "CLICK",
                "targetOpaqueId": first_interactive['opaqueId'],
                "targetLabel": first_interactive.get('sanitizedLabel', 'Interactive Element'),
                "riskTier": "TIER_1",
                "reason": f"Engage target element for goal: {user_goal}"
            })

    return {
        "thought": f"Heuristic analysis matching goal '{user_goal}' against {len(nodes)} scene nodes.",
        "checklist": checklist,
        "actions": planned_actions,
        "isFinished": len(history) >= 2
    }


class SentryAgentRequestHandler(BaseHTTPRequestHandler):
    server_version = "SentryAgentReasoner/2.6"

    def _send_cors_headers(self):
        origin = self.headers.get('Origin', '')
        if _origin_allowed(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Sentry-Digest')
            self.send_header('Access-Control-Max-Age', '600')

    def _send_json(self, status: int, obj: dict):
        body = json.dumps(obj, indent=2).encode('utf-8')
        self.send_response(status)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Keep stdout readable: one line per request, no PII (paths only).
        sys.stdout.write("[server] %s\n" % (fmt % args))
        sys.stdout.flush()

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path in ('/health', '/'):
            self._send_json(200, {
                "status": "HEALTHY",
                "service": "SentryAgent Autonomous Reasoning Engine",
                "version": "2.6.0",
                "llmProvider": LLM_PROVIDER,
                "configuredModel": LLM_MODEL,
                "wireProtocol": "Zero-PII Opaque SceneGraph with independently verified SHA-256 digest",
                "digestVerification": "independent-recompute",
                "port": PORT
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != '/api/v1/plan':
            self._send_json(404, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            content_length = 0

        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self._send_json(413 if content_length > 0 else 400,
                            {"error": "Request body missing or exceeds 2 MB limit."})
            return

        body = self.rfile.read(content_length).decode('utf-8', errors='replace')

        try:
            payload = json.loads(body)
        except Exception as e:
            self._send_json(400, {"error": f"Invalid JSON: {e}"})
            return

        if not isinstance(payload, dict):
            self._send_json(400, {"error": "Payload must be a JSON object."})
            return

        wire_digest = str(payload.get('digestSha256', ''))
        nodes = payload.get('nodes', [])
        if not isinstance(nodes, list):
            self._send_json(400, {"error": "'nodes' must be an array."})
            return
        user_goal = payload.get('userGoal') or 'Perform autonomous page review and submission'
        history = payload.get('history', []) or []
        checklist = payload.get('checklist', []) or []

        # --- Independent digest verification (fail-closed) ---
        computed_digest = recompute_nodes_digest(nodes)
        digest_verified = (computed_digest.lower() == wire_digest.lower())

        print(f"\n[SENTRY REASONER] Goal: \"{user_goal}\"")
        print(f"[SENTRY REASONER] Nodes: {len(nodes)} | digest provided: {wire_digest[:16]}... "
              f"recomputed: {computed_digest[:16]}... | verified: {digest_verified}")

        if not digest_verified:
            # Tampering, corruption, or client/server serialization drift.
            self._send_json(400, {
                "error": "Digest mismatch: independently recomputed SHA-256 does not match "
                         "the client-provided digestSha256. Request rejected (fail-closed).",
                "digestVerified": False,
                "expectedDigest": computed_digest,
                "receivedDigest": wire_digest
            })
            return

        # Run real LLM / fallback planner
        plan_result = call_llm_planner(user_goal, nodes, history, checklist)
        if not isinstance(plan_result, dict):
            plan_result = {"thought": "Planner returned a non-object; no actions.", "actions": []}

        response_data = {
            "status": "SUCCESS",
            "verifiedDigest": computed_digest,
            "digestVerified": True,
            "planId": next_plan_id(payload.get('timestamp')),
            "thought": plan_result.get("thought", "Analysis completed."),
            "checklist": plan_result.get("checklist", []),
            "actions": plan_result.get("actions", []),
            "isFinished": plan_result.get("isFinished", False),
            "totalSteps": len(plan_result.get("actions", [])),
            "serverAssurance": "Reasoning executed strictly over zero-PII opaque identifiers; "
                               "all actions remain subject to the client-side local risk gate."
        }
        self._send_json(200, response_data)


def build_httpd(port: int = PORT, host: str = HOST) -> ThreadingHTTPServer:
    """Create (but do not start) the HTTP server. Used by run_server() and tests."""
    httpd = ThreadingHTTPServer((host, port), SentryAgentRequestHandler)
    httpd.daemon_threads = True
    return httpd


def run_server(port: int = PORT, host: str = HOST):
    httpd = build_httpd(port, host)
    bound_port = httpd.server_address[1]
    print("==================================================")
    print(" SentryAgent Autonomous Reasoning Engine (v2.6)")
    print(f" Listening on http://localhost:{bound_port}")
    print(f" LLM Provider:    {LLM_PROVIDER} ({LLM_MODEL})")
    print(" Wire Contract:   Zero-PII Opaque SceneGraph + independent SHA-256 digest verification")
    print("==================================================")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down gracefully.")
        httpd.server_close()


if __name__ == '__main__':
    run_server()
