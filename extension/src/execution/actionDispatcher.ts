// Action Dispatcher & 4-Tier Local Risk Policy Gate (Phase 4)
// Enforces the "Reasoning != Authority" security rule.
// Downstream LLMs only propose actions; the local client authorizes, gates,
// validates, and executes them.
//
// v2.6 security hardening (the model is treated as an untrusted input):
//  1. The confirmation modal is built with DOM APIs (textContent) — model
//     strings are NEVER interpolated into innerHTML (XSS fix).
//  2. Local risk classification: the effective tier is the MAX of the
//     model-claimed tier and a locally computed tier derived from the
//     action type + target element semantics. A model cannot label a
//     statutory action TIER_1 to bypass confirmation.
//  3. TYPE guard: a model-supplied value may only be typed if it is a
//     registered vault token (rehydrated locally) or provably
//     non-sensitive. Raw sensitive values from the model are rejected.
//  4. NAVIGATE is implemented with strict local validation: only a
//     registered <a href> node, http/https only, no embedded credentials.
//  5. SCROLL is implemented; unknown action strings are rejected.

import type { PlannedAction, RiskTier } from '../types';
import { validatePlannedAction, maxTier, tierAtLeast } from './localPlanner';
import { classifySensitiveText, looksLikePersonName } from '../privacy/checksums';
import { vaultInstance } from '../privacy/vault';
import { cursorReticleInstance } from './cursorReticle';

// Local policy: labels that mark a target as statutory / irreversible.
const STATUTORY_HINTS =
  /\b(submit|submission|authorize|authorization|approve|bid|tender|delete|remove|pay|payment|purchase|checkout|transfer|withdraw|dispatch|sign|burn|confirm|send|execute|deploy)\b/i;
const SENSITIVE_FIELD_HINTS =
  /\b(aadhaar|pan|gstin|account|ifsc|card|password|transponder|budget|quote|bid|price|salary|pin|otp|secret|key|token)\b/i;

export class ActionDispatcher {
  // Map of opaque node ID -> Live DOM Element
  private idToElementMap: Map<string, HTMLElement> = new Map();

  public registerOpaqueNode(opaqueId: string, element: HTMLElement): void {
    this.idToElementMap.set(opaqueId, element);
  }

  public clearRegistry(): void {
    this.idToElementMap.clear();
  }

  // Local risk classification (authoritative floor under the model's claim)
  public classifyLocalRisk(action: PlannedAction, el: HTMLElement): RiskTier {
    const label = `${action.targetLabel || ''} ${el.id || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`;
    const tag = el.tagName;

    switch (action.action) {
      case 'NAVIGATE':
        return 'TIER_3';
      case 'TYPE':
        // Typing into a field with a sensitive context is a sensitive mutation
        return SENSITIVE_FIELD_HINTS.test(label) ? 'TIER_3' : 'TIER_2';
      case 'CLICK':
        if (tag === 'A') return 'TIER_3';
        if (STATUTORY_HINTS.test(label)) return 'TIER_4';
        return 'TIER_1';
      case 'FOCUS':
      case 'SCROLL':
      default:
        return 'TIER_1';
    }
  }

