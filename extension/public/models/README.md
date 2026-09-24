# SentryAgent On-Device Neural Vision Models

This directory contains the compiled, standalone ONNX neural network models executed on-device inside the user's browser via `onnxruntime-web` (WebGPU execution provider with WASM SIMD fallback). **Zero bytes of raw pixels or frames ever egress from the device.**

> **Verification note (v2.6).** Every specification in this file was re-verified
> empirically against the actual model files with `onnxruntime` 1.30.0 (CPU) —
> see `tools/verify_onnx_models.py` and `tools/identify_blazeface_layout.py`.
> Where earlier documentation disagreed (BlazeFace normalization range and
> output column order), the empirical behavior of the files wins.

---

## 1. BlazeFace ONNX (`blazeface.onnx`)

- **Model Type:** Real-Time Facial Biometrics Detection Network
- **File Size:** 535,842 bytes (~536 KB)
- **Runtime:** `onnxruntime-web` (WebGPU / WASM)

### Input Specification (verified)

Four inputs — feed them **by explicit name**, never by index:

| Name | Shape | Dtype | Values |
|---|---|---|---|
| `image` | `[1, 3, 128, 128]` (NCHW) | float32 | **RGB normalized to `0..1`** — `pixel / 255.0` |
| `conf_threshold` | `[1]` | float32 | 0.5 (detection score gate, applied inside the graph) |
| `iou_threshold` | `[1]` | float32 | 0.3 (NMS overlap, applied inside the graph) |
| `max_detections` | `[1]` | **int64** (`BigInt64Array`) | 25 |

> ⚠️ **Corrected:** earlier docs claimed `[-1, 1]` normalization
> (`(pixel - 127.5) / 127.5`). Empirically the graph is a 0..1 model: with
> ±1 inputs the internal conf gate kills every candidate. The shipped
> `visionEngine.ts` feeds `pixel / 255.0`.

### Output Specification (verified)

A single output, `selectedBoxes`, with **dynamic** shape `[1, N, 16]` where
`N` is the number of detections **after** the graph's internal
`conf_threshold` gate + NMS + `max_detections`.

- `N` can be **0** (clean canvas → shape `[1, 0, 16]`).
- ORT's *static* shape metadata (`[1, 896, 16]`) is wrong for this graph —
  always reshape at runtime with `reshape(-1, 16)`; expect a
  `VerifyOutputSizes` warning, it is benign.

Each row is 16 floats, normalized to the 128×128 input (verified by
position-correlation across a synthetic face grid, r = 1.00):

```
row[0] = ymin        (0..1, may slightly exceed 1)
row[1] = xmin        (0..1)
row[2] = ymax        (0..1)
row[3] = xmax        (0..1)
row[4..15] = 6 facial keypoint (x, y) pairs
```

> ⚠️ **Corrected:** earlier docs claimed the column order
> `[xmin, ymin, xmax, ymax]`. Empirically it is `[ymin, xmin, ymax, xmax]`;
> `visionEngine.ts` parses the verified layout and clamps coordinates.

**Per-box score is not exposed.** A bisection over `conf_threshold`
(kill-point T\* = 0.6259) matched no output column, so no column carries the
internal detection score. Consequence: every returned row passed the graph
gate, so `visionEngine.ts` reports the gate value **0.5 as a documented
lower bound** on confidence rather than inventing a score.

- **Secondary Post-Processing:** a defensive secondary IoU-NMS pass
  (threshold = 0.35, shared module `src/vision/nms.ts`) is still applied on
  the client as a guard against duplicate detections.
- **Role in SentryAgent:** detects faces on employee badges, passport scans,
  and ID avatar canvases; triggers in-place pixel burning of solid blackout
  blocks at the verified bounding boxes.

---

## 2. DBNet Text Detection ONNX (`ocr-det.onnx`)

- **Model Type:** Differentiable Binarization Real-Time Text-Region Detection Network
- **File Size:** 4,745,517 bytes (~4.75 MB)
- **Runtime:** `onnxruntime-web` (WebGPU / WASM)

### Input Specification (verified)

| Name | Shape | Dtype | Values |
|---|---|---|---|
| `x` | `[1, 3, H, W]` — **dynamic**, NCHW | float32 | ImageNet channel-wise normalization: mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]` |

The client scales canvas dimensions to the nearest multiple of 32 before
feeding the model (DBNet FPN requirement).

### Output Specification (verified)

| Name | Shape | Values |
|---|---|---|
| `sigmoid_0.tmp_0` | `[1, 1, H, W]` | text-presence probability heatmap, values in `0..1` (sigmoid) |

- Blank-image sanity check: maximum response on a blank frame is **0.0038**
  (i.e. no false text on empty canvases).
- **Multi-Region Connected-Component Labeling (CCL):** 8-connectivity BFS
  over active pixels (`> 0.35` confidence, minimum cluster size `≥ 8`
  pixels), implemented in the shared pure module `src/vision/ccl.ts`.
  Tightly segments **isolated text clusters** into individual bounding boxes
  (e.g. separating a signature on the left from a date on the right),
  preserving the unredacted whitespace in between.
- **Role in SentryAgent:** localizes non-DOM text regions (digital signature
  pads, scanned blueprints, stamped document canvases).

---

## Benchmark Performance

No timing figures are published for this build. The previous version listed
specific millisecond values (e.g. "2.1 ms BlazeFace on WebGPU") that were
never captured with a committed, reproducible measurement script; publishing
them would violate the project's no-fabricated-results rule.

To measure on your hardware: load the extension in Chrome, open the testbed
(`python3 -m http.server` in `testbed/`), run "Scan & Sanitize", and read the
`[VisionEngine]` console timings. If you capture real numbers, commit them
with the device/EP they were measured on.
