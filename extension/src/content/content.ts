import { classifySensitiveText, ClassificationContext } from '../privacy/checksums';
import { vaultInstance } from '../privacy/vault';
import { visionEngineInstance } from '../vision/visionEngine';
import { egressVerifierInstance, sanitizeLabel, OpaqueSceneNode } from '../network/egressVerifier';
import { determineDisclosureLevel, allowsRemoteEgress } from '../privacy/disclosure';
import { localHeuristicPlan, validatePlannedAction } from '../execution/localPlanner';
import { actionDispatcherInstance } from '../execution/actionDispatcher';
import { cursorReticleInstance } from '../execution/cursorReticle';
import { PIIType, SanitizationReport, PlannedAction } from '../types';
import { REASONER_PLAN_URL } from '../config';

interface TrackedElement {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement;
  originalValue: string;
  token: string;
  type: PIIType;
}

interface TrackedCanvas {
  canvas: HTMLCanvasElement;
  originalImageData: ImageData;
  regions: any[];
}

const trackedElements: Map<string, TrackedElement> = new Map();
const trackedCanvases: Map<HTMLCanvasElement, TrackedCanvas> = new Map();
let isCurrentlySanitized = false;

// Default goal used by the single-step loop when the user did not specify
// one (matches the server's default). Overridable via message payload.
const DEFAULT_STEP_GOAL = 'Submit official commercial bid';

// Build a classification context from an element's identity hints so the
// person-name detector only fires on identity-context fields.
function fieldContext(el: HTMLElement): ClassificationContext {
  const ctx: ClassificationContext = {
    id: el.id || undefined,
    placeholder: (el as HTMLInputElement).placeholder || undefined
  };
  try {
    const labelEl = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (labelEl) ctx.label = (labelEl.textContent || '').trim();
  } catch {
    // CSS.escape unavailable or selector error — context without label is fine
  }
  return ctx;
}

