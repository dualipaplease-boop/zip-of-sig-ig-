// SentryAgent Background Service Worker (Manifest V3)
// Autonomous Multi-Hop Task Runner & Cross-Page Session Manager
// Prevents Multi-Hop Amnesia by keeping state persistently across tab navigations.
//
// v2.6: when the remote reasoner is unreachable or rejects the sealed
// payload (digest mismatch / HTTP error), the loop falls back to the
// content script's local deterministic planner (zero egress) instead of
// stalling. All actions still pass through the content-script Local Risk
// Gate — the reasoner (remote OR local) never executes anything directly.

import { AgentSessionState, PlannedAction } from '../types';
import { validatePlannedAction } from '../execution/localPlanner';
import { REASONER_PLAN_URL } from '../config';

let currentSession: AgentSessionState | null = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SentryAgent] Background Service Worker installed successfully.');
});

// Restore previous session from storage if service worker wakes up
chrome.storage.local.get(['sentry_active_session'], (res) => {
  if (res.sentry_active_session) {
    currentSession = res.sentry_active_session;
    console.log('[SentryAgent] Restored active session:', currentSession);
  }
});

// Save session state helper
async function saveSession(session: AgentSessionState | null): Promise<void> {
  currentSession = session;
  if (session) {
    await chrome.storage.local.set({ sentry_active_session: session });
  } else {
    await chrome.storage.local.remove(['sentry_active_session']);
  }
}

// 1. Start Autonomous Multi-Hop Task
export async function startAutonomousTask(userGoal: string, tabId: number): Promise<{ success: boolean; message: string }> {
  currentSession = {
    taskId: 'task_' + Date.now(),
    userGoal,
    status: 'RUNNING',
    currentStep: 1,
    maxSteps: 8,
    checklist: [],
    actionHistory: [],
    lastUpdated: Date.now()
  };

  await saveSession(currentSession);
  console.log(`[SentryAgent Background] Started autonomous multi-hop task [${currentSession.taskId}]: "${userGoal}"`);

  // Execute Step 1
  runSessionStep(tabId);
  return { success: true, message: `Task started: "${userGoal}"` };
}

// Fetch a zero-egress local fallback plan from the content script.
async function fetchLocalFallbackPlan(tabId: number): Promise<PlannedAction[] | null> {
  try {
    const res: any = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_LOCAL_FALLBACK_PLAN',
      userGoal: currentSession?.userGoal
    });
    if (res && Array.isArray(res.actions)) {
      return res.actions.map(validatePlannedAction).filter((a: PlannedAction | null) => a !== null);
    }
  } catch (e) {
    console.warn('[SentryAgent Background] Local fallback plan unavailable:', (e as Error)?.message);
  }
  return null;
}

