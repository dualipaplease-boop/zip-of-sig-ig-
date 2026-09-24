// Minimum-Disclosure Ladder Policy Engine (pure module, unit-testable).
//
// Levels (as implemented):
//   L0 — Pure local execution. Zero bytes leave the device. The extension
//        plans with its local heuristic planner and never contacts the
//        remote reasoner.
//   L1 — Anonymized DOM tree egress only (no visual pixel access).
//   L2 — Anonymized DOM tree + on-device vision (BlazeFace + DBNet).
//        Canvas pixels are redacted on-device; only opaque tokens/labels
//        egress. (Pixels never leave the device at any level.)
//   L3 — Defined in the type system for forward compatibility; currently
//        resolves to L2 (there is no "sanitized full frame" transport in
//        this build).
//   AUTO — L0 is never chosen by AUTO. Escalates to L2 when the page
//        contains canvases, otherwise L1.
//
// Historical note: earlier builds mapped every requested level to L1/L2
// and always used the network, silently ignoring L0. This module makes
// L0 first-class (see runAutonomousStep in content.ts).

export type DisclosureLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type RequestedDisclosureLevel = DisclosureLevel | 'AUTO';

export function determineDisclosureLevel(
  canvasesCount: number,
  requestedLevel: RequestedDisclosureLevel = 'AUTO'
): DisclosureLevel {
  if (requestedLevel === 'L0') return 'L0';
  if (requestedLevel === 'L1') return 'L1';
  if (requestedLevel === 'L2' || requestedLevel === 'L3') return 'L2';
  // AUTO mode: escalate to L2 if canvases are present, else L1
  return canvasesCount > 0 ? 'L2' : 'L1';
}

// True when the resolved level permits contacting the remote reasoner.
export function allowsRemoteEgress(level: DisclosureLevel): boolean {
  return level !== 'L0';
}