// 1. Scan and Sanitize the Webpage (Phase 1 DOM + Phase 2 On-Device Vision)
// Gated by Minimum-Disclosure Ladder: dynamically escalates to L2 on-device
// vision when canvases exist; L0 keeps everything local.
export async function scanAndSanitizePage(
  disclosureLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'AUTO' = 'AUTO'
): Promise<SanitizationReport> {
  const startTime = performance.now();
  let newRedactedCount = 0;
  const entitiesByType: Record<string, number> = {};
  const tokens: string[] = [];

  actionDispatcherInstance.clearRegistry();

  // A. Scan Form Inputs & Textareas (Track 1)
  const inputElements = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea'
  );

  inputElements.forEach((input, idx) => {
    const rawVal = input.value;
    if (!rawVal || rawVal.trim().length === 0) return;

    // If this field is already tokenized, skip it
    if (vaultInstance.isToken(rawVal)) return;

    const match = classifySensitiveText(rawVal, fieldContext(input));
    if (match) {
      const selector = input.id ? `#${input.id}` : `input[data-sentry-idx="${idx}"]`;
      input.setAttribute('data-sentry-idx', String(idx));

      const token = vaultInstance.tokenize(rawVal, match.type, selector);

      trackedElements.set(selector, {
        element: input,
        originalValue: rawVal,
        token,
        type: match.type
      });

      // The "One Operation, Three Channels" mechanism:
      // Mutating DOM at data-source level updates DOM, Accessibility Tree, and Screenshots simultaneously
      input.value = token;
      input.classList.add('sentry-redacted-field');

      newRedactedCount++;
      entitiesByType[match.type] = (entitiesByType[match.type] || 0) + 1;
      tokens.push(token);
    }
  });

  // B. Run On-Device Vision Engine (Track 2: Gated by Minimum-Disclosure Ladder)
  let visualRegions: any[] = [];
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
  const activeLevel = determineDisclosureLevel(canvases.length, disclosureLevel);

  // Filter to unredacted canvases ONLY to prevent double-burning, nested boxes, and visual clutter
  const unredactedCanvases: HTMLCanvasElement[] = [];
  canvases.forEach((canvas) => {
    if (!trackedCanvases.has(canvas) && canvas.getAttribute('data-sentry-redacted') !== 'true') {
      unredactedCanvases.push(canvas);
    }
  });

  if (unredactedCanvases.length > 0 && activeLevel === 'L2') {
    console.log(`[SentryAgent] Minimum-Disclosure Ladder escalated to ${activeLevel} (${unredactedCanvases.length} unredacted canvas(es) detected). Running BlazeFace & DBNet neural vision...`);

    // Backup pristine image data BEFORE burning any pixel redactions
    for (const canvas of unredactedCanvases) {
      try {
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          trackedCanvases.set(canvas, { canvas, originalImageData, regions: [] });
        }
      } catch (backupErr) {
        console.warn('[SentryAgent] Canvas snapshot failed (tainted canvas):', backupErr);
      }
    }

    visualRegions = await visionEngineInstance.scanCanvases(unredactedCanvases);

    visualRegions.forEach((reg) => {
      const piiType: PIIType = reg.type === 'FACE'
        ? 'AVATAR_FACE'
        : (reg.type === 'TEXT_REGION' ? 'CANVAS_TEXT' : 'CANVAS_SIGNATURE');
      vaultInstance.tokenize(`[VISUAL_BUFFER_${reg.id}]`, piiType);
      newRedactedCount++;
      entitiesByType[reg.type] = (entitiesByType[reg.type] || 0) + 1;
      tokens.push(reg.token);
    });

    // Mark these canvases as redacted so repeated scans never re-burn them
    unredactedCanvases.forEach((canvas) => {
      canvas.setAttribute('data-sentry-redacted', 'true');
      canvas.classList.add('sentry-redacted-canvas');
    });

    // Update visual target badges and counter on host page for unmistakable visual verification
    document.querySelectorAll('.badge-warning').forEach((badge) => {
      const text = badge.textContent || '';
      if (text.includes('Visual') || text.includes('Target') || text.includes('DBNet') || text.includes('BlazeFace')) {
        badge.setAttribute('data-sentry-orig-badge', text);
        badge.classList.remove('badge-warning');
        badge.classList.add('badge-success', 'sentry-redacted-badge');
        badge.textContent = '🔒 Visual Artifact: REDACTED (ZERO-EGRESS)';
      }
    });

    const visualCountEl = document.getElementById('visual-target-count');
    if (visualCountEl) {
      if (!visualCountEl.hasAttribute('data-sentry-orig-count')) {
        visualCountEl.setAttribute('data-sentry-orig-count', visualCountEl.textContent || '1');
      }
      // Static string (no user/model input) — innerHTML is safe here.
      visualCountEl.innerHTML = `0 <span style="font-size: 11px; color: #10b981; font-weight: normal;">(PROTECTED)</span>`;
    }
  } else if (canvases.length > 0 && activeLevel === 'L1') {
    console.log(`[SentryAgent] Minimum-Disclosure Notice: ${canvases.length} canvas(es) present but disclosure level constrained to ${activeLevel}. Vision pipeline skipped.`);
  } else if (canvases.length > 0 && activeLevel === 'L0') {
    console.log(`[SentryAgent] Disclosure level L0 (pure local): on-device vision skipped; no network egress will occur.`);
  }

  isCurrentlySanitized = true;
  injectSentryStyles();

  // Aggregate consistent report across all currently protected elements
  const allVaultEntries = vaultInstance.getInspectionEntries();
  const allTokens = allVaultEntries.map(e => e.token);
  const totalCount = vaultInstance.size();

  const report: SanitizationReport = {
    url: window.location.href,
    timestamp: Date.now(),
    redactedCount: totalCount,
    entitiesByType: vaultInstance.getCountsByType(),
    tokens: allTokens,
    durationMs: Math.round(performance.now() - startTime),
    visualDetectionsCount: visualRegions.length,
    activeDisclosureLevel: activeLevel
  };

  console.log('[SentryAgent] Dual-Track Sanitization completed in', report.durationMs, 'ms. Total protected entities:', totalCount);
  return report;
}

