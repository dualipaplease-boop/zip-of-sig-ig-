// Local Deterministic Planner & Model-Output Validator (pure module).
//
// Two responsibilities:
//  1. validatePlannedAction — treat EVERY reasoner/model output as
//     untrusted input and reject anything structurally invalid before it
//     can reach the action dispatcher.
//  2. localHeuristicPlan — deterministic client-side fallback planner used
//     when (a) the remote reasoner is unreachable (server offline /
//     network failure / digest rejection) or (b) disclosure level is L0
//     (pure local, zero network). Mirrors server/app.py's
//     heuristic_goal_planner so behavior is consistent with or without
//     the server.

import type { PlannedAction, RiskTier } from '../types';

export const VALID_ACTIONS = new Set(['CLICK', 'TYPE', 'FOCUS', 'SCROLL', 'NAVIGATE']);
export const VALID_TIERS = new Set(['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4']);

const TIER_RANK: Record<RiskTier, number> = {
  TIER_1: 1, TIER_2: 2, TIER_3: 3, TIER_4: 4
};

// Normalizes a raw reasoner action (the wire uses `value`; internal
// type uses `payloadValue`) into a validated PlannedAction, or null if
// the model output is structurally invalid / untrusted.
export function validatePlannedAction(raw: any): PlannedAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const action = typeof raw.action === 'string' ? raw.action.toUpperCase() : '';
  if (!VALID_ACTIONS.has(action)) return null;

  const targetOpaqueId = typeof raw.targetOpaqueId === 'string' ? raw.targetOpaqueId : '';
  if (!targetOpaqueId || targetOpaqueId.length > 200) return null;

  const targetLabel = typeof raw.targetLabel === 'string' ? raw.targetLabel : '';
  const reason = typeof raw.reason === 'string' ? raw.reason : '';

  let riskTier: RiskTier;
  if (VALID_TIERS.has(raw.riskTier)) {
    riskTier = raw.riskTier;
  } else {
    // Unknown/missing tier: fail conservative (highest scrutiny).
    riskTier = 'TIER_4';
  }

  // Value: only a string is acceptable; the dispatcher decides whether
  // it may be typed (vault tokens / verified non-sensitive text only).
  let payloadValue: string | undefined;
  if (raw.value !== undefined || raw.payloadValue !== undefined) {
    const v = raw.value !== undefined ? raw.value : raw.payloadValue;
    if (typeof v !== 'string' || v.length > 5000) return null;
    payloadValue = v;
  }

  return {
    step: typeof raw.step === 'number' ? raw.step : 1,
    action: action as PlannedAction['action'],
    targetOpaqueId,
    targetLabel: targetLabel.substring(0, 200),
    riskTier,
    reason: reason.substring(0, 500),
    payloadValue
  };
}

export function tierAtLeast(a: RiskTier, b: RiskTier): boolean {
  return TIER_RANK[a] >= TIER_RANK[b];
}

// The client-side effective risk tier is never lower than the model's
// claim — the model can raise scrutiny (conservative) but the final
// authority is the local classifier in actionDispatcher.ts.
export function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export interface SceneNodeLite {
  opaqueId: string;
  role?: string;
  sanitizedLabel: string;
  interactive?: boolean;
}

// Deterministic fallback plan over opaque scene nodes (no PII involved).
export function localHeuristicPlan(
  userGoal: string,
  nodes: SceneNodeLite[],
  historyLength = 0
): PlannedAction[] {
  const goalLower = (userGoal || '').toLowerCase();
  const planned: PlannedAction[] = [];

  // Intent precedence (verified against testbed goals):
  //   1. explicit submit verb  → statutory submission
  //   2. explicit fill verb    → populate a field (wins over the noun "bid",
  //      e.g. "Fill the bid amount" must TYPE, not CLICK submit)
  //   3. statutory nouns only  → submission
  const hasSubmitVerb = ['submit', 'submission', 'authorize', 'burn'].some(k => goalLower.includes(k));
  const hasFillVerb = ['fill', 'enter', 'type', 'quote', 'vendor'].some(k => goalLower.includes(k));
  const hasStatutoryNoun = ['bid', 'tender'].some(k => goalLower.includes(k));
  const isStatutory = hasSubmitVerb || (hasStatutoryNoun && !hasFillVerb);
  const isFill = !isStatutory && hasFillVerb;

  // Scenario A: statutory / high-stakes submission goal
  if (isStatutory) {
    // Unambiguous submit verbs first; 'bid'/'tender' only as fallback,
    // because field labels like "Bid Amount" would otherwise be matched
    // as the submit control (verified failure mode in the testbed).
    const isSubmitNode = (n: SceneNodeLite, words: string[]) =>
      words.some(w => (n.sanitizedLabel || '').toLowerCase().includes(w));
    const submitNode =
      nodes.find(n => isSubmitNode(n, ['submit', 'authorize'])) ||
      nodes.find(n => isSubmitNode(n, ['bid', 'tender']));
    if (submitNode) {
      planned.push({
        step: historyLength + 1,
        action: 'CLICK',
        targetOpaqueId: submitNode.opaqueId,
        targetLabel: submitNode.sanitizedLabel,
        riskTier: 'TIER_4',
        reason: `Local heuristic (reasoner unavailable or L0): statutory action for goal "${userGoal}".`
      });
    }
  }
  // Scenario B: fill / enter goal
  else if (isFill) {
    const inputNode = nodes.find(n => n.role === 'INPUT' || n.role === 'TEXTAREA');
    if (inputNode) {
      planned.push({
        step: historyLength + 1,
        action: 'TYPE',
        targetOpaqueId: inputNode.opaqueId,
        targetLabel: inputNode.sanitizedLabel,
        riskTier: 'TIER_2',
        payloadValue: '<CONFIDENTIAL_VAL_1>', // vault token only — never a raw value
        reason: `Local heuristic (reasoner unavailable or L0): populate field for goal "${userGoal}".`
      });
    }
  }
  // Default: engage first interactive node
  if (planned.length === 0) {
    const first = nodes.find(n => n.interactive);
    if (first) {
      planned.push({
        step: historyLength + 1,
        action: 'CLICK',
        targetOpaqueId: first.opaqueId,
        targetLabel: first.sanitizedLabel,
        riskTier: 'TIER_1',
        reason: `Local heuristic (reasoner unavailable or L0): engage "${first.sanitizedLabel}".`
      });
    }
  }

  return planned;
}
