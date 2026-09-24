import type { PIIType, VaultEntry } from '../types';

export class LocalInversionVault {
  // Token -> VaultEntry mapping (stored exclusively in client memory)
  private vault: Map<string, VaultEntry> = new Map();
  // Reverse index: realValue -> token (ensures identical values share a consistent token within the session)
  private reverseIndex: Map<string, string> = new Map();
  // Per-type counter for deterministic readable tokens: <AADHAAR_ID_1>, <PERSON_1>, etc.
  private counters: Map<PIIType, number> = new Map();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.vault.clear();
    this.reverseIndex.clear();
    this.counters.clear();
  }

  // Tokenize a sensitive string: returns an existing token or generates a new semantic token
  public tokenize(realValue: string, type: PIIType, selector?: string): string {
    const trimmed = realValue.trim();
    if (!trimmed) return realValue;

    // Check if we already tokenized this exact value
    const existingToken = this.reverseIndex.get(trimmed);
    if (existingToken) {
      return existingToken;
    }

    // Generate new semantic token
    const nextIndex = (this.counters.get(type) || 0) + 1;
    this.counters.set(type, nextIndex);

    const tokenPrefix = this.getTokenPrefix(type);
    const token = `<${tokenPrefix}_${nextIndex}>`;

    const entry: VaultEntry = {
      token,
      realValue: trimmed,
      type,
      detectedAt: Date.now(),
      sourceElementSelector: selector
    };

    this.vault.set(token, entry);
    this.reverseIndex.set(trimmed, token);

    return token;
  }

  // Re-hydrate a token back into its real value locally
  public rehydrate(tokenOrText: string): string {
    if (!tokenOrText) return tokenOrText;

    // Direct token lookup
    const directEntry = this.vault.get(tokenOrText.trim());
    if (directEntry) {
      return directEntry.realValue;
    }

    // Replace all occurrences of known tokens within a larger string
    let result = tokenOrText;
    for (const [token, entry] of this.vault.entries()) {
      if (result.includes(token)) {
        result = result.split(token).join(entry.realValue);
      }
    }
    return result;
  }

  // Check if a string is a registered token
  public isToken(str: string): boolean {
    return this.vault.has(str.trim());
  }

  // Get total count of protected entities
  public size(): number {
    return this.vault.size;
  }

  // Get all active entries (for popup inspection with partial masking)
  public getInspectionEntries(): Array<{ token: string; maskedReal: string; type: PIIType }> {
    const list: Array<{ token: string; maskedReal: string; type: PIIType }> = [];
    for (const entry of this.vault.values()) {
      list.push({
        token: entry.token,
        maskedReal: this.maskForPreview(entry.realValue, entry.type),
        type: entry.type
      });
    }
    return list;
  }

  // Get aggregated counts of protected entities grouped by type
  public getCountsByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of this.vault.values()) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    }
    return counts;
  }

  // Helper: mask sensitive values for safe visual verification
  private maskForPreview(val: string, type: PIIType): string {
    if (val.length <= 4) return '••••';
    if (type === 'EMAIL') {
      const parts = val.split('@');
      return `${parts[0].charAt(0)}•••@${parts[1]}`;
    }
    const visibleChars = Math.min(2, Math.floor(val.length / 3));
    return val.substring(0, visibleChars) + '••••' + val.substring(val.length - visibleChars);
  }

  private getTokenPrefix(type: PIIType): string {
    switch (type) {
      case 'AADHAAR': return 'AADHAAR_ID';
      case 'PAN': return 'PAN_NO';
      case 'GSTIN': return 'GSTIN_ID';
      case 'CARD': return 'CARD_NO';
      case 'EMAIL': return 'EMAIL';
      case 'PHONE': return 'PHONE_NO';
      case 'PASSPORT': return 'PASSPORT_ID';
      case 'CONFIDENTIAL_NUM': return 'CONFIDENTIAL_VAL';
      case 'PERSON': return 'PERSON';
      case 'CANVAS_SIGNATURE': return 'REDACTED_SIGNATURE';
      case 'AVATAR_FACE': return 'REDACTED_AVATAR';
      default: return 'PROTECTED_DATA';
    }
  }
}

// Global singleton instance for the extension
export const vaultInstance = new LocalInversionVault();