// 2. Build Zero-PII Opaque Scene Graph for Server Egress
export function buildOpaqueSceneGraph(): OpaqueSceneNode[] {
  const nodes: OpaqueSceneNode[] = [];
  let anonCounter = 1;
  let dupCounter = 0;
  const usedOpaqueIds = new Set<string>();

  // Collect interactive elements and inputs
  const elements = document.querySelectorAll<HTMLElement>(
    'input, button, select, textarea, canvas, a[href]'
  );

  const tokenFn = (value: string, type: PIIType) => vaultInstance.tokenize(value, type);

  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const role = el.tagName.toLowerCase();
    let sanitizedLabel = '';
    let tokenType: PIIType | undefined;

    if ('value' in el) {
      const val = (el as HTMLInputElement).value;
      if (vaultInstance.isToken(val)) {
        sanitizedLabel = val; // e.g. <AADHAAR_ID_1>
      } else {
        // Placeholder (or a neutral fallback) — never the raw value — and
        // still run the label sanitizer so no embedded PII can egress.
        sanitizedLabel = sanitizeLabel((el as HTMLInputElement).placeholder || 'input_field', tokenFn);
      }
    } else {
      // Visible element text (button/anchor labels). Sanitize sensitive
      // substrings (e.g. "Submit for 98451 23456") into vault tokens.
      const rawLabel = (el.textContent || '').trim().substring(0, 40) || role;
      sanitizedLabel = sanitizeLabel(rawLabel, tokenFn);
    }

    // Opaque IDs must be unique: page ids may collide with the anonymous
    // counter (e.g. an element with id="3" and a later anonymous node_3).
    let opaqueId = el.id ? `node_${el.id}` : `node_${anonCounter++}`;
    if (usedOpaqueIds.has(opaqueId)) {
      opaqueId = `${opaqueId}_d${++dupCounter}`;
    }
    usedOpaqueIds.add(opaqueId);

    actionDispatcherInstance.registerOpaqueNode(opaqueId, el);

    nodes.push({
      opaqueId,
      role: role.toUpperCase(),
      sanitizedLabel,
      tokenType,
      interactive: true,
      boundingBox: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    });
  });

  return nodes;
}

// 3. Autonomous Assisted Task Loop (Phases 3 & 4)
export async function runAutonomousStep(userGoal?: string): Promise<{ success: boolean; message: string; report?: any }> {
  const goal = userGoal || DEFAULT_STEP_GOAL;

  // Step A: Sanitize page using dynamic Minimum-Disclosure Ladder
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
  const activeLevel = determineDisclosureLevel(canvases.length, 'AUTO');
  const scanReport = await scanAndSanitizePage(activeLevel);

  // Step B: Build Opaque Scene Graph
  const sceneNodes = buildOpaqueSceneGraph();

  let plannedActions: PlannedAction[] = [];

  if (allowsRemoteEgress(activeLevel)) {
    // Step C: Fail-Closed Egress Verification (SHA-256 sealed) with active disclosure level
    const knownRealValues: string[] = Array.from(trackedElements.values()).map(t => t.originalValue);
    const sealResult = await egressVerifierInstance.verifyAndSealPayload(
      sceneNodes,
      knownRealValues,
      activeLevel,
      scanReport.visualDetectionsCount
    );

    if (!sealResult.success || !sealResult.payload) {
      return { success: false, message: sealResult.error || 'Egress verification failed.' };
    }

    // Step D: Send Sanitized Wire Payload to Remote Reasoner
    try {
      const resp = await fetch(REASONER_PLAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Digest': sealResult.payload.digestSha256
        },
        body: JSON.stringify(sealResult.payload)
      });

      if (!resp.ok) {
        throw new Error(`Server returned HTTP ${resp.status}`);
      }
      const data = await resp.json();
      // Treat EVERY model output as untrusted: validate each action structurally.
      const rawActions: any[] = Array.isArray(data.actions) ? data.actions : [];
      plannedActions = rawActions
        .map(validatePlannedAction)
        .filter((a): a is PlannedAction => a !== null);
      console.log('[SentryAgent] Received action plan from remote reasoner (validated):', plannedActions);
    } catch (netErr) {
      console.warn('[SentryAgent] Remote reasoner offline/rejected; running local deterministic planner (zero-egress fallback).');
      plannedActions = localHeuristicPlan(goal, sceneNodes);
    }
  } else {
    // L0: pure local execution — zero bytes leave the device.
    console.log('[SentryAgent] Disclosure level L0: planning entirely on-device (no network).');
    plannedActions = localHeuristicPlan(goal, sceneNodes);
  }

  // Step E: Dispatch action through Local Risk Policy Gate
  if (plannedActions.length > 0) {
    const action = plannedActions[0];
    const execResult = await actionDispatcherInstance.executeAction(action);
    return {
      success: execResult.success,
      message: execResult.message,
      report: { scanReport, action, executed: execResult.executed }
    };
  }

  return { success: true, message: 'Scan complete. No action required.', report: { scanReport } };
}

