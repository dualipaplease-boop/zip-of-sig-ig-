#!/usr/bin/env python3
"""Empirical ONNX model verification for SentryAgent vision models.

Inspects the actual graph structure (input/output names, shapes) of
blazeface.onnx and ocr-det.onnx, and runs inference on synthetic
testbed-style canvases (recreated from testbed/script.js drawing code)
to determine the exact preprocessing the models require.

Usage:
    python tools/verify_onnx_models.py
"""

import numpy as np
import onnxruntime as ort
from PIL import Image

FACE_MODEL = "extension/public/models/blazeface.onnx"
DBNET_MODEL = "extension/public/models/ocr-det.onnx"


def describe_session(sess):
    print(f"  provider: {sess.get_providers()}")
    print("  inputs:")
    for i in sess.get_inputs():
        print(f"    {i.name!r}: type={i.type} shape={i.shape}")
    print("  outputs:")
    for o in sess.get_outputs():
        print(f"    {o.name!r}: type={o.type} shape={o.shape}")


# ---------------------------------------------------------------------------
# Synthetic testbed canvases (faithful recreations of testbed/script.js)
# ---------------------------------------------------------------------------
def make_testbed_avatar(width=130, height=130):
    img = np.zeros((height, width, 4), dtype=np.uint8)
    top = np.array([0x0f, 0x17, 0x2a])
    bot = np.array([0x1e, 0x29, 0x3b])
    for y in range(height):
        t = y / (height - 1)
        img[y, :, :3] = (top * (1 - t) + bot * t).astype(np.uint8)
    img[:, :, 3] = 255

    yy, xx = np.mgrid[0:height, 0:width]

    def fill_ellipse(cx, cy, rx, ry, color):
        mask = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1
        img[mask, :3] = color

    cx, cy = width // 2, height // 2 - 4
    fill_ellipse(cx, cy, 30, 38, (0xF3, 0xCB, 0xB1))
    hair_cy = height // 2 - 16
    img[((xx - cx) ** 2 + (yy - hair_cy) ** 2 <= 31 ** 2) & (yy <= hair_cy), :3] = (0x1C, 0x19, 0x17)
    for ex in (cx - 11, cx + 11):
        fill_ellipse(ex, height // 2 - 6, 3, 3, (0x0F, 0x17, 0x2A))
    fill_ellipse(cx, height + 18, 52, 34, (0x0D, 0x2B, 0x45))
    return img


def make_testbed_satellite(width=600, height=220):
    img = np.zeros((height, width, 4), dtype=np.uint8)
    c0 = np.array([0x04, 0x0D, 0x1A])
    c1 = np.array([0x0B, 0x1E, 0x36])
    c2 = np.array([0x06, 0x13, 0x25])
    for x in range(width):
        t = x / (width - 1)
        col = c0 * (1 - t * 2) + c1 * (t * 2) if t <= 0.5 else c1 * (1 - (t - 0.5) * 2) + c2 * ((t - 0.5) * 2)
        img[:, x, :3] = col.astype(np.uint8)
    img[:, :, 3] = 255

    def text_line(x0, y0, length, color):
        row = img[y0 - 10:y0 + 2, x0:x0 + length, :3].copy()
        for i in range(0, length, 3):
            row[:, i:i + 2] = color
        img[y0 - 10:y0 + 2, x0:x0 + length, :3] = row

    img[16:62, 16:286, :3] = np.array([0x0D, 0x2B, 0x45])
    text_line(26, 34, 190, (0xF6, 0xAE, 0x2D))
    text_line(26, 50, 215, (0x94, 0xA3, 0xB8))
    img[height - 56:height - 12, width - 280:width - 16, :3] = np.array([0x0D, 0x2B, 0x45])
    text_line(width - 270, height - 38, 178, (0x38, 0xBD, 0xF8))
    text_line(width - 270, height - 22, 212, (0x94, 0xA3, 0xB8))
    return img


def np_to_pil(img):
    return Image.fromarray(img[:, :, :3], "RGB")


def pil_to_nchw_01(pil_img, h, w):
    im = pil_img.resize((w, h), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float32) / 255.0
    return a.transpose(2, 0, 1)[None, ...]


def pil_to_nchw_imagenet(pil_img, h, w):
    im = pil_img.resize((w, h), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    return ((a - mean) / std).transpose(2, 0, 1)[None, ...]


# ---------------------------------------------------------------------------
def probe_face():
    print("=" * 70)
    print("BLAZEFACE PROBE")
    print("=" * 70)
    sess = ort.InferenceSession(FACE_MODEL, providers=["CPUExecutionProvider"])
    describe_session(sess)
    in_names = [i.name for i in sess.get_inputs()]
    out_names = [o.name for o in sess.get_outputs()]

    pil = np_to_pil(make_testbed_avatar())
    base = pil_to_nchw_01(pil, 128, 128)

    def run(base_tensor, conf=0.3, iou=0.0, maxd=896):
        f = {"image": base_tensor,
             "conf_threshold": np.array([conf], dtype=np.float32),
             "max_detections": np.array([maxd], dtype=np.int64),
             "iou_threshold": np.array([iou], dtype=np.float32)}
        res = sess.run(out_names, f)
        return {n: np.asarray(a) for n, a in zip(out_names, res)}

    blank = np_to_pil(np.tile(np.array([[0x14, 0x20, 0x30]], dtype=np.uint8), (130, 130, 1)))
    blank_t = pil_to_nchw_01(blank, 128, 128)

    face_res = run(base)
    blank_res = run(blank_t)
    arr = face_res[out_names[0]].reshape(-1, 16)
    _b = blank_res[out_names[0]].reshape(-1, 16) if blank_res[out_names[0]].size else np.zeros((0, 16))
    barr = _b
    print(f"\n  selectedBoxes: face img -> {arr.shape[0]} detection(s); blank img -> {barr.shape[0]} detection(s) (each row = 16 floats)")
    for i, row in enumerate(arr):
        print(f"  face detection row {i}: {np.round(row, 4)}")
    if barr.shape[0]:
        for i, row in enumerate(barr):
            print(f"  blank detection row {i}: {np.round(row, 4)}")
    if arr.shape[0] == 0:
        print("  no detections on face image with conf=0.3 — retrying with conf=0.0")
        arr = run(base, conf=0.0)[out_names[0]].reshape(-1, 16)
        print(f"  face img conf=0.0 -> {arr.shape[0]} rows; max col values: {np.round(arr.max(axis=0), 3)}")
    if arr.shape[0]:
        print("\n  per-column stats [face detections]")
        for c in range(16):
            extra = f" | blank_max={barr[:, c].max():9.4f}" if barr.shape[0] else ""
            print(f"    col{c:2d}:  max={arr[:, c].max():10.4f} min={arr[:, c].min():10.4f}{extra}")

    # candidate score columns: high on face, low on blank
    score_cols = [c for c in range(16) if arr[:, c].max() > 0.6 and barr[:, c].max() < 0.5]
    print(f"\n  candidate score columns: {score_cols}")

    # Ground truth: face ellipse center (65,61) rx30 ry38 on 130x130 -> 128x128
    s = 128.0 / 130.0
    gx0, gx1 = (65 - 30) * s, (65 + 30) * s
    gy0, gy1 = (61 - 38) * s, (61 + 38) * s
    print(f"  ground-truth face box (128 coords): x=[{gx0:.1f},{gx1:.1f}] y=[{gy0:.1f},{gy1:.1f}]")

    def iou_gt(x0, y0, x1, y1):
        ix0, iy0 = max(x0, gx0), max(y0, gy0)
        ix1, iy1 = min(x1, gx1), min(y1, gy1)
        inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
        uni = (gx1 - gx0) * (gy1 - gy0) + (x1 - x0) * (y1 - y0) - inter
        return inter / uni if uni > 0 else 0.0

    for sc in score_cols:
        order = np.argsort(-arr[:, sc])
        print(f"\n  top-6 rows scored by col{sc}:")
        for rank, i in enumerate(order[:6]):
            row = arr[i]
            line = f"    rank{rank} row={i} score={row[sc]:.3f} cols0-3={np.round(row[:4],3)}"
            print(line)
            for tag, (bx0, by0, bx1, by1) in (
                ("xyxy*128", (row[0] * 128, row[1] * 128, row[2] * 128, row[3] * 128)),
                ("yxyx*128", (row[1] * 128, row[0] * 128, row[3] * 128, row[2] * 128)),
                ("xyxy px ", (row[0], row[1], row[2], row[3])),
                ("yxyx px ", (row[1], row[0], row[3], row[2])),
            ):
                v = iou_gt(min(bx0, bx1), min(by0, by1), max(bx0, bx1), max(by0, by1))
                if v > 0.3:
                    print(f"         [{tag}] box=({min(bx0,bx1):.1f},{min(by0,by1):.1f},"
                          f"{max(bx0,bx1):.1f},{max(by0,by1):.1f}) IoU={v:.2f}")

    # Also check: does max_detections actually filter? and effect of conf_threshold
    for conf in (0.0, 0.5, 0.9):
        r = run(base, conf=conf)
        a = r[out_names[0]].reshape(-1, 16)
        # count rows that are all zero
        nonzero = int((np.abs(a) > 1e-8).any(axis=1).sum())
        print(f"  conf_threshold={conf}: nonzero rows={nonzero}/{a.shape[0]}")


def probe_dbnet():
    print()
    print("=" * 70)
    print("DBNET (ocr-det) PROBE")
    print("=" * 70)
    sess = ort.InferenceSession(DBNET_MODEL, providers=["CPUExecutionProvider"])
    describe_session(sess)
    in_names = [i.name for i in sess.get_inputs()]
    out_names = [o.name for o in sess.get_outputs()]

    pil = np_to_pil(make_testbed_satellite())
    W, H = 600, 220
    tw = max(32, round(W / 32) * 32)
    th = max(32, round(H / 32) * 32)
    print(f"  TS behavior feeds [1,3,{th},{tw}] (canvas {W}x{H} -> 32-multiple)")

    t = pil_to_nchw_imagenet(pil, th, tw)
    res = sess.run(out_names, {in_names[0]: t})
    pm = np.asarray(res[0])
    print(f"  output {out_names[0]}: shape={list(pm.shape)} min={pm.min():.4f} max={pm.max():.4f}")
    prob = pm.reshape(1, pm.shape[-2], pm.shape[-1])[0] if pm.ndim == 4 else pm.reshape(pm.shape[-2], pm.shape[-1])
    active = prob > 0.35
    print(f"  prob map px>0.35: {int(active.sum())} / {active.size}")

    # simple connected components to see cluster separation
    from collections import deque
    visited = np.zeros_like(active, dtype=bool)
    clusters = []
    for y in range(prob.shape[0]):
        for x in range(prob.shape[1]):
            if active[y, x] and not visited[y, x]:
                q = deque([(x, y)])
                visited[y, x] = True
                minx, maxx, miny, maxy = x, x, y, y
                count = 0
                while q:
                    cx, cy = q.popleft()
                    count += 1
                    minx, maxx = min(minx, cx), max(maxx, cx)
                    miny, maxy = min(miny, cy), max(maxy, cy)
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < prob.shape[1] and 0 <= ny < prob.shape[0] \
                               and active[ny, nx] and not visited[ny, nx]:
                                visited[ny, nx] = True
                                q.append((nx, ny))
                if count >= 8:
                    clusters.append((minx, miny, maxx, maxy, count))
    print(f"  CCL clusters (>=8 px, 8-conn): {len(clusters)}")
    for (minx, miny, maxx, maxy, count) in clusters:
        # scale back to canvas coords
        sx, sy = W / prob.shape[1], H / prob.shape[0]
        print(f"    map=({minx},{miny})-({maxx},{maxy}) px={count}  -> canvas x=[{minx*sx:.0f},{(maxx+1)*sx:.0f}] y=[{miny*sy:.0f},{(maxy+1)*sy:.0f}]")


if __name__ == "__main__":
    probe_face()
    probe_dbnet()
