// SentryAgent - PII Detection Accuracy Benchmark (v2.6)
//
// Measures precision / recall / F1 of the REAL classification pipeline
// (extension/src/privacy/checksums.ts via esbuild bundle) against the
// complete PII corpus of the testbed page (testbed/index.html +
// testbed/script.js), which is the project's ground truth.
//
//   TP  = ground-truth PII value classified as the expected detector type
//   FP  = non-PII testbed string that the classifier flagged
//   FN  = ground-truth PII value the classifier missed (or mis-typed)
//
// Detector-type mapping: bank accounts, IFSC codes and monetary amounts are
// all reported by the detector as CONFIDENTIAL_NUM (opaque, no sub-type on
// the wire) — the "semantic" column below records the intended class.
//
// Run:  node --test testbed/automated-tests/accuracy-benchmark.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSentryModules } from './_sentry_load.mjs';

const sentry = await loadSentryModules();
const { classifySensitiveText } = sentry;

// ── Ground truth: every sensitive value on the testbed page ──────────────────
// (value, field id the value sits in, semantic class, expected detector type)
const GROUND_TRUTH = [
  { value: 'Dr. Arvind S. Swaminathan',            field: 'vendor-name',              semantic: 'PERSON',     expect: 'PERSON' },
  { value: 'arvind.swaminathan@aerocore-tech.in',  field: 'vendor-email',             semantic: 'EMAIL',      expect: 'EMAIL' },
  { value: '+91 98451 23456',                      field: 'vendor-phone',             semantic: 'PHONE',      expect: 'PHONE' },
  { value: 'AAACA7890B',                           field: 'vendor-pan',               semantic: 'PAN',        expect: 'PAN' },
  { value: '29AAACA7890B1Z5',                      field: 'vendor-gstin',             semantic: 'GSTIN',      expect: 'GSTIN' },
  { value: 'SBIN0001040',                          field: 'vendor-bank-ifsc',         semantic: 'IFSC',       expect: 'CONFIDENTIAL_NUM' },
  { value: '98765432109876',                       field: 'vendor-bank-account',      semantic: 'BANK',       expect: 'CONFIDENTIAL_NUM' },
  { value: '₹ 4,850,000.00',                       field: 'quote-item-1',             semantic: 'AMOUNT',     expect: 'CONFIDENTIAL_NUM' },
  { value: '₹ 12,400,000.00',                      field: 'quote-item-2',             semantic: 'AMOUNT',     expect: 'CONFIDENTIAL_NUM' },
  { value: '₹ 1,875,000.00',                       field: 'quote-item-3',             semantic: 'AMOUNT',     expect: 'CONFIDENTIAL_NUM' },
  { value: '₹ 152,800,000.00',                     field: 'quote-total',              semantic: 'AMOUNT',     expect: 'CONFIDENTIAL_NUM' },
  { value: 'Sunita R. Namboodiri',                 field: 'emp-name',                 semantic: 'PERSON',     expect: 'PERSON' },
  { value: 'sunita.namboodiri@isro.gov.in',        field: 'emp-email',                semantic: 'EMAIL',      expect: 'EMAIL' },
  { value: '9999 9999 0019',                       field: 'emp-aadhaar',              semantic: 'AADHAAR',    expect: 'AADHAAR' },
  { value: 'Z3489127',                             field: 'emp-passport',             semantic: 'PASSPORT',   expect: 'PASSPORT' },
  { value: 'Dr. K. S. Radhakrishnan',              field: 'mission-director-name',    semantic: 'PERSON',     expect: 'PERSON' },
  { value: 'AAAGP1234M',                           field: 'mission-director-pan',     semantic: 'PAN',        expect: 'PAN' },
  { value: '9999 9999 0019',                       field: 'mission-director-aadhaar', semantic: 'AADHAAR',    expect: 'AADHAAR' },
  { value: '4532 0151 1283 0366',                  field: 'transponder-key',          semantic: 'CARD',       expect: 'CARD' },
  { value: '₹ 620,00,00,000',                      field: 'mission-budget',           semantic: 'AMOUNT',     expect: 'CONFIDENTIAL_NUM' },
  { value: '+91 80 2839 5000',                     field: 'station-contact',          semantic: 'PHONE',      expect: 'PHONE' }
];