// 4. Restore original DOM values & Canvas Pixels (Rollback)
export function restoreOriginalDOM(): void {
  // A. Rollback DOM Form Input Elements
  for (const [, item] of trackedElements.entries()) {
    if ('value' in item.element) {
      (item.element as HTMLInputElement).value = item.originalValue;
    }
    item.element.classList.remove('sentry-redacted-field');
    item.element.removeAttribute('data-sentry-idx');
  }

  // B. Rollback Canvas Pixel Redactions to pristine unredacted state
  for (const [canvas, info] of trackedCanvases.entries()) {
    try {
      const ctx = canvas.getContext('2d');
      if (ctx && info.originalImageData) {
        ctx.putImageData(info.originalImageData, 0, 0);
      }
    } catch (err) {
      console.warn('[SentryAgent] Could not restore canvas pixels:', err);
    }
    canvas.removeAttribute('data-sentry-redacted');
    canvas.classList.remove('sentry-redacted-canvas');
  }

  // C. Clear any Tactical Sentry HUD reticle or modal overlays
  cursorReticleInstance.hide();
  const riskModal = document.getElementById('sentry-risk-modal');
  if (riskModal) riskModal.remove();

  // D. Restore host page visual target badges and counter
  document.querySelectorAll('.sentry-redacted-badge').forEach((badge) => {
    const orig = badge.getAttribute('data-sentry-orig-badge');
    if (orig) {
      badge.textContent = orig;
      badge.removeAttribute('data-sentry-orig-badge');
    }
    badge.classList.remove('badge-success', 'sentry-redacted-badge');
    badge.classList.add('badge-warning');
  });

  const visualCountEl = document.getElementById('visual-target-count');
  if (visualCountEl) {
    const orig = visualCountEl.getAttribute('data-sentry-orig-count');
    if (orig) {
      visualCountEl.textContent = orig;
      visualCountEl.removeAttribute('data-sentry-orig-count');
    }
  }

  isCurrentlySanitized = false;
  vaultInstance.reset();
  trackedElements.clear();
  trackedCanvases.clear();
  console.log('[SentryAgent] Rolled back DOM and Canvases to pristine unredacted state.');
}

// 5. Intercept form submissions to ensure safe local re-hydration
document.addEventListener('submit', () => {
  if (!isCurrentlySanitized) return;
  console.log('[SentryAgent] Intercepted form submit: Re-hydrating sensitive values locally from vault...');
  for (const item of trackedElements.values()) {
    if ('value' in item.element) {
      const input = item.element as HTMLInputElement;
      if (input.value === item.token) {
        input.value = item.originalValue;
      } else if (vaultInstance.isToken(input.value.trim())) {
        input.value = vaultInstance.rehydrate(input.value.trim());
      }
    }
  }
}, true);

