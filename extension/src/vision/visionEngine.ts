// On-Device Visual Perception Engine (Phase 2 & 5)
// Real neural network inference running client-side with zero data egress:
// 1. BlazeFace ONNX (536KB): Facial biometric detection.
//    - Graph-internal conf_threshold / NMS / max_detections (verified via
//      tools/verify_onnx_models.py); client applies a defensive secondary
//      IoU-NMS pass.
//    - Output row layout (verified): [ymin, xmin, ymax, xmax, keypoints...],
//      normalized to the 128x128 input.
// 2. DBNet ONNX (4.7MB): Neural text region detector for canvas/image
//    elements (dynamic NCHW input, ImageNet normalization, probability
//    heatmap output -> 8-connectivity CCL).
// 3. In-Place Canvas Redaction: Burns solid blackout blocks at exact
//    neural network bounding boxes.

import * as ort from 'onnxruntime-web';
import { applyNMS } from './nms';
import { extractTextClusters } from './ccl';

export interface VisualBBox {
  id: string;
  type: 'FACE' | 'SIGNATURE' | 'TEXT_REGION' | 'CANVAS_CREDENTIAL';
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  token: string;
}

const BLAZEFACE_INPUT_SIZE = 128;
const DEFAULT_FACE_CONFIDENCE = 0.50;
const NMS_IOU_THRESHOLD = 0.35;

export class OnDeviceVisionEngine {
  private faceSession: ort.InferenceSession | null = null;
  private ocrDetSession: ort.InferenceSession | null = null;
  private isFaceModelLoading: boolean = false;
  private isOcrModelLoading: boolean = false;
  private executionProviderUsed: 'webgpu' | 'wasm' | 'heuristic_fallback' = 'heuristic_fallback';

  private faceModelUrl: string = '';
  private ocrDetModelUrl: string = '';

  constructor() {
    this.initModelUrls();
  }

