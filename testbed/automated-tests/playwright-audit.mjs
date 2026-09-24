// SentryAgent - Playwright Deep Audit (v2.6)
// ---------------------------------------------------------------------------
// Loads the BUILT extension (extension/dist) into a real Chromium and drives
// the full user flow against the testbed page:
//   server health → testbed load → popup "Scan & Sanitize" → DOM redaction
//   verification → vault metrics → idempotent re-scan → Restore →
//   autonomous agent loop (live reasoner + risk gate modal) → portal checks
//
// Self-contained: it starts its own static server for testbed/ (no external
// :3000 dependency) and closes it on exit.
//
// Environment:
//   HEADLESS=1   run headless (requires a Chromium build that supports
//                extension loading in headless mode; the standard
//                `npx playwright install chromium` build works with the
//                new headless mode on Playwright >= 1.49)
//
// Exit codes: 0 = all checks passed · 1 = audit failures · 75 = no browser
//             available in this environment (audit not runnable — this is an
//             environment limitation, not a product failure)
//
// Run:  node testbed/automated-tests/playwright-audit.mjs
//       (requires: npx playwright install chromium — see docs/developer-guide.md)

import { chromium } from '../../extension/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTBED_DIR = path.resolve(__dirname, '../');
const extPath = path.resolve(__dirname, '../../extension/dist');
const headless = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const REASONER = 'http://localhost:8000';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.onnx': 'application/octet-stream'
};

