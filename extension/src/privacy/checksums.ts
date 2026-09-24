// Checksum-Validated PII and Sensitive Data Detectors
// Implements exact Verhoeff (Aadhaar), Luhn (Cards), PAN structure, GSTIN,
// Indian mobile/landline, bank account, passport, IFSC, financial quote,
// and context-aware person-name detection.
//
// v2.6 changes (verified against testbed ground truth):
//  - PHONE: whole-value normalized matching. Any formatting (spaces, dashes,
//    +91 / 0091 / 0 prefixes, landlines) is normalized to digits before an
//    anchored test. Replaces the previous unanchored regex, which produced
//    false positives inside longer digit strings and missed formatted
//    landlines such as "+91 80 2839 5000".
//  - BANK_ACCOUNT: 13-19 digit numbers that fail Luhn are classified as
//    CONFIDENTIAL_NUM (commercial bank settlement accounts). Previously the
//    BANK_ACCOUNT_REGEX was declared but never used (dead code) and such
//    values were silently unflagged.
//  - PERSON: context-aware heuristic name detector (field id/label must
//    indicate an identity context, or the caller sets context.strict for
//    untrusted model-provided values). Documented behavior
//    (<PERSON_1> tokens) is now actually implemented.
//  - EMAIL / PASSPORT / IFSC: anchored to the whole value (the classifier
//    receives complete field values), removing substring false positives.

// ==========================================
// 1. Verhoeff Algorithm for Aadhaar (UIDAI)
// ==========================================
const VERHOEFF_D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const VERHOEFF_P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

export function validateVerhoeff(numStr: string): boolean {
  const clean = numStr.replace(/\s+/g, '');
  if (!/^\d{12}$/.test(clean)) return false;

  let c = 0;
  const digits = clean.split('').map(Number).reverse();

  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  }

  return c === 0;
}

// ==========================================
// 2. Luhn Algorithm for Payment Cards
// ==========================================
export function validateLuhn(cardStr: string): boolean {
  const clean = cardStr.replace(/[\s-]+/g, '');
  if (!/^\d{13,19}$/.test(clean)) return false;

  let sum = 0;
  let alternate = false;

  for (let i = clean.length - 1; i >= 0; i--) {
    let n = parseInt(clean.charAt(i), 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n = (n % 10) + 1;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

// ==========================================
// 3. Indian PAN (Permanent Account Number)
// ==========================================
// 5 letters, 4 digits, 1 letter. 4th letter is entity type: P, C, H, A, B, G, J, L, F, T
const VALID_PAN_ENTITY_TYPES = new Set(['P', 'C', 'H', 'A', 'B', 'G', 'J', 'L', 'F', 'T']);

export function validatePAN(panStr: string): boolean {
  const clean = panStr.trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean)) return false;
  const entityChar = clean.charAt(3);
  return VALID_PAN_ENTITY_TYPES.has(entityChar);
}

// ==========================================
// 4. Indian GSTIN (Goods & Services Tax ID)
// ==========================================
// 15 characters: 2-digit state code + 10-char PAN + 1-char entity + 'Z' + 1 check char
export function validateGSTIN(gstinStr: string): boolean {
  const clean = gstinStr.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(clean)) return false;

  // Extract and validate the embedded PAN
  const embeddedPAN = clean.substring(2, 12);
  return validatePAN(embeddedPAN);
}

// ==========================================
// 5. Indian Phone / Landline (format-agnostic)
// ==========================================
// Normalize the whole value to digits, then require:
//   optional country code (+91 / 0091 / 91) or domestic trunk prefix (0),
//   followed by exactly 10 digits starting with 6-9.
// Whole-value matching prevents the previous unanchored-regex false
// positives on long digit strings (e.g. bank account numbers).
export function validateIndianPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return /^(?:(?:\+?|00)?91|0)?[6-9]\d{9}$/.test(digits);
}

// ==========================================
// 6. Person-Name Heuristic (context-gated)
// ==========================================
const NAME_FIELD_HINTS =
  /name|officer|bidder|applicant|director|employee|personnel|person|candidate|principal|beneficiary|contact/i;

const COMPANY_WORDS =
  /\b(company|corp|corporation|llc|ltd|limited|pvt|private|inc|incorporated|group|partners|solutions|technologies|tech|labs|industries|engineering|enterprises|consulting|services|trading|manufacturing)\b/i;