// ── Negatives: testbed strings that are NOT PII and must not be flagged ──────
const NEGATIVES = [
  { value: 'ISRO-SCI-SF-4891',                          field: 'emp-code',          note: 'personnel code' },
  { value: "Scientist / Engineer 'SF', URSC Bengaluru", field: 'emp-designation',   note: 'designation' },
  { value: 'ESA / CNES Lunar Surface Working Group (Toulouse, France)', field: 'mission-destination', note: 'conference name' },
  { value: '14 Oct 2026 – 28 Oct 2026',                 field: 'mission-dates',     note: 'date range' },
  { value: '8450.25 MHz / RHCP',                        field: 'uplink-frequency',  note: 'frequency' },
  { value: 'Trajectory fine-tuning for apogee 480km Sun-Synchronous Polar Orbit scheduled at 18:45 UTC.', field: 'mission-notes', note: 'ops note' },
  { value: 'TENDER/2026/091',                           field: 'tender-ref',        note: 'reference number' },
  { value: 'Submit Official Bid',                       field: 'submit-btn',        note: 'button label' },
  { value: 'Bid Amount (₹)',                            field: 'bid-amount-label',  note: 'field label' },
  { value: 'Authorized Signatory',                      field: 'signatory-label',   note: 'role title (no name context)' },
  { value: 'Signature Pad',                             field: 'sig-canvas',        note: 'canvas label' },
  { value: 'e.g. ABCDE1234F',                           field: 'vendor-pan-ph',     note: 'placeholder (entity char D is invalid)' }
];

test('pii benchmark: classify every ground-truth value (recall)', () => {
  const misses = [];
  for (const item of GROUND_TRUTH) {
    const hit = classifySensitiveText(item.value, { id: item.field });
    if (!hit || hit.type !== item.expect) {
      misses.push(`  MISS  [${item.semantic}] ${item.value} @ ${item.field} → ${hit ? hit.type : 'null'}`);
    }
  }
  assert.equal(misses.length, 0, `Recall failures:\n${misses.join('\n')}`);
});

test('pii benchmark: classify no negative string (precision)', () => {
  const falsePos = [];
  for (const item of NEGATIVES) {
    const hit = classifySensitiveText(item.value, { id: item.field });
    if (hit) {
      falsePos.push(`  FALSE POSITIVE [${item.note}] ${item.value} @ ${item.field} → ${hit.type}`);
    }
  }
  assert.equal(falsePos.length, 0, `Precision failures:\n${falsePos.join('\n')}`);
});

test('pii benchmark: report precision / recall / F1', () => {
  let tp = 0, fn = 0, fp = 0;
  for (const item of GROUND_TRUTH) {
    const hit = classifySensitiveText(item.value, { id: item.field });
    if (hit && hit.type === item.expect) tp++;
    else fn++;
  }
  for (const item of NEGATIVES) {
    if (classifySensitiveText(item.value, { id: item.field })) fp++;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log('\n══ PII Detection Benchmark (testbed ground truth) ══');
  console.log(`  TP=${tp}  FP=${fp}  FN=${fn}`);
  console.log(`  Precision=${precision.toFixed(3)}  Recall=${recall.toFixed(3)}  F1=${f1.toFixed(3)}`);
  console.log(`  Corpus: ${GROUND_TRUTH.length} sensitive values, ${NEGATIVES.length} negatives\n`);

  // Acceptance bar: near-perfect on the project's own corpus
  assert.ok(precision >= 0.98, `precision ${precision} < 0.98`);
  assert.ok(recall >= 0.98, `recall ${recall} < 0.98`);
  assert.ok(f1 >= 0.98, `f1 ${f1} < 0.98`);
});