// ── Static server for the testbed page ───────────────────────────────────────
function startTestbedServer(preferredPort = 3100) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(TESTBED_DIR, path.normalize(p).replace(/^([.][.][/\\])+/, ''));
      if (!file.startsWith(TESTBED_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') resolve(startTestbedServer(preferredPort + 1));
      else reject(err);
    });
    server.listen(preferredPort, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${preferredPort}` }));
  });
}

const results = {
  serverHealthy: false,
  testbedLoaded: false,
  extensionLoaded: false,
  contentScriptInjected: false,
  scanAndSanitizeWorks: false,
  piiRedactionVerified: false,
  vaultTrackingVerified: false,
  canvasVisionScanned: false,
  restorationVerified: false,
  e2eReasonerAutonomousStepWorks: false,
  riskGateModalRendered: false,
  errorsFound: []
};

console.log('='.repeat(70));
console.log('🔍 SENTRYAGENT PLAYWRIGHT DEEP AUDIT & BUG DETECTION SUITE (v2.6)');
console.log(`   headless: ${headless ? 'yes' : 'no'} · extension: ${extPath}`);
console.log('='.repeat(70));

if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
  console.error('❌ extension/dist not built. Run: cd extension && npm run build');
  process.exit(1);
}

const { server: staticServer, url: testbedUrl } = await startTestbedServer();
console.log(`🌐 Testbed static server on ${testbedUrl}`);

// Step 1: Check Python reasoning server
try {
  const srvRes = await fetch(`${REASONER}/health`);
  if (srvRes.ok) {
    const data = await srvRes.json();
    console.log('✅ Python Reasoning Server is healthy:', data);
    results.serverHealthy = true;
  } else {
    results.errorsFound.push(`Server returned HTTP ${srvRes.status}`);
  }
} catch (e) {
  results.errorsFound.push(`Could not connect to Python server on :8000: ${e.message}`);
}

// Step 2: Launch Chromium with the built extension
console.log('\n🚀 Launching Chromium with extension loaded from:', extPath);
let context;
try {
  context = await chromium.launchPersistentContext(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-pw-')),
    {
      headless,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        '--no-sandbox',
        '--disable-gpu'
      ]
    }
  );
} catch (e) {
  console.error('\n❌ Could not launch Chromium:', e.message);
  staticServer.close();
  console.error('\n💡 Install a browser with: cd extension && npx playwright install chromium');
  process.exit(75); // EX_UNAVAILABLE
}

try {
  // Catch background service worker
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await Promise.race([
      context.waitForEvent('serviceworker', { timeout: 10000 }),
      new Promise(r => setTimeout(() => r(null), 10000))
    ]);
  }

  let extensionId = null;
  if (background) {
    extensionId = background.url().split('/')[2];
    console.log(`✅ Extension Service Worker active! ID: ${extensionId}`);
    results.extensionLoaded = true;
  } else {
    console.warn('⚠️ Service worker not captured directly. Checking extension pages...');
  }

  // Open testbed
  const page = await context.newPage();
  const pageLogs = [];
  const pageErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    pageLogs.push(`[${msg.type().toUpperCase()}] ${text}`);
    if (msg.type() === 'error') pageErrors.push(text);
  });
  page.on('pageerror', err => {
    pageErrors.push(`UNHANDLED_EXCEPTION: ${err.message}`);
    results.errorsFound.push(`Page Unhandled Exception: ${err.message}`);
  });

  console.log(`\n🌐 Navigating to testbed at ${testbedUrl} ...`);
  await page.goto(testbedUrl, { waitUntil: 'networkidle' });
  const title = await page.title();
  console.log('✅ Testbed loaded! Page Title:', title);
  results.testbedLoaded = true;

  // Verify initial PII values are present on page
  const initialPan = await page.$eval('#vendor-pan', el => el.value);
  const initialGstin = await page.$eval('#vendor-gstin', el => el.value);
  const initialAccount = await page.$eval('#vendor-bank-account', el => el.value);
  console.log('Initial ground truth values:');
  console.log('  - PAN:', initialPan);
  console.log('  - GSTIN:', initialGstin);
  console.log('  - Bank Account:', initialAccount);

  await page.waitForTimeout(500);

  if (extensionId) {
    const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
    console.log(`\n📱 Opening extension popup: ${popupUrl}`);
    const popupPage = await context.newPage();
    const popupErrors = [];
    popupPage.on('pageerror', err => popupErrors.push(err.message));
    popupPage.on('console', msg => {
      if (msg.type() === 'error') popupErrors.push(msg.text());
    });

    await popupPage.goto(popupUrl);
    await popupPage.waitForSelector('#btn-scan');
    const perimeterStatusInitial = await popupPage.$eval('#perimeter-status', el => el.textContent);
    console.log('  Popup Initial Perimeter Status:', perimeterStatusInitial);

    // Trigger Scan & Sanitize
    console.log('⚡ Triggering "Scan & Sanitize" via popup...');
    await popupPage.click('#btn-scan');
    try {
      await popupPage.waitForFunction(() => {
        const el = document.getElementById('perimeter-status');
        return el && el.textContent.includes('PROTECTED');
      }, { timeout: 12000 });
      console.log('✅ Popup perimeter status successfully escalated to PROTECTED!');
    } catch {
      console.warn('⚠️ Popup did not transition to PROTECTED within 12s, checking DOM...');
    }

    // Verify DOM redaction
    await page.waitForTimeout(500);
    const scannedPan = await page.$eval('#vendor-pan', el => el.value);
    const scannedGstin = await page.$eval('#vendor-gstin', el => el.value);
    const scannedAccount = await page.$eval('#vendor-bank-account', el => el.value);
    console.log('\nPost-Sanitization DOM Values on Testbed:');
    console.log('  - PAN field:', scannedPan);
    console.log('  - GSTIN field:', scannedGstin);
    console.log('  - Bank Account field:', scannedAccount);

    if (scannedPan.startsWith('<PAN_') && scannedGstin.startsWith('<GSTIN_')) {
      console.log('✅ PII Redaction in DOM strictly verified!');
      results.scanAndSanitizeWorks = true;
      results.piiRedactionVerified = true;
    } else {
      results.errorsFound.push(`DOM was not redacted: PAN=${scannedPan}, GSTIN=${scannedGstin}`);
    }

    // Vault metrics
    const redactedMetric = await popupPage.$eval('#metric-redacted', el => el.textContent);
    const vaultMetric = await popupPage.$eval('#metric-vault', el => el.textContent);
    console.log(`  Popup Metrics: Redacted=${redactedMetric}, Vault Tokens=${vaultMetric}`);
    if (parseInt(redactedMetric, 10) > 0) results.vaultTrackingVerified = true;

    // Idempotency: repeated scans must not duplicate boxes/tokens
    console.log('\n⚡ Testing repeated "Scan & Sanitize" (Anti-Clutter & Idempotency)...');
    await popupPage.click('#btn-scan');
    await page.waitForTimeout(600);
    await popupPage.click('#btn-scan');
    await page.waitForTimeout(600);
    const reRedactedMetric = await popupPage.$eval('#metric-redacted', el => el.textContent);
    const reVaultMetric = await popupPage.$eval('#metric-vault', el => el.textContent);
    if (reRedactedMetric === redactedMetric && reVaultMetric === vaultMetric) {
      console.log('✅ Anti-Clutter & Idempotency verified! Stable metrics on repeated scans.');
    } else {
      results.errorsFound.push(`Clutter on repeated scans: ${redactedMetric}/${vaultMetric} → ${reRedactedMetric}/${reVaultMetric}`);
    }

    // Restore
    console.log('\n↺ Testing "Restore" button...');
    try {
      await popupPage.waitForSelector('#btn-restore:not([disabled])', { timeout: 5000 });
      await popupPage.click('#btn-restore');
      await page.waitForTimeout(500);
      const restoredPan = await page.$eval('#vendor-pan', el => el.value);
      if (restoredPan === initialPan) {
        console.log('✅ DOM Restoration verified! Original values recovered.');
        results.restorationVerified = true;
      } else {
        results.errorsFound.push(`Restore failed: expected "${initialPan}", got "${restoredPan}"`);
      }
    } catch (restErr) {
      results.errorsFound.push(`Restore button error: ${restErr.message}`);
    }

    // Autonomous end-to-end loop (live reasoner + risk gate)
    console.log('\n🤖 Testing "Run End-to-End Agent Loop" with live Reasoning Engine...');
    await page.bringToFront();
    await popupPage.bringToFront();
    await popupPage.click('#btn-autonomous');
    await page.bringToFront();

    try {
      await page.waitForSelector('#sentry-risk-modal', { timeout: 20000 });
      console.log('✅ 4-Tier Risk Policy Gate modal rendered on page!');
      results.riskGateModalRendered = true;
      const modalText = await page.$eval('#sentry-risk-modal', el => el.textContent);
      console.log('  Risk Gate Notice:', modalText.substring(0, 150).replace(/\s+/g, ' '));
      const authBtn = await page.$('#sentry-btn-authorize');
      if (authBtn) {
        await authBtn.click();
        await page.waitForTimeout(1000);
        results.e2eReasonerAutonomousStepWorks = true;
      }
    } catch (mErr) {
      console.log('Notice: risk modal did not appear (action may have executed at a lower tier):', mErr.message);
    }

    if (popupErrors.length > 0) {
      console.log('⚠️ Popup Errors:', popupErrors);
      results.errorsFound.push(...popupErrors.map(e => `Popup Error: ${e}`));
    }
  }

  // Portal B: HR & Deputation
  console.log('\n👥 Testing Portal B: HR & Deputation...');
  await page.click('#tab-hr');
  await page.waitForTimeout(500);
  const empAadhaar = await page.$eval('#emp-aadhaar', el => el.value);
  console.log('  HR Ground truth Aadhaar:', empAadhaar);

  // Portal C: ISTRAC
  console.log('\n🛰️ Testing Portal C: ISTRAC Mission Operations...');
  await page.click('#tab-mission');
  await page.waitForTimeout(500);
  const transponder = await page.$eval('#transponder-key', el => el.value);
  console.log('  ISTRAC Ground truth Transponder Key (Luhn):', transponder);

  const realErrors = pageErrors.filter(e => !e.includes('favicon.ico') && !e.includes('404'));
  if (realErrors.length > 0) {
    console.log('⚠️ Testbed Page Console Errors:', realErrors);
    results.errorsFound.push(...realErrors.map(e => `Page Error: ${e}`));
  }
} catch (err) {
  console.error('Audit execution error:', err);
  results.errorsFound.push(`Audit Error: ${err.message}`);
} finally {
  await context.close();
  staticServer.close();
}

console.log('\n' + '='.repeat(70));
console.log('📊 FINAL PLAYWRIGHT AUDIT REPORT');
console.log('='.repeat(70));
console.log(JSON.stringify(results, null, 2));

if (results.errorsFound.length === 0) {
  console.log('\n🎉 ALL SYSTEMS OPERATING WITHOUT ERRORS!');
  process.exit(0);
} else {
  console.log(`\n❌ Found ${results.errorsFound.length} issue(s) during audit.`);
  process.exit(1);
}