export function looksLikePersonName(value: string): boolean {
  const t = value.trim();
  if (t.length < 4 || t.length > 80) return false;
  if (/\d/.test(t)) return false;                       // digits -> not a person name
  if (/[\/\\(){}[\]<>|;:,@#&$%^+=~`'"]/.test(t)) return false; // structural chars
  if (t.includes('@')) return false;
  if (COMPANY_WORDS.test(t)) return false;

  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;

  for (const w of words) {
    // Plain word, single initial with dot ("K.", "Dr."), or hyphen/apostrophe compound
    const plain = /^[\p{L}]+(?:\.(?=\s|$))?$/u;
    const compound = /^[\p{L}]+(?:['-][\p{L}]+)*$/u;
    if (!plain.test(w) && !compound.test(w)) return false;
  }

  if (!/^[\p{Lu}]/u.test(words[0])) return false;
  const capitalized = words.filter(w => /^[\p{Lu}]/u.test(w)).length;
  if (capitalized < 2) return false;

  return true;
}

// ==========================================
// 7. Standard PII Regex Pattern Matchers
// ==========================================
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const INDIAN_PASSPORT_REGEX = /^[A-Z][0-9]{7}$/;
const INDIAN_BANK_IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_ACCOUNT_DIGITS_REGEX = /^\d{13,19}$/;
const FINANCIAL_BID_REGEX = /(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?|^\d{1,3}(?:,\d{2,3})*\.\d{2}$/;

// Master classifier function: checks a given text and returns its detected PII type & confidence
export interface ClassificationContext {
  id?: string;
  label?: string;
  placeholder?: string;
  /**
   * When true, the value is untrusted model output: name-like values are
   * treated as sensitive even without a name-field context (safe direction:
   * over-reject rather than leak).
   */
  strict?: boolean;
}

export interface ChecksumMatch {
  type: 'AADHAAR' | 'PAN' | 'GSTIN' | 'CARD' | 'EMAIL' | 'PHONE' | 'PASSPORT' | 'CONFIDENTIAL_NUM' | 'PERSON';
  cleanValue: string;
  confidence: number;
}

export function classifySensitiveText(text: string, context?: ClassificationContext): ChecksumMatch | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Aadhaar (must pass Verhoeff)
  const digitsOnly = trimmed.replace(/\s+/g, '');
  if (/^\d{12}$/.test(digitsOnly) && validateVerhoeff(digitsOnly)) {
    return { type: 'AADHAAR', cleanValue: trimmed, confidence: 0.99 };
  }

  // 2. Payment Card (must pass Luhn)
  const cardDigits = trimmed.replace(/[\s-]+/g, '');
  if (/^\d{13,19}$/.test(cardDigits) && validateLuhn(cardDigits)) {
    return { type: 'CARD', cleanValue: trimmed, confidence: 0.99 };
  }

  // 3. GSTIN (with embedded PAN validation)
  if (validateGSTIN(trimmed)) {
    return { type: 'GSTIN', cleanValue: trimmed.toUpperCase(), confidence: 0.98 };
  }

  // 4. Indian PAN (with entity char check)
  if (validatePAN(trimmed)) {
    return { type: 'PAN', cleanValue: trimmed.toUpperCase(), confidence: 0.98 };
  }

  // 5. Financial quotation / confidential price.
  //    Checked BEFORE the phone test: Indian-lakh grouping of large amounts
  //    (e.g. "₹ 620,00,00,000") normalizes to exactly 10 digits that pass
  //    the mobile-phone test. The financial regex requires an explicit
  //    currency marker (or lakh grouping with decimals), so a genuine
  //    phone number can never match it.
  if (FINANCIAL_BID_REGEX.test(trimmed)) {
    return { type: 'CONFIDENTIAL_NUM', cleanValue: trimmed, confidence: 0.88 };
  }

  // 6. Email (anchored whole value)
  if (EMAIL_REGEX.test(trimmed)) {
    return { type: 'EMAIL', cleanValue: trimmed, confidence: 0.95 };
  }

  // 7. Indian phone / landline (normalized whole value)
  if (validateIndianPhone(trimmed)) {
    return { type: 'PHONE', cleanValue: trimmed, confidence: 0.93 };
  }

  // 8. Passport (anchored whole value)
  if (INDIAN_PASSPORT_REGEX.test(trimmed.toUpperCase())) {
    return { type: 'PASSPORT', cleanValue: trimmed.toUpperCase(), confidence: 0.92 };
  }

  // 9. Commercial bank account: 13-19 digits that are not a Luhn-valid card
  if (BANK_ACCOUNT_DIGITS_REGEX.test(cardDigits)) {
    return { type: 'CONFIDENTIAL_NUM', cleanValue: trimmed, confidence: 0.85 };
  }

  // 10. IFSC code (anchored whole value)
  if (INDIAN_BANK_IFSC_REGEX.test(trimmed.toUpperCase())) {
    return { type: 'CONFIDENTIAL_NUM', cleanValue: trimmed.toUpperCase(), confidence: 0.90 };
  }

  // 11. Person name (context-gated; last priority)
  const contextHay = `${context?.id || ''} ${context?.label || ''} ${context?.placeholder || ''}`;
  const nameContext = Boolean(context?.strict) || NAME_FIELD_HINTS.test(contextHay);
  if (nameContext && looksLikePersonName(trimmed)) {
    return { type: 'PERSON', cleanValue: trimmed, confidence: 0.80 };
  }

  return null;
}
