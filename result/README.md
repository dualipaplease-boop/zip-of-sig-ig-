# SentryAgent — Evaluation Artifacts & Test Results Catalog

**Problem Statement:** ISRO — On-device Visual Perception for Light-weight Browser Agents (SIH26171)  
**Location:** `result/` (repository root)  
**Generated:** 22 September 2026 (v2.6.0 note: paths corrected to repository-relative)  

> **Correction (v2.6.0):** the artifacts in section 1 are **WebP still
> frames** (verified by magic bytes: `RIFF…WEBPVP8X`), not video recordings.
> No video files exist in this repository. Section 1 has been renamed
> accordingly.

---

## 1. Demonstration Still Frames (WebP)

| Artifact File | Description & Verification Proof | Size |
|---|---|---|
| [`testbed_all_portals_1790101222348.webp`](testbed_all_portals_1790101222348.webp) | **Complete Multi-Portal Verification still**: captures browser state across the 3 portals (e-Procurement, HR Deputation, ISTRAC Mission Operations) with loaded PII scenarios and rendered visual canvases. | 3.45 MB |
| [`istrac_portal_demo_1790100773503.webp`](istrac_portal_demo_1790100773503.webp) | **ISTRAC Mission Operations still**: multispectral satellite telemetry canvas, flight director biometric badge, and classified orbital burn authorization gating. | 3.48 MB |
| [`testbed_portal_verification_1790093994710.webp`](testbed_portal_verification_1790093994710.webp) | **Initial Dual-Portal still**: baseline view of e-Procurement and HR Deputation portals. | 3.36 MB |

---

## 2. High-Resolution Visual Evidence (Screenshots)

### A. All Three Live Portals (Final Build)
| Screenshot File | Description | Size |
|---|---|---|
| [`eprocurement_portal_1790101368665.png`](eprocurement_portal_1790101368665.png) | **Portal 1 (e-Procurement)**: Full-page view showing Dr. Arvind S. Swaminathan's tender bid, PAN, GSTIN, escrow account, and vector signature canvas. | 345.8 KB |
| [`hr_deputation_portal_1790101472779.png`](hr_deputation_portal_1790101472779.png) | **Portal 2 (HR & Deputation)**: Full-page view showing Sunita R. Namboodiri's clearance file, Verhoeff-validated Aadhaar (`9999 9999 0019`), and biometric badge avatar. | 320.3 KB |
| [`istrac_mission_ops_all_1790101573967.png`](istrac_mission_ops_all_1790101573967.png) | **Portal 3 (ISTRAC Mission Operations)**: Full-page view showing Cartosat-3 satellite observation canvas, Flight Director biometric avatar, Luhn transponder key, and Tier 4 orbital burn button. | 517.5 KB |
| [`istrac_mission_ops_1790101126252.png`](istrac_mission_ops_1790101126252.png) | **Portal 3 (Telemetry Close-up)**: Detailed render of the multispectral satellite observation grid and telemetry parameters. | 518.1 KB |

### B. Detailed Visual Targets & Canvases
| Screenshot File | Description | Size |
|---|---|---|
| [`eprocurement_bottom_signature_1790094151973.png`](eprocurement_bottom_signature_1790094151973.png) | Detailed view of the HTML5 digital signature pad canvas with realistic bezier vector strokes. | 184.8 KB |
| [`eprocurement_populated_scenario_1790094260858.png`](eprocurement_populated_scenario_1790094260858.png) | Populated e-Procurement form fields with realistic PII test vectors ready for Inversion Vault tokenization. | 189.1 KB |
| [`hr_portal_bottom_avatar_1790094368347.png`](hr_portal_bottom_avatar_1790094368347.png) | Detailed view of the procedural biometric face mask canvas for BlazeFace ONNX detection. | 197.3 KB |
| [`hr_portal_view_1790094330079.png`](hr_portal_view_1790094330079.png) | Default view of the HR Deputation form before scenario loading. | 250.3 KB |
| [`eprocurement_default_view_1790094084844.png`](eprocurement_default_view_1790094084844.png) | Default initial view of the e-Procurement portal. | 246.2 KB |

---

## 3. Technical Deliverables & Specifications
- [`walkthrough.md`](walkthrough.md): Comprehensive system walkthrough detailing all 5 phases, architecture diagrams, and verification benchmarks.
- [`implementation_plan.md`](implementation_plan.md): Architectural design document defining the trust boundaries, model formats, and testing targets.