// 2. Execute Single Step in the Autonomous Loop
export async function runSessionStep(tabId: number): Promise<void> {
  if (!currentSession || currentSession.status !== 'RUNNING') return;

  if (currentSession.currentStep > currentSession.maxSteps) {
    console.log('[SentryAgent Background] Max steps limit reached. Marking session COMPLETED.');
    currentSession.status = 'COMPLETED';
    await saveSession(currentSession);
    return;
  }

  console.log(`[SentryAgent Background] Running Step ${currentSession.currentStep}/${currentSession.maxSteps}...`);

  try {
    // A. Ask Content Script to Scan and Seal Opaque Scene Graph
    // Sends 'AUTO' so content script dynamically escalates to L2 whenever canvas/visuals are present
    const extractRes: any = await chrome.tabs.sendMessage(tabId, {
      type: 'EXTRACT_AND_SEAL',
      disclosureLevel: 'AUTO' // Dynamic ladder gating: L1 for text-only DOM, L2 for canvas/signatures
    });

    if (!extractRes || !extractRes.wirePayload) {
      console.warn('[SentryAgent Background] Content script returned empty payload. Waiting for page settle...');
      return;
    }

    const { wirePayload } = extractRes;
    wirePayload.userGoal = currentSession.userGoal;
    wirePayload.history = currentSession.actionHistory;
    wirePayload.checklist = currentSession.checklist;

    // B. Send Sanitized Payload to Server LLM Reasoner (with local fallback)
    let planData: any = null;
    let usedLocalFallback = false;

    try {
      console.log('[SentryAgent Background] Sending SHA-256 sealed payload to', REASONER_PLAN_URL);
      const planResp = await fetch(REASONER_PLAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Digest': wirePayload.digestSha256
        },
        body: JSON.stringify(wirePayload)
      });

      if (!planResp.ok) {
        throw new Error(`Reasoner returned HTTP ${planResp.status}`);
      }
      planData = await planResp.json();
      console.log('[SentryAgent Background] Received Plan from Reasoner:', planData);
    } catch (netErr: any) {
      console.warn(`[SentryAgent Background] Remote reasoner unavailable (${netErr?.message}). Using local zero-egress fallback planner.`);
      usedLocalFallback = true;
      const localActions = await fetchLocalFallbackPlan(tabId);
      planData = localActions && localActions.length > 0
        ? { thought: 'Local heuristic plan (remote reasoner unavailable).', checklist: [], actions: localActions, isFinished: false }
        : { thought: 'Local fallback produced no actions.', checklist: [], actions: [], isFinished: true };
    }

    // Update Checklist from Reasoner (untrusted text — rendered safely by the popup)
    if (planData.checklist && Array.isArray(planData.checklist)) {
      currentSession.checklist = planData.checklist.map((c: any) => ({
        id: typeof c?.id === 'number' ? c.id : 0,
        description: typeof c?.description === 'string' ? c.description.substring(0, 200) : '',
        done: Boolean(c?.done)
      }));
    }

    // Validate every action before dispatch (untrusted model output).
    const rawActions: any[] = Array.isArray(planData.actions) ? planData.actions : [];
    const actions: PlannedAction[] = rawActions
      .map(validatePlannedAction)
      .filter((a: PlannedAction | null) => a !== null);

    if (actions.length === 0 || planData.isFinished) {
      console.log('[SentryAgent Background] Reasoner indicated task is finished, or no valid actions left.');
      currentSession.status = 'COMPLETED';
      await saveSession(currentSession);
      return;
    }

    // C. Dispatch Action to Tab (Local Risk Gate in content script applies)
    const actionToExecute = actions[0];
    console.log(`[SentryAgent Background] Dispatching Action: [${actionToExecute.action}] on [${actionToExecute.targetOpaqueId}]${usedLocalFallback ? ' (LOCAL FALLBACK)' : ''}`);

    const execRes: any = await chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_ACTION',
      action: actionToExecute
    });

    if (execRes && execRes.success === false) {
      // Local risk gate rejected the action (validation / navigation guard).
      console.warn('[SentryAgent Background] Action rejected by local risk gate:', execRes.message);
      currentSession.actionHistory.push({
        step: currentSession.currentStep,
        action: `${actionToExecute.action} (REJECTED)`,
        targetLabel: actionToExecute.targetLabel || actionToExecute.targetOpaqueId,
        riskTier: actionToExecute.riskTier,
        reason: execRes.message
      });
    } else {
      // Record Action in History
      currentSession.actionHistory.push({
        step: currentSession.currentStep,
        action: actionToExecute.action,
        targetLabel: actionToExecute.targetLabel || actionToExecute.targetOpaqueId,
        riskTier: actionToExecute.riskTier,
        reason: actionToExecute.reason
      });
    }

    currentSession.currentStep++;
    currentSession.lastUpdated = Date.now();
    await saveSession(currentSession);

    if (execRes && execRes.causedNavigation) {
      console.log('[SentryAgent Background] Action triggered page navigation. Waiting for tab onUpdated event...');
      // Navigation handler will automatically continue the loop
    } else {
      // Pause slightly and continue next step on same page
      setTimeout(() => {
        runSessionStep(tabId);
      }, 1000);
    }
  } catch (err: any) {
    console.error('[SentryAgent Background] Step execution error:', err?.message || err);
    // A hard error (e.g. tab closed) ends the session instead of spinning.
    if (currentSession) {
      currentSession.status = 'FAILED';
      await saveSession(currentSession);
    }
  }
}

// 3. Tab Navigation Listener: Handles Page Transitions & Multi-Hop Autonomy
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    if (currentSession && currentSession.status === 'RUNNING') {
      console.log(`[SentryAgent Background] Tab ${tabId} reloaded / navigated to ${tab.url}. Resuming multi-hop autonomous loop!`);
      setTimeout(() => {
        runSessionStep(tabId);
      }, 1200); // Allow DOM and scripts to hydrate
    }
  }
});

// 4. Message Dispatcher for Extension UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_AUTONOMOUS_SESSION') {
    const goal = typeof message.userGoal === 'string' ? message.userGoal : 'Perform autonomous procurement submission';
    const targetTabId = message.tabId || sender.tab?.id;
    if (targetTabId) {
      startAutonomousTask(goal, targetTabId).then(sendResponse);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          startAutonomousTask(goal, tabs[0].id).then(sendResponse);
        } else {
          sendResponse({ success: false, message: 'No active tab found.' });
        }
      });
    }
    return true;
  }

  if (message.type === 'GET_SESSION_STATE') {
    sendResponse({ session: currentSession });
    return true;
  }

  if (message.type === 'ABORT_SESSION') {
    if (currentSession) {
      currentSession.status = 'FAILED';
      saveSession(null);
    }
    sendResponse({ success: true, message: 'Autonomous task aborted by user.' });
    return true;
  }
});