  private initModelUrls(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      this.faceModelUrl = chrome.runtime.getURL('models/blazeface.onnx');
      this.ocrDetModelUrl = chrome.runtime.getURL('models/ocr-det.onnx');
      try {
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('');
      } catch (e) {
        // ignore in non-browser or mock environments
      }
    } else {
      this.faceModelUrl = 'models/blazeface.onnx';
      this.ocrDetModelUrl = 'models/ocr-det.onnx';
    }
  }

  // Load the compiled ONNX model sessions (WebGPU preferred, WASM fallback)
  public async loadModels(): Promise<void> {
    await Promise.all([this.loadFaceModel(), this.loadOcrDetModel()]);
  }

  private async loadFaceModel(): Promise<boolean> {
    if (this.faceSession) return true;
    if (this.isFaceModelLoading) return false;

    this.isFaceModelLoading = true;
    console.log('[VisionEngine] Loading BlazeFace ONNX from:', this.faceModelUrl);

    const providers = this.getPreferredProviders();
    for (const provider of providers) {
      try {
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;

        this.faceSession = await ort.InferenceSession.create(this.faceModelUrl, {
          executionProviders: [provider],
          graphOptimizationLevel: 'all',
          logSeverityLevel: 3
        });

        this.executionProviderUsed = provider as 'webgpu' | 'wasm';
        console.log(`[VisionEngine] BlazeFace loaded successfully on [${provider.toUpperCase()}]`);
        this.isFaceModelLoading = false;
        return true;
      } catch (err: any) {
        console.warn(`[VisionEngine] BlazeFace provider "${provider}" unavailable (${err?.message || err})`);
      }
    }

    this.isFaceModelLoading = false;
    return false;
  }

  private async loadOcrDetModel(): Promise<boolean> {
    if (this.ocrDetSession) return true;
    if (this.isOcrModelLoading) return false;

    this.isOcrModelLoading = true;
    console.log('[VisionEngine] Loading DBNet text-detection ONNX from:', this.ocrDetModelUrl);

    const providers = this.getPreferredProviders();
    for (const provider of providers) {
      try {
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;

        this.ocrDetSession = await ort.InferenceSession.create(this.ocrDetModelUrl, {
          executionProviders: [provider],
          graphOptimizationLevel: 'all',
          logSeverityLevel: 3
        });

        console.log(`[VisionEngine] DBNet text detector loaded successfully on [${provider.toUpperCase()}]`);
        this.isOcrModelLoading = false;
        return true;
      } catch (err: any) {
        console.warn(`[VisionEngine] DBNet provider "${provider}" unavailable (${err?.message || err})`);
      }
    }

    this.isOcrModelLoading = false;
    return false;
  }

  private getPreferredProviders(): string[] {
    const providers: string[] = [];
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      providers.push('webgpu');
    }
    providers.push('wasm');
    return providers;
  }

  public getAccelerationStatus(): string {
    if (this.executionProviderUsed === 'webgpu') {
      return 'WebGPU Hardware Accelerated (Direct3D/Vulkan)';
    }
    if (this.executionProviderUsed === 'wasm') {
      return 'ONNX Runtime Web (WASM SIMD Engine)';
    }
    return 'Spatial Edge/Luminance Fallback';
  }

  // Scan all canvas elements for faces, text regions, and signatures
  public async scanCanvases(canvases: NodeListOf<HTMLCanvasElement> | HTMLCanvasElement[]): Promise<VisualBBox[]> {
    await this.loadModels();

    const detectedRegions: VisualBBox[] = [];

    for (let index = 0; index < canvases.length; index++) {
      const canvas = canvases[index];
      // Skip if this canvas is already redacted to prevent re-burning and visual clutter
      if (canvas.getAttribute('data-sentry-redacted') === 'true') continue;

      const width = canvas.width;
      const height = canvas.height;
      if (width < 16 || height < 16) continue;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      let imgData: ImageData;
      try {
        imgData = ctx.getImageData(0, 0, width, height);
      } catch (e) {
        detectedRegions.push({
          id: `canvas_${index}_tainted`,
          type: 'CANVAS_CREDENTIAL',
          x: 0,
          y: 0,
          width,
          height,
          confidence: 0.90,
          token: `<CANVAS_BUFFER_${index + 1}>`
        });
        continue;
      }

      const canvasId = (canvas.id || '').toLowerCase();
      const isAvatarCanvas = canvasId.includes('avatar') || canvasId.includes('face') || canvasId.includes('director');
      const isSignatureCanvas = canvasId.includes('sig') || canvas.closest('.dsc-box') !== null;

      let canvasFaceRedacted = false;

      // 1. Neural BlazeFace Facial Biometric Pass (Only on avatar/face canvases or skin-tone clusters)
      if (isAvatarCanvas || this.hasFaceCharacteristics(imgData)) {
        if (this.faceSession) {
          try {
            const faces = await this.inferBlazeFace(imgData, width, height, index);
            if (faces.length > 0) {
              canvasFaceRedacted = true;
              for (const face of faces) {
                detectedRegions.push(face);
                this.burnPixelRedaction(ctx, face.x, face.y, face.width, face.height, 'BIOMETRIC FACE REDACTED');
              }
            }
          } catch (infErr) {
            console.error('[VisionEngine] BlazeFace inference error:', infErr);
          }
        }

        // Biometric heuristic fallback if ONNX is offline or missed
        if (!canvasFaceRedacted) {
          const faceBox = this.localizeFaceRegion(imgData);
          canvasFaceRedacted = true;
          detectedRegions.push({
            id: `face_heuristic_${index}`,
            type: 'FACE',
            x: faceBox.x,
            y: faceBox.y,
            width: faceBox.w,
            height: faceBox.h,
            confidence: 0.88,
            token: `<REDACTED_AVATAR_${index + 1}>`
          });
          this.burnPixelRedaction(ctx, faceBox.x, faceBox.y, faceBox.w, faceBox.h, 'BIOMETRIC FACE MASKED');
        }
      }

      // 2. Neural DBNet Text Region Detection Pass (ocr-det.onnx)
      // Run on non-avatar canvases (satellite imagery, signature certificate text, forms)
      if (!isAvatarCanvas && this.ocrDetSession) {
        try {
          const textRegions = await this.inferDBNetText(imgData, width, height, index);
          if (textRegions.length > 0) {
            for (const tr of textRegions) {
              detectedRegions.push(tr);
              this.burnPixelRedaction(ctx, tr.x, tr.y, tr.width, tr.height, 'CANVAS TEXT REDACTED');
            }
          }
        } catch (ocrErr) {
          console.error('[VisionEngine] DBNet text detection error:', ocrErr);
        }
      }

      // 3. Handwritten Signature / Digital Signature Certificate (DSC) Pass
      // Target signature pads and DSC certificate areas
      if (isSignatureCanvas) {
        const strokeBox = this.detectStrokeBoundingBox(imgData);
        if (strokeBox) {
          detectedRegions.push({
            id: `sig_${index}`,
            type: 'SIGNATURE',
            x: strokeBox.x,
            y: strokeBox.y,
            width: strokeBox.w,
            height: strokeBox.h,
            confidence: 0.96,
            token: `<REDACTED_SIGNATURE_${index + 1}>`
          });
          this.burnPixelRedaction(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, 'DIGITAL SIGNATURE REDACTED');
        } else {
          // Dedicated signature canvas fallback: guarantee that drawn signature area is 100% hidden
          const sigFallback = { x: 10, y: 15, w: width - 20, h: Math.round(height * 0.70) };
          detectedRegions.push({
            id: `sig_fallback_${index}`,
            type: 'SIGNATURE',
            x: sigFallback.x,
            y: sigFallback.y,
            width: sigFallback.w,
            height: sigFallback.h,
            confidence: 0.95,
            token: `<REDACTED_SIGNATURE_${index + 1}>`
          });
          this.burnPixelRedaction(ctx, sigFallback.x, sigFallback.y, sigFallback.w, sigFallback.h, 'DIGITAL SIGNATURE REDACTED');
        }
      }
    }

    return detectedRegions;
  }

  // Real BlazeFace Inference with IoU Non-Maximum Suppression (NMS)
  private async inferBlazeFace(
    imgData: ImageData,
    srcWidth: number,
    srcHeight: number,
    canvasIdx: number
  ): Promise<VisualBBox[]> {
    if (!this.faceSession) return [];

    const offCanvas = new OffscreenCanvas(BLAZEFACE_INPUT_SIZE, BLAZEFACE_INPUT_SIZE);
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return [];

    const bmp = await createImageBitmap(imgData);
    offCtx.drawImage(bmp, 0, 0, BLAZEFACE_INPUT_SIZE, BLAZEFACE_INPUT_SIZE);
    bmp.close();

    const resizedPixels = offCtx.getImageData(0, 0, BLAZEFACE_INPUT_SIZE, BLAZEFACE_INPUT_SIZE).data;
    const plane = BLAZEFACE_INPUT_SIZE * BLAZEFACE_INPUT_SIZE;
    const tensorData = new Float32Array(3 * plane);

    for (let i = 0; i < plane; i++) {
      tensorData[i] = resizedPixels[i * 4] / 255.0; // R
      tensorData[plane + i] = resizedPixels[i * 4 + 1] / 255.0; // G
      tensorData[2 * plane + i] = resizedPixels[i * 4 + 2] / 255.0; // B
    }

    const inputName = this.faceSession.inputNames[0] || 'image';
    const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, BLAZEFACE_INPUT_SIZE, BLAZEFACE_INPUT_SIZE]);

    // Feed the control inputs by EXPLICIT name (verified against the model
    // graph: conf_threshold float, iou_threshold float, max_detections int64).
    // The old regex cascade mis-fed iou_threshold (it matched /threshold/
    // before /iou/) — explicit names remove that ambiguity.
    const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
    for (const name of this.faceSession.inputNames) {
      if (name === inputName) continue;
      if (name === 'conf_threshold' || /conf|score/i.test(name)) {
        feeds[name] = new ort.Tensor('float32', new Float32Array([DEFAULT_FACE_CONFIDENCE]), [1]);
      } else if (name === 'max_detections' || /max.*det/i.test(name)) {
        feeds[name] = new ort.Tensor('int64', new BigInt64Array([25n]), [1]);
      } else if (name === 'iou_threshold' || /iou/i.test(name)) {
        feeds[name] = new ort.Tensor('float32', new Float32Array([0.3]), [1]);
      } else if (/threshold/i.test(name)) {
        feeds[name] = new ort.Tensor('float32', new Float32Array([DEFAULT_FACE_CONFIDENCE]), [1]);
      }
    }

    const outputs = await this.faceSession.run(feeds);
    return this.parseBlazeFaceWithNMS(outputs, srcWidth, srcHeight, canvasIdx);
  }

  // Parse raw BlazeFace output tensor and apply true IoU Non-Maximum Suppression (NMS)
  //
  // VERIFIED MODEL LAYOUT (empirically confirmed with onnxruntime against
  // extension/public/models/blazeface.onnx — see tools/verify_onnx_models.py):
  //   * Single output `selectedBoxes`, dynamic shape [1, N, 16] where N is
  //     the number of detections AFTER the graph's internal threshold +
  //     NMS + max_detections (N can be 0).
  //   * Each row is 16 floats:
  //       row[0] = ymin   (normalized 0..1, may slightly exceed 1)
  //       row[1] = xmin   (normalized 0..1)
  //       row[2] = ymax
  //       row[3] = xmax
  //       row[4..15] = facial keypoint coordinates (6 x,y pairs)
  //     (column order verified by position-correlation across a face grid)
  //   * The per-box score is NOT exposed in the output; every returned row
  //     passed the graph-internal conf_threshold gate, so the reported
  //     confidence is that gate value (a documented lower bound).
  private parseBlazeFaceWithNMS(
    outputs: Record<string, ort.Tensor>,
    srcWidth: number,
    srcHeight: number,
    canvasIdx: number
  ): VisualBBox[] {
    const tensors = Object.values(outputs);
    if (tensors.length === 0) return [];

    const boxTensor = tensors.find(t => t.dims.length >= 2 && t.dims[t.dims.length - 1] >= 4);
    if (!boxTensor) return [];

    const rows = boxTensor.data as Float32Array;
    const stride = boxTensor.dims[boxTensor.dims.length - 1];
    const numDetections = Math.floor(rows.length / stride);

    interface RawBox {
      x: number;
      y: number;
      w: number;
      h: number;
      score: number;
    }

    const rawCandidates: RawBox[] = [];

    for (let i = 0; i < numDetections; i++) {
      const offset = i * stride;
      // Verified layout: [ymin, xmin, ymax, xmax, ...keypoints]
      const ymin = rows[offset];
      const xmin = rows[offset + 1];
      const ymax = rows[offset + 2];
      const xmax = rows[offset + 3];

      // Coordinates are normalized to the 128x128 model input; scale to
      // the canvas and clamp (boxes may overshoot the image edges).
      const scaleX = srcWidth / BLAZEFACE_INPUT_SIZE;
      const scaleY = srcHeight / BLAZEFACE_INPUT_SIZE;
      const x = Math.max(0, Math.min(xmin, xmax) * scaleX);
      const y = Math.max(0, Math.min(ymin, ymax) * scaleY);
      const w = Math.min(srcWidth - x, Math.abs(xmax - xmin) * scaleX);
      const h = Math.min(srcHeight - y, Math.abs(ymax - ymin) * scaleY);

      // Confidence: the model's internal conf_threshold gate (lower bound).
      const confidence = DEFAULT_FACE_CONFIDENCE;

      if (w > 8 && h > 8) {
        rawCandidates.push({ x, y, w, h, score: confidence });
      }
    }

    // Real Non-Maximum Suppression (NMS) using IoU overlap (shared module)
    const nmsResults = applyNMS(rawCandidates, NMS_IOU_THRESHOLD);

    return nmsResults.map((box, i) => ({
      id: `face_onnx_${canvasIdx}_${i}`,
      type: 'FACE',
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.w),
      height: Math.round(box.h),
      confidence: Math.round(box.score * 100) / 100,
      token: `<REDACTED_AVATAR_${canvasIdx + 1}>`
    }));
  }

  // Real DBNet (ocr-det.onnx) Text Region Detection Inference
  private async inferDBNetText(
    imgData: ImageData,
    srcWidth: number,
    srcHeight: number,
    canvasIdx: number
  ): Promise<VisualBBox[]> {
    if (!this.ocrDetSession) return [];

    // Scale canvas dimensions to nearest multiple of 32 for DBNet FPN
    const targetW = Math.max(32, Math.round(srcWidth / 32) * 32);
    const targetH = Math.max(32, Math.round(srcHeight / 32) * 32);

    const offCanvas = new OffscreenCanvas(targetW, targetH);
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return [];

    const bmp = await createImageBitmap(imgData);
    offCtx.drawImage(bmp, 0, 0, targetW, targetH);
    bmp.close();

    const pixels = offCtx.getImageData(0, 0, targetW, targetH).data;
    const plane = targetW * targetH;
    const tensorData = new Float32Array(3 * plane);

    // Standard ImageNet normalization for DBNet: mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let i = 0; i < plane; i++) {
      const r = pixels[i * 4] / 255.0;
      const g = pixels[i * 4 + 1] / 255.0;
      const b = pixels[i * 4 + 2] / 255.0;
      tensorData[i] = (r - mean[0]) / std[0];
      tensorData[plane + i] = (g - mean[1]) / std[1];
      tensorData[2 * plane + i] = (b - mean[2]) / std[2];
    }

    const inputName = this.ocrDetSession.inputNames[0] || 'x';
    const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, targetH, targetW]);

    const outputs = await this.ocrDetSession.run({ [inputName]: inputTensor });
    const outputName = this.ocrDetSession.outputNames[0] || 'sigmoid_0.tmp_0';
    const probMapTensor = outputs[outputName];
    if (!probMapTensor) return [];

    const probMap = probMapTensor.data as Float32Array;

    // Scan probability map for text clusters (threshold > 0.35)
    return this.extractTextRegionsFromProbMap(probMap, targetW, targetH, srcWidth, srcHeight, canvasIdx);
  }

  // Extract text bounding boxes from DBNet probability map via Connected-Component Labeling (CCL)
  private extractTextRegionsFromProbMap(
    probMap: Float32Array,
    mapW: number,
    mapH: number,
    srcW: number,
    srcH: number,
    canvasIdx: number
  ): VisualBBox[] {
    const textThreshold = 0.35;
    const minPixelCount = 8; // Filter out isolated noise spikes

    const scaleX = srcW / mapW;
    const scaleY = srcH / mapH;

    // 8-connectivity CCL segmentation (shared pure module)
    const clusters = extractTextClusters(probMap, mapW, mapH, {
      threshold: textThreshold,
      minPixelCount
    });

    // Scale back to source canvas coordinates with small 2px padding for tight redaction
    const pad = 2;
    const detectedTextRegions: VisualBBox[] = [];
    for (let componentIdx = 0; componentIdx < clusters.length; componentIdx++) {
      const c = clusters[componentIdx];
      const bx = Math.max(0, Math.round((c.x - pad) * scaleX));
      const by = Math.max(0, Math.round((c.y - pad) * scaleY));
      const bw = Math.min(srcW - bx, Math.round((c.w + 2 * pad) * scaleX));
      const bh = Math.min(srcH - by, Math.round((c.h + 2 * pad) * scaleY));

      if (bw >= 8 && bh >= 6) {
        detectedTextRegions.push({
          id: `dbnet_text_${canvasIdx}_${componentIdx}`,
          type: 'TEXT_REGION',
          x: bx,
          y: by,
          width: bw,
          height: bh,
          confidence: Math.round(c.avgScore * 100) / 100,
          token: `<CANVAS_TEXT_REGION_${canvasIdx + 1}_${componentIdx + 1}>`
        });
      }
    }

    return detectedTextRegions;
  }

  // Biometric skin-tone cluster heuristic (fallback)
  private hasFaceCharacteristics(data: ImageData): boolean {
    const pixels = data.data;
    let skinLikePixels = 0;
    const totalPixels = data.width * data.height;

    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r > 95 && g > 40 && b > 20 && (r - g) > 15 && r > b) {
        skinLikePixels++;
      }
    }
    return (skinLikePixels / (totalPixels / 4)) > 0.12;
  }

  private localizeFaceRegion(data: ImageData): { x: number; y: number; w: number; h: number } {
    const marginX = Math.round(data.width * 0.15);
    const marginY = Math.round(data.height * 0.10);
    return {
      x: marginX,
      y: marginY,
      w: data.width - (marginX * 2),
      h: data.height - (marginY * 2)
    };
  }

  public detectStrokeBoundingBox(data: ImageData): { x: number; y: number; w: number; h: number } | null {
    const pixels = data.data;
    const w = data.width;
    const h = data.height;

    // Background reference: average of 4 corner blocks (4x4 px each).
    // Replaces the old size-based exclusion (`canvasWidth > 300`), which
    // neither described nor fixed the intended behavior — dark-background
    // canvases narrower than 300px had their background counted as ink.
    const cornerAvg = (cx: number, cy: number) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const x = Math.min(w - 1, Math.max(0, cx + dx));
          const y = Math.min(h - 1, Math.max(0, cy + dy));
          const idx = (y * w + x) * 4;
          r += pixels[idx];
          g += pixels[idx + 1];
          b += pixels[idx + 2];
          n++;
        }
      }
      return { r: r / n, g: g / n, b: b / n };
    };
    const bg = [cornerAvg(0, 0), cornerAvg(w - 4, 0), cornerAvg(0, h - 4), cornerAvg(w - 4, h - 4)];
    // A pixel is "ink" when it is dark, opaque, AND clearly different from
    // the local background tone (handles white AND dark backgrounds alike).
    const INK_BG_DISTANCE = 60;

    let minX = w, maxX = 0, minY = h, maxY = 0;
    let strokeCount = 0;

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const idx = (y * w + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const a = pixels[idx + 3];

        const brightness = (r + g + b) / 3;
        const differsFromBg = bg.some(c => Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b) > INK_BG_DISTANCE);
        if (a > 50 && brightness < 120 && differsFromBg) {
          strokeCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Minimum 15 stroke samples to count as genuine pen strokes
    if (strokeCount >= 15 && maxX > minX && maxY > minY) {
      const pad = 10;
      const bx = Math.max(0, minX - pad);
      const by = Math.max(0, minY - pad);
      const bw = Math.min(w - bx, (maxX - minX) + pad * 2);
      const bh = Math.min(h - by, (maxY - minY) + pad * 2);
      return { x: bx, y: by, w: bw, h: bh };
    }

    return null;
  }

  // Pixel-level in-place redaction: burns solid cryptographic privacy block directly into canvas pixels
  public burnPixelRedaction(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string
  ): void {
    ctx.save();
    
    // Draw solid opaque blackout shield
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x, y, w, h);

    // Security hatch border
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Centered redaction label & watermark
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🔒 [${label}]`, x + w / 2, y + h / 2 - 8);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText('ZERO-EGRESS LOCAL REDACTION', x + w / 2, y + h / 2 + 10);

    ctx.restore();
  }
}

export const visionEngineInstance = new OnDeviceVisionEngine();
