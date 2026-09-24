// SentryAgent Popup Controller v2 (Phases 1-4)

interface VaultRow {
  token: string;
  maskedReal: string;
  type: string;
}

window.addEventListener('DOMContentLoaded', async () => {
  const btnScan = document.getElementById('btn-scan') as HTMLButtonElement;
  const btnRestore = document.getElementById('btn-restore') as HTMLButtonElement;
  const btnAutonomous = document.getElementById('btn-autonomous') as HTMLButtonElement;
  const btnMultiHop = document.getElementById('btn-multihop') as HTMLButtonElement;
  const metricRedacted = document.getElementById('metric-redacted') as HTMLElement;
  const metricVault = document.getElementById('metric-vault') as HTMLElement;
  const perimeterStatus = document.getElementById('perimeter-status') as HTMLElement;
  const visionStatus = document.getElementById('vision-status') as HTMLElement;
  const vaultBadge = document.getElementById('vault-count-badge') as HTMLElement;
  const vaultList = document.getElementById('vault-list') as HTMLElement;

  async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const current = tabs[0];
    if (current && !current.url?.startsWith('chrome-extension://') && !current.url?.startsWith('chrome://')) {
      return current;
    }
    // If popup is opened in its own window/tab, locate the web application tab
    const allTabs = await chrome.tabs.query({});
    const webTab = allTabs.find(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://') || t.url.startsWith('file://')));
    return webTab || current;
  }

  async function ensureContentScriptLoaded(tabId: number, url?: string): Promise<{ ok: boolean; reason?: string }> {
    if (url && (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('chrome-extension://'))) {
      return { ok: false, reason: 'Chrome security prevents running extensions on browser internal pages. Please navigate to http://localhost:3000.' };
    }

    // 1. First probe if content script is already listening
    const isAlive = await new Promise<boolean>((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_VAULT_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (isAlive) return { ok: true };

    // 2. If not responsive, try injecting content.js programmatically
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      // Small pause to allow listeners to bind
      await new Promise(r => setTimeout(r, 120));
      return { ok: true };
    } catch (err: any) {
      console.warn('[SentryAgent Popup] Script injection failed:', err);
      if (url?.startsWith('file://')) {
        return { 
          ok: false, 
          reason: 'Chrome blocks extensions on local file:// URLs by default.\n\nOption 1: Open the testbed via http://localhost:3000\nOption 2: Go to chrome://extensions -> SentryAgent Details -> turn ON "Allow access to file URLs", then refresh the tab.' 
        };
      }
      return { ok: false, reason: 'Could not connect to page. Please refresh the page tab (F5) and try again.' };
    }
  }

  async function refreshStatus() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    try {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_VAULT_STATUS' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          perimeterStatus.textContent = 'Ready to Protect';
          return;
        }

        if (response.acceleration && visionStatus) {
          visionStatus.textContent = response.acceleration;
        }

        updateUIState(response.isSanitized, response.entries || [], response.totalCount || 0);
      });
    } catch (e) {
      console.error('[SentryAgent Popup] Error connecting to tab:', e);
    }
  }

  function updateUIState(isSanitized: boolean, entries: VaultRow[], totalCount: number) {
    if (isSanitized) {
      perimeterStatus.textContent = 'PROTECTED (ZERO EGRESS)';
      perimeterStatus.className = 'status-val active';
      btnRestore.disabled = false;
      metricRedacted.textContent = String(totalCount);
      metricVault.textContent = String(totalCount);
      vaultBadge.textContent = `${totalCount} Active`;

      if (entries.length > 0) {
        vaultList.innerHTML = entries.map(entry => `
          <div class="vault-row">
            <span class="token-tag">${escapeHtml(entry.token)}</span>
            <span class="masked-tag">${escapeHtml(entry.maskedReal)}</span>
          </div>
        `).join('');
      } else {
        vaultList.innerHTML = '<div class="vault-empty">No sensitive values recorded.</div>';
      }
    } else {
      perimeterStatus.textContent = 'Standby';
      perimeterStatus.className = 'status-val';
      btnRestore.disabled = true;
      metricRedacted.textContent = '0';
      metricVault.textContent = '0';
      vaultBadge.textContent = '0 Active';
      vaultList.innerHTML = '<div class="vault-empty">Click "Run End-to-End Agent Loop" to activate protection and execute assisted task.</div>';
    }
  }

  // End-to-End Autonomous Agent Loop Trigger
  btnAutonomous?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    btnAutonomous.disabled = true;
    btnAutonomous.innerHTML = '<span>🤖 Reasoner Planning & Risk Gating...</span>';

    const check = await ensureContentScriptLoaded(tab.id, tab.url);
    if (!check.ok) {
      btnAutonomous.disabled = false;
      btnAutonomous.innerHTML = '<span class="btn-icon">🤖</span> Run End-to-End Agent Loop';
      alert(check.reason || 'Could not connect to active page.');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'RUN_AUTONOMOUS_STEP' }, (response) => {
      btnAutonomous.disabled = false;
      btnAutonomous.innerHTML = '<span class="btn-icon">🤖</span> Run End-to-End Agent Loop';

      if (chrome.runtime.lastError) {
        alert(`Communication error: ${chrome.runtime.lastError.message}\nPlease refresh the tab (F5).`);
        return;
      }

      if (response && response.success) {
        refreshStatus();
        window.close(); // Close popup so user sees the on-screen Risk Gate modal on the page!
      } else {
        alert(response?.message || 'Autonomous step encountered an issue. Check console.');
      }
    });
  });

  // Multi-Hop Autonomous Session (background service worker driven)
  btnMultiHop?.addEventListener('click', async () => {
    const goal = window.prompt('Multi-Hop Task Goal', 'Submit the official tender bid');
    if (!goal) return;

    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    btnMultiHop.disabled = true;
    chrome.runtime.sendMessage({ type: 'START_AUTONOMOUS_SESSION', userGoal: goal, tabId: tab.id }, (response) => {
      btnMultiHop.disabled = false;
      if (chrome.runtime.lastError) {
        alert(`Communication error: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (response?.success) {
        refreshStatus();
        alert(`Multi-hop session started: "${goal}"\n\nThe background runner will work step by step (surviving navigations). Every step still requires on-page confirmation at the Local Risk Gate for high-stakes actions. Use "Abort" via the service worker console, or restore/refresh the page to stop.`);
      } else {
        alert(response?.message || 'Could not start the multi-hop session.');
      }
    });
  });

  // Manual Scan
  btnScan?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    btnScan.disabled = true;
    btnScan.innerHTML = '<span>⏳ Scanning...</span>';

    const check = await ensureContentScriptLoaded(tab.id, tab.url);
    if (!check.ok) {
      btnScan.disabled = false;
      btnScan.innerHTML = '<span class="btn-icon">⚡</span> Scan & Sanitize';
      alert(check.reason || 'Could not connect to active page.');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'SCAN_AND_SANITIZE' }, (response) => {
      btnScan.disabled = false;
      btnScan.innerHTML = '<span class="btn-icon">⚡</span> Scan & Sanitize';

      if (chrome.runtime.lastError) {
        alert(`Communication error: ${chrome.runtime.lastError.message}\nPlease refresh the tab (F5).`);
        return;
      }

      if (response && response.success) {
        refreshStatus();
      } else {
        alert(response?.error || 'Could not sanitize active tab. Please refresh the page (F5).');
      }
    });
  });

  // Restore
  btnRestore?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_ORIGINAL_DOM' }, (response) => {
      if (response && response.success) {
        refreshStatus();
      }
    });
  });

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  refreshStatus();
});
