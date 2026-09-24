#!/usr/bin/env python3
"""Disambiguate BlazeFace selectedBoxes 16-column layout.

Tests:
  T1. Move the synthetic face to a known off-center location and check
      which column interpretation tracks the true position.
  T2. Sweep conf_threshold to find which column is the score (the row
      disappears when the threshold crosses the score value).
  T3. Multi-face: two faces -> expect 2 rows.
"""
import numpy as np
import onnxruntime as ort
from PIL import Image

FACE_MODEL = "extension/public/models/blazeface.onnx"
sess = ort.InferenceSession(FACE_MODEL, providers=["CPUExecutionProvider"])
out_name = sess.get_outputs()[0].name


def face_at(cx, cy, size=38, W=130, H=130):
    img = np.zeros((H, W, 4), dtype=np.uint8)
    img[:, :, :3] = (0x14, 0x20, 0x30)
    img[:, :, 3] = 255
    yy, xx = np.mgrid[0:H, 0:W]
    ry, rx = int(size * 1.27), int(size)
    img[((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1, :3] = (0xF3, 0xCB, 0xB1)
    hair_cy = cy - int(size * 0.48)
    r = int(size * 1.03)
    img[((xx - cx) ** 2 + (yy - hair_cy) ** 2 <= r * r) & (yy <= hair_cy), :3] = (0x1C, 0x19, 0x17)
    for ex in (cx - int(size * 0.37), cx + int(size * 0.37)):
        rr = 3
        img[((xx - ex) / rr) ** 2 + ((yy - (cy - int(size * 0.21))) / rr) ** 2 <= 1, :3] = (0x0F, 0x17, 0x2A)
    return img


def run(img, conf=0.3, iou=0.0):
    rgb = np.asarray(Image.fromarray(img[:, :, :3]).resize((128, 128), Image.BILINEAR),
                     dtype=np.float32) / 255.0
    t = rgb.transpose(2, 0, 1)[None, ...]
    f = {"image": t,
         "conf_threshold": np.array([conf], dtype=np.float32),
         "max_detections": np.array([16], dtype=np.int64),
         "iou_threshold": np.array([iou], dtype=np.float32)}
    a = np.asarray(sess.run([out_name], f)[0]).reshape(-1, 16)
    return a


def report(tag, img, true_cx, true_cy, size=38):
    rows = run(img)
    print(f"\n== {tag}: true center=({true_cx},{true_cy}) size={size} on 130x130 -> 128 coords ({true_cx*128/130:.1f},{true_cy*128/130:.1f})")
    for i, row in enumerate(rows):
        print(f"   row{i}: {np.round(row, 4)}")
        c0, c1, c2, c3 = row[0], row[1], row[2], row[3]
        for tag2, (x0, y0, x1, y1) in (
            ("xyxy", (c0 * 128, c1 * 128, c2 * 128, c3 * 128)),
            ("yxyx", (c1 * 128, c0 * 128, c3 * 128, c2 * 128)),
        ):
            print(f"   [{tag2}] box=({x0:.1f},{y0:.1f})-({x1:.1f},{y1:.1f}) center=({(x0+x1)/2:.1f},{(y0+y1)/2:.1f}) size={x1-x0:.1f}x{y1-y0:.1f}")


# T1: face centered (model should find it)
report("T1a center", face_at(65, 61), 65, 61)
# T1b: face moved to upper-left
report("T1b upper-left", face_at(40, 40), 40, 40)
# T1c: face moved to lower-right
report("T1c lower-right", face_at(88, 88), 88, 88)

# T2: conf_threshold sweep on centered face
print("\n== T2 conf_threshold sweep (centered face):")
rows0 = run(face_at(65, 61), conf=0.0)
print(f"   conf=0.0 -> {rows0.shape[0]} row(s)")
if rows0.shape[0]:
    row = rows0[0]
    for c in range(16):
        th = row[c] + 0.05
        n = run(face_at(65, 61), conf=th).shape[0]
        if n == 0:
            print(f"   col{c} value={row[c]:.4f} -> threshold {th:.4f} kills detection  <-- score candidate")
            break
    else:
        print("   no column killed detection at value+0.05 (score may be in cols beyond or gated differently)")
for th in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8):
    n = run(face_at(65, 61), conf=th).shape[0]
    print(f"   conf={th}: {n} detection(s)")

# T3: two faces
two = face_at(40, 40)
yy, xx = np.mgrid[0:130, 0:130]
two[((xx - 90) / 26) ** 2 + ((yy - 85) / 33) ** 2 <= 1, :3] = (0xF3, 0xCB, 0xB1)
rows = run(two, conf=0.0)
print(f"\n== T3 two faces -> {rows.shape[0]} row(s)")
for i, row in enumerate(rows):
    print(f"   row{i}: {np.round(row[:5], 4)}")