  // Execute a planned action through the local risk policy gate
  public async executeAction(action: PlannedAction): Promise<{ success: boolean; executed: boolean; message: string }> {
    // 1. Validate untrusted model output before touching the DOM
    const safe = validatePlannedAction(action);
    if (!safe) {
      return {
        success: false,
        executed: false,
        message: 'Action rejected: model output failed local validation (untrusted input).'
      };
    }

    const targetEl = this.idToElementMap.get(safe.targetOpaqueId);
    if (!targetEl) {
      return { success: false, executed: false, message: `Target opaque ID "${safe.targetOpaqueId}" not found in current DOM registry.` };
    }

    // 2. Effective risk tier = max(model claim, local classification)
    const localTier = this.classifyLocalRisk(safe, targetEl);
    const effectiveTier = maxTier(safe.riskTier, localTier);

    console.log(`[ActionDispatcher] Evaluating action "${safe.action}" on [${safe.targetOpaqueId}] (model tier ${safe.riskTier}, local tier ${localTier}, effective ${effectiveTier})`);

    // Animate Tactical Sentry HUD Reticle to target coordinates
    const rect = targetEl.getBoundingClientRect();
    const centerX = Math.round(rect.left + rect.width / 2);
    const centerY = Math.round(rect.top + rect.height / 2);
    await cursorReticleInstance.glideTo(centerX, centerY, safe.targetLabel || safe.targetOpaqueId, safe.action);

    // 3. Gating for TIER_4 (Irreversible / High-Stakes Statutory Actions)
    if (effectiveTier === 'TIER_4') {
      const authorized = await this.promptRiskConfirmationModal(safe, targetEl, effectiveTier, localTier);
      if (!authorized) {
        return { success: true, executed: false, message: 'Action aborted by user at Local Risk Gate.' };
      }
    }

    // 4. Dispatch by action type
    switch (safe.action) {
      case 'TYPE': {
        const guard = this.validateTypableValue(safe.payloadValue, targetEl);
        if (!guard.ok) {
          return { success: false, executed: false, message: guard.reason };
        }
        if ('value' in targetEl) {
          (targetEl as HTMLInputElement).value = guard.value;
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          targetEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      }
      case 'CLICK': {
        // Prior to clicking a submit button, ensure all fields are locally re-hydrated
        this.rehydrateTrackedValues(targetEl);
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.click();
        break;
      }
      case 'FOCUS': {
        targetEl.focus();
        break;
      }
      case 'SCROLL': {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
      case 'NAVIGATE': {
        const nav = this.validateNavigation(targetEl);
        if (!nav.ok) {
          return { success: false, executed: false, message: nav.reason };
        }
        targetEl.click(); // follow the page's own anchor
        break;
      }
      default:
        return { success: false, executed: false, message: `Action "${safe.action}" is not executable locally.` };
    }

    return {
      success: true,
      executed: true,
      message: `Action [${safe.action}] successfully dispatched on [${safe.targetOpaqueId}] (tier ${effectiveTier}).`
    };
  }

  // A model-supplied TYPE value may be used only if it is a vault token
  // (rehydrated locally) or provably non-sensitive. Sensitive values from
  // the model are rejected — raw PII must never travel reasoner -> DOM.
  private validateTypableValue(
    rawValue: string | undefined,
    el: HTMLElement
  ): { ok: true; value: string } | { ok: false; reason: string } {
    if (rawValue === undefined || rawValue === null) {
      return { ok: false, reason: 'TYPE action without a value is not executable.' };
    }
    const v = rawValue.trim();
    if (!v) return { ok: false, reason: 'TYPE action with empty value rejected.' };

    // (a) Vault token: rehydrate locally
    if (vaultInstance.isToken(v)) {
      return { ok: true, value: vaultInstance.rehydrate(v) };
    }

    // (b) Plain token embedded in larger text: rehydrate all known tokens
    const rehydrated = vaultInstance.rehydrate(v);
    const hasToken = rehydrated !== v;

    // (c) The (token-replaced) remainder must be provably non-sensitive.
    //     strict context: model output — even name-like text is rejected.
    const residual = hasToken ? rehydrated : v;
    if (classifySensitiveText(residual, { id: el.id || '', strict: true })) {
      return {
        ok: false,
        reason: 'Action rejected: model-supplied value looks sensitive. Only local vault tokens may carry sensitive values.'
      };
    }
    if (looksLikePersonName(residual)) {
      return { ok: false, reason: 'Action rejected: model-supplied value looks like a person name.' };
    }

    return { ok: true, value: rehydrated };
  }

  // NAVIGATE: the URL must come from the page's own anchor, be http(s),
  // and carry no embedded credentials. The model never supplies URLs.
  private validateNavigation(el: HTMLElement): { ok: true } | { ok: false; reason: string } {
    if (el.tagName !== 'A') {
      return { ok: false, reason: 'NAVIGATE rejected: target is not an anchor element.' };
    }
    const href = el.getAttribute('href');
    if (!href) return { ok: false, reason: 'NAVIGATE rejected: anchor has no href.' };
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return { ok: false, reason: 'NAVIGATE rejected: unparseable URL.' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, reason: `NAVIGATE rejected: disallowed protocol "${url.protocol}".` };
    }
    if (url.username || url.password) {
      return { ok: false, reason: 'NAVIGATE rejected: URL contains embedded credentials.' };
    }
    return { ok: true };
  }

  // Re-hydrate tracked vault tokens in any input that still shows its token
  // (covers TYPE targets and the fields a submit button would carry).
  private rehydrateTrackedValues(_submitEl: HTMLElement): void {
    // Tracked elements live in the content script module scope; the vault
    // rehydration here covers any element whose value is a known token.
    const inputs = document.querySelectorAll<HTMLElement>('input, textarea');
    inputs.forEach(el => {
      const val = (el as HTMLInputElement).value;
      if (val && vaultInstance.isToken(val.trim())) {
        (el as HTMLInputElement).value = vaultInstance.rehydrate(val.trim());
      }
    });
  }

  // Injects an on-screen confirmation modal for TIER_4 high-stakes actions.
  // Built exclusively with DOM APIs + textContent: model-derived strings are
  // untrusted input and are NEVER written into innerHTML.
  private promptRiskConfirmationModal(action: PlannedAction, element: HTMLElement, effectiveTier: RiskTier, localTier: RiskTier): Promise<boolean> {
    return new Promise((resolve) => {
      const existing = document.getElementById('sentry-risk-modal');
      if (existing) existing.remove();

      const modalOverlay = document.createElement('div');
      modalOverlay.id = 'sentry-risk-modal';
      modalOverlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      const modalBox = document.createElement('div');
      modalBox.style.cssText = `
        background: #1e293b;
        color: #f8fafc;
        border-radius: 12px;
        border: 2px solid #ef4444;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        width: 480px;
        max-width: 90vw;
        padding: 24px;
      `;

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';
      const warn = document.createElement('div');
      warn.style.cssText = 'font-size: 28px;';
      warn.textContent = '⚠️';
      const headerText = document.createElement('div');
      const tag = document.createElement('div');
      tag.style.cssText = 'color: #ef4444; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;';
      tag.textContent = 'SentryAgent • Local Risk Gate (Tier 4)';
      const title = document.createElement('div');
      title.style.cssText = 'font-size: 16px; font-weight: 700; color: #ffffff;';
      title.textContent = 'Authorization Required: High-Stakes Action';
      headerText.appendChild(tag);
      headerText.appendChild(title);
      header.appendChild(warn);
      header.appendChild(headerText);

      const details = document.createElement('div');
      details.style.cssText = 'background: rgba(0,0,0,0.3); border-radius: 8px; padding: 14px; margin-bottom: 18px; font-size: 13px; line-height: 1.5;';
      const mkRow = (labelText: string, valueText: string, mono = false) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom: 6px;';
        const strong = document.createElement('strong');
        strong.style.cssText = 'color: #94a3b8;';
        strong.textContent = labelText;
        const val = document.createElement('span');
        val.style.cssText = mono
          ? 'color: #f59e0b; font-weight: 600; font-family: monospace;'
          : 'color: #e2e8f0;';
        val.textContent = valueText; // untrusted string -> textContent only
        row.appendChild(strong);
        row.appendChild(document.createTextNode(' '));
        row.appendChild(val);
        return row;
      };
      details.appendChild(mkRow('Requested Action:', `${action.action} (model tier ${action.riskTier}, local tier ${localTier})`));
      details.appendChild(mkRow('Target Node:', action.targetOpaqueId, true));
      details.appendChild(mkRow('Target Description:', action.targetLabel || element.id || '—'));
      details.appendChild(mkRow('Agent Rationale:', action.reason || '—'));

      const notice = document.createElement('div');
      notice.style.cssText = 'font-size: 12px; color: #cbd5e1; margin-bottom: 20px; line-height: 1.4;';
      notice.textContent = '🔒 Zero-Egress Notice: The remote server recommended this step using an opaque identifier only. If authorized, SentryAgent will rehydrate real values locally on this device before submitting.';

      const buttons = document.createElement('div');
      buttons.style.cssText = 'display: flex; gap: 12px; justify-content: flex-end;';
      const abortBtn = document.createElement('button');
      abortBtn.id = 'sentry-btn-abort';
      abortBtn.style.cssText = 'background: #334155; color: #f8fafc; border: none; padding: 10px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;';
      abortBtn.textContent = '✕ Abort Action';
      const authBtn = document.createElement('button');
      authBtn.id = 'sentry-btn-authorize';
      authBtn.style.cssText = 'background: #ef4444; color: #ffffff; border: none; padding: 10px 20px; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);';
      authBtn.textContent = '✓ Authorize & Dispatch';
      buttons.appendChild(abortBtn);
      buttons.appendChild(authBtn);

      modalBox.appendChild(header);
      modalBox.appendChild(details);
      modalBox.appendChild(notice);
      modalBox.appendChild(buttons);
      modalOverlay.appendChild(modalBox);
      document.body.appendChild(modalOverlay);

      abortBtn.addEventListener('click', () => {
        modalOverlay.remove();
        resolve(false);
      });
      authBtn.addEventListener('click', () => {
        modalOverlay.remove();
        resolve(true);
      });
    });
  }
}

export const actionDispatcherInstance = new ActionDispatcher();
