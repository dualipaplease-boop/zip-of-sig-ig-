// Pure Connected-Component Labeling (CCL) for probability heatmaps.
// 8-connectivity BFS segmentation of text clusters, extracted from the
// vision engine so it can be unit-tested directly.

export interface TextCluster {
  x: number;
  y: number;
  w: number;
  h: number;
  pixelCount: number;
  avgScore: number;
}

export interface CclOptions {
  /** Probability threshold (default 0.35) */
  threshold?: number;
  /** Minimum cluster pixel count (default 8) */
  minPixelCount?: number;
}

// 8-connectivity neighbor offsets [dx, dy]
const NEIGHBORS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
];

export function extractTextClusters(
  probMap: Float32Array,
  mapW: number,
  mapH: number,
  options: CclOptions = {}
): TextCluster[] {
  const threshold = options.threshold ?? 0.35;
  const minPixelCount = options.minPixelCount ?? 8;

  const clusters: TextCluster[] = [];
  const visited = new Uint8Array(mapW * mapH);

  for (let startY = 0; startY < mapH; startY++) {
    for (let startX = 0; startX < mapW; startX++) {
      const startOffset = startY * mapW + startX;
      if (visited[startOffset] || probMap[startOffset] < threshold) continue;

      // BFS queue to discover connected component
      const queue: number[] = [startX, startY];
      visited[startOffset] = 1;

      let minX = startX, maxX = startX;
      let minY = startY, maxY = startY;
      let pixelCount = 0;
      let sumScore = 0;

      let head = 0;
      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        const score = probMap[cy * mapW + cx];

        pixelCount++;
        sumScore += score;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let i = 0; i < NEIGHBORS.length; i++) {
          const nx = cx + NEIGHBORS[i][0];
          const ny = cy + NEIGHBORS[i][1];

          if (nx >= 0 && nx < mapW && ny >= 0 && ny < mapH) {
            const nOffset = ny * mapW + nx;
            if (!visited[nOffset] && probMap[nOffset] >= threshold) {
              visited[nOffset] = 1;
              queue.push(nx, ny);
            }
          }
        }
      }

      // Filter out tiny artifacts/noise
      if (pixelCount >= minPixelCount && maxX > minX && maxY > minY) {
        clusters.push({
          x: minX,
          y: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          pixelCount,
          avgScore: sumScore / pixelCount
        });
      }
    }
  }

  return clusters;
}