function injectSentryStyles() {
  if (document.getElementById('sentry-agent-styles')) return;

  const style = document.createElement('style');
  style.id = 'sentry-agent-styles';
  style.textContent = `
    .sentry-redacted-field {
      background-color: #ecfdf5 !important;
      color: #065f46 !important;
      border: 1.5px solid #10b981 !important;
      font-family: 'JetBrains Mono', monospace !important;
      font-weight: 600 !important;
      letter-spacing: -0.2px !important;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15) !important;
    }
    .sentry-redacted-canvas {
      outline: 2.5px solid #10b981 !important;
      outline-offset: 3px !important;
      border-radius: 4px !important;
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.35) !important;
      transition: all 0.3s ease !important;
    }
  `;
  document.head.appendChild(style);
}

// Message Listener from Extension Popup / Background Worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCAN_AND_SANITIZE') {
    const requestedLevel = message.disclosureLevel || 'AUTO';
    scanAndSanitizePage(requestedLevel)
      .then((report) => {
        sendResponse({ success: true, report });
      })
      .catch((err) => {
        console.error('[SentryAgent] SCAN_AND_SANITIZE error:', err);
        sendResponse({ success: false, error: err?.message || String(err) });
      });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'RESTORE_ORIGINAL_DOM') {
    restoreOriginalDOM();
    sendResponse({ success: true, isSanitized: false });
    return true;
  }

  if (message.type === 'GET_VAULT_STATUS') {
    sendResponse({
      isSanitized: isCurrentlySanitized,
      entries: vaultInstance.getInspectionEntries(),
      totalCount: vaultInstance.size(),
      acceleration: visionEngineInstance.getAccelerationStatus()
    });
    return true;
  }

  if (message.type === 'RUN_AUTONOMOUS_STEP') {
    runAutonomousStep(message.userGoal)
      .then((res) => {
        sendResponse(res);
      })
      .catch((err) => {
        console.error('[SentryAgent] RUN_AUTONOMOUS_STEP error:', err);
        sendResponse({ success: false, message: err?.message || String(err) });
      });
    return true; // Keep message channel open for async response
  }

  // Multi-Hop Service Worker Orchestration Messages
  if (message.type === 'EXTRACT_AND_SEAL') {
    (async () => {
      const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
      const requestedLevel = message.disclosureLevel || 'AUTO';
      const activeLevel = determineDisclosureLevel(canvases.length, requestedLevel);

      const scanReport = await scanAndSanitizePage(activeLevel);
      const sceneNodes = buildOpaqueSceneGraph();
      const knownRealValues: string[] = Array.from(trackedElements.values()).map(t => t.originalValue);
      const sealResult = await egressVerifierInstance.verifyAndSealPayload(
        sceneNodes,
        knownRealValues,
        activeLevel,
        scanReport.visualDetectionsCount
      );
      sendResponse({
        success: sealResult.success,
        wirePayload: sealResult.payload,
        scanReport,
        error: sealResult.error
      });
    })();
    return true;
  }

  // Local zero-egress fallback plan (used by the background worker when the
  // remote reasoner is unreachable, or for L0 sessions).
  if (message.type === 'GET_LOCAL_FALLBACK_PLAN') {
    const sceneNodes = buildOpaqueSceneGraph();
    const actions = localHeuristicPlan(message.userGoal || DEFAULT_STEP_GOAL, sceneNodes);
    sendResponse({ success: true, actions });
    return true;
  }

  if (message.type === 'EXECUTE_ACTION') {
    (async () => {
      const execResult = await actionDispatcherInstance.executeAction(message.action);
      sendResponse({
        success: execResult.success,
        executed: execResult.executed,
        message: execResult.message,
        causedNavigation: message.action.action === 'NAVIGATE' ||
          (message.action.action === 'CLICK' && (message.action.targetLabel?.toLowerCase().includes('submit') || message.action.targetLabel?.toLowerCase().includes('bid')))
      });
    })();
    return true;
  }
});

console.log('[SentryAgent] Content Script v3 (Dual-Track + Risk Gate + Local Policy) loaded on', window.location.href);
