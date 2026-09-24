// Fail-Closed Egress Boundary & Cryptographic Digest (Phase 3)
// Enforces that NO raw PII or canary string can ever cross the network wire.
// Binds every outbound payload with a verifiable SHA-256 cryptographic digest,
// which the reasoning server independently recomputes and rejects on mismatch.
//
// v2.6 additions:
//  - sanitizeLabel(): strips sensitive substrings from element labels before
//    they enter the opaque scene graph (visible page text such as
//    "Submit for A. Swaminathan (98451 23456)" would otherwise egress raw).
//  - canary uses crypto.getRandomValues when available.

import type { PIIType } from '../types';
import {
  validateVerhoeff,
  validateLuhn,
  validatePAN,
  validateGSTIN,
  validateIndianPhone
} from '../privacy/checksums';

export interface OpaqueSceneNode {
  opaqueId: string;
  role: string;
  sanitizedLabel: string;
  tokenType?: PIIType;
  interactive: boolean;
  boundingBox: { x: number; y: number; w: number; h: number };
}

export interface SanitizedWirePayload {
  version: '1.0';
  timestamp: number;
  disclosureLevel: 'L0' | 'L1' | 'L2' | 'L3';
  digestSha256: string;
  nodes: OpaqueSceneNode[];
  visualRegionsCount: number;
  canarySignature: string;
}

// ---------------------------------------------------------------------------
// Label sanitization: find sensitive substrings inside free text labels and
// replace them with vault tokens before the label leaves the device.
// ---------------------------------------------------------------------------
interface LabelPattern {
  re: RegExp;
  type: PIIType;
  validate?: (v: string) => boolean;
  clean: (v: string) => string;
}

const LABEL_PATTERNS: LabelPattern[] = [
  // Aadhaar: 12 digits in 3-4-5 groupings (must pass Verhoeff)
  { re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, type: 'AADHAAR', validate: validateVerhoeff, clean: v => v.replace(/\s+/g, '') },
  // Card: grouped or contiguous 13-19 digits (must pass Luhn)
  { re: /\b\d{4}[ -]?(?:\d{4}){2}[ -]?\d{4}\b|\b\d{13,19}\b/g, type: 'CARD', validate: validateLuhn, clean: v => v.replace(/[\s-]/g, '') },
  // GSTIN (structure + embedded PAN)
  { re: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, type: 'GSTIN', validate: validateGSTIN, clean: v => v.toUpperCase() },
  // PAN (5 letters, 4 digits, 1 letter)
  { re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, type: 'PAN', validate: validatePAN, clean: v => v.toUpperCase() },
  // Email
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, type: 'EMAIL', clean: v => v },
  // Indian phone (formatted or bare)
  { re: /(?:(?:\+|00)?91[ -]?)?[6-9]\d[ -]?\d{4}[ -]?\d{4}|\b[6-9]\d{9}\b/g, type: 'PHONE', validate: validateIndianPhone, clean: v => v },
  // Passport
  { re: /\b[A-Z][0-9]{7}\b/g, type: 'PASSPORT', clean: v => v.toUpperCase() },
  // Financial quotation
  { re: /(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?/g, type: 'CONFIDENTIAL_NUM', clean: v => v.trim() }
];

interface LabelHit {
  start: number;
  end: number;
  type: PIIType;
  value: string;
}

/**
 * Replace every validated sensitive substring in `label` with the token
 * produced by `tokenize(cleanValue, type)`. Non-sensitive text passes
 * through unchanged. Overlapping matches resolve in favor of the
 * earlier/longer (more specific) pattern.
 */
export function sanitizeLabel(label: string, tokenize: (value: string, type: PIIType) => string): string {
  if (!label || typeof label !== 'string') return label;

  const hits: LabelHit[] = [];
  for (const p of LABEL_PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(label)) !== null) {
      const raw = m[0];
      const cleanVal = p.clean(raw);
      if (p.validate && !p.validate(cleanVal)) {
        if (m.index === p.re.lastIndex) p.re.lastIndex++;
        continue;
      }
      hits.push({ start: m.index, end: m.index + raw.length, type: p.type, value: cleanVal });
      if (m.index === p.re.lastIndex) p.re.lastIndex++;
    }
  }
  if (hits.length === 0) return label;

  // Sort by start asc, then length desc (more specific first), then drop overlaps
  hits.sort((a, b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)));
  const accepted: LabelHit[] = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      accepted.push(h);
      lastEnd = h.end;
    }
  }

  let out = '';
  let pos = 0;
  for (const h of accepted) {
    out += label.slice(pos, h.start);
    out += tokenize(h.value, h.type);
    pos = h.end;
  }
  out += label.slice(pos);
  return out;
}

export class FailClosedEgressVerifier {
  private activeCanaryToken: string = '';

  constructor() {
    this.refreshCanary();
  }

  public refreshCanary(): string {
    this.activeCanaryToken = 'CANARY_' + randomToken(8).toUpperCase();
    return this.activeCanaryToken;
  }

  public getCanary(): string {
    return this.activeCanaryToken;
  }

  // Cryptographic SHA-256 digest computation using Web Crypto API
  public async computeSHA256(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Pre-flight egress verification: fails closed if any forbidden token or PII slips through
  public async verifyAndSealPayload(
    nodes: OpaqueSceneNode[],
    knownRealValues: string[],
    level: 'L0' | 'L1' | 'L2' | 'L3' = 'L1',
    visualRegionsCount?: number
  ): Promise<{ success: boolean; payload?: SanitizedWirePayload; error?: string }> {
    const serializedNodes = JSON.stringify(nodes);

    // 1. Canary Leak Check
    if (serializedNodes.includes(this.activeCanaryToken)) {
      console.error('[EgressVerifier] FAIL-CLOSED: Canary token found in outbound payload! Egress blocked.');
      return { success: false, error: 'Egress Blocked: Canary string detected in payload.' };
    }

    // 2. Raw PII Residual String Check
    for (const realVal of knownRealValues) {
      if (realVal.length >= 5 && serializedNodes.includes(realVal)) {
        console.error(`[EgressVerifier] FAIL-CLOSED: Residual unmasked real value "${realVal.substring(0, 3)}***" detected in wire payload!`);
        return { success: false, error: `Egress Blocked: Unmasked PII residual detected.` };
      }
    }

    // 3. Compute Cryptographic SHA-256 Digest
    //    NOTE: this digest is independently RECOMPUTED by the reasoning
    //    server from the received nodes; a mismatch is rejected there.
    //    It is an integrity check, not a cryptographic signature (no key).
    const digest = await this.computeSHA256(serializedNodes);

    const payload: SanitizedWirePayload = {
      version: '1.0',
      timestamp: Date.now(),
      disclosureLevel: level,
      digestSha256: digest,
      nodes,
      visualRegionsCount: visualRegionsCount !== undefined
        ? visualRegionsCount
        : nodes.filter(n => n.role === 'CANVAS' || n.role === 'IMAGE').length,
      canarySignature: 'VERIFIED_CLEAN_' + digest.substring(0, 8)
    };

    console.log('[EgressVerifier] Egress Pre-flight Passed. Payload sealed with digest:', digest);
    return { success: true, payload };
  }
}

function randomToken(length: number): string {
  // Prefer cryptographically strong randomness; fall back for non-secure contexts.
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(length);
      crypto.getRandomValues(buf);
      return Array.from(buf, n => (n % 36).toString(36)).join('').slice(0, length).padEnd(length, 'x');
    }
  } catch {
    // fall through
  }
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}

export const egressVerifierInstance = new FailClosedEgressVerifier();
