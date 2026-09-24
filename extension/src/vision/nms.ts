// Pure Non-Maximum Suppression (NMS) with IoU overlap.
// Extracted from the vision engine so it can be unit-tested directly.

export interface BoxLike {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export function computeIoU(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);

  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - intersection;

  return union > 0 ? intersection / union : 0;
}

export function applyNMS(boxes: BoxLike[], iouThreshold = 0.35): BoxLike[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const selected: BoxLike[] = [];
  for (const box of sorted) {
    if (!selected.some(sel => computeIoU(box, sel) > iouThreshold)) {
      selected.push(box);
    }
  }
  return selected;
}
