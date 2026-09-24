// ISRO Testbed Simulation Script

let currentPortal = 'eproc';
let isDrawing = false;
let sigCanvas, sigCtx;

window.addEventListener('DOMContentLoaded', () => {
  initSignatureCanvas();
  renderAvatarCanvas();
  renderSatelliteCanvas();
  renderDirectorAvatarCanvas();
  updateFieldCounts();

  // Attach submit listeners
  const btnSubmitTender = document.getElementById('btn-submit-tender');
  if (btnSubmitTender) {
    btnSubmitTender.addEventListener('click', (e) => {
      e.preventDefault();
      handleFormSubmission('e-Procurement Tender Bid');
    });
  }

  const btnRequestDeputation = document.getElementById('btn-request-deputation');
  if (btnRequestDeputation) {
    btnRequestDeputation.addEventListener('click', (e) => {
      e.preventDefault();
      handleFormSubmission('HR Deputation Record');
    });
  }

  const btnAuthorizeBurn = document.getElementById('btn-authorize-burn');
  if (btnAuthorizeBurn) {
    btnAuthorizeBurn.addEventListener('click', (e) => {
      e.preventDefault();
      handleFormSubmission('ISTRAC Satellite Orbital Burn Authorization');
    });
  }

  const btnSyncTelemetry = document.getElementById('btn-sync-telemetry');
  if (btnSyncTelemetry) {
    btnSyncTelemetry.addEventListener('click', (e) => {
      e.preventDefault();
      alert('Orbit Telemetry Synced: Ephemeris state vectors updated with ground station telemetry.');
    });
  }
});

// Portal Switcher
function switchPortal(portalId) {
  currentPortal = portalId;
  
  document.querySelectorAll('.portal-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.portal-view').forEach(view => view.classList.remove('active'));

  if (portalId === 'eproc') {
    document.getElementById('tab-eproc').classList.add('active');
    document.getElementById('portal-eproc').classList.add('active');
    document.getElementById('active-portal-badge').textContent = 'e-Procurement';
  } else if (portalId === 'hr') {
    document.getElementById('tab-hr').classList.add('active');
    document.getElementById('portal-hr').classList.add('active');
    document.getElementById('active-portal-badge').textContent = 'HR & Deputation';
  } else if (portalId === 'mission') {
    document.getElementById('tab-mission').classList.add('active');
    document.getElementById('portal-mission').classList.add('active');
    document.getElementById('active-portal-badge').textContent = 'ISTRAC Mission Ops';
    const satCanvas = document.getElementById('satellite-telemetry-canvas');
    if (!satCanvas || !satCanvas.hasAttribute('data-sentry-redacted')) {
      renderSatelliteCanvas();
    }
    const dirCanvas = document.getElementById('director-avatar-canvas');
    if (!dirCanvas || !dirCanvas.hasAttribute('data-sentry-redacted')) {
      renderDirectorAvatarCanvas();
    }
  }

  updateFieldCounts();
}

// Update telemetry counters
function updateFieldCounts() {
  const activeView = document.querySelector('.portal-view.active');
  if (!activeView) return;
  const inputs = activeView.querySelectorAll('input:not([type="button"]):not([type="submit"])');
  const canvases = activeView.querySelectorAll('canvas');

  const piiCountEl = document.getElementById('pii-field-count');
  const visualCountEl = document.getElementById('visual-target-count');

  if (piiCountEl) piiCountEl.textContent = inputs.length;
  if (visualCountEl) visualCountEl.textContent = canvases.length;
}

// Signature Pad Canvas Handling
function initSignatureCanvas() {
  sigCanvas = document.getElementById('signature-canvas');
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext('2d');

  sigCtx.strokeStyle = '#0d2b45';
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';

  sigCanvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    sigCtx.beginPath();
    sigCtx.moveTo(e.offsetX, e.offsetY);
  });

  sigCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    sigCtx.lineTo(e.offsetX, e.offsetY);
    sigCtx.stroke();
  });

  window.addEventListener('mouseup', () => {
    isDrawing = false;
  });

  // Draw default signature on load
  drawPresetSignature();
}

function clearSignatureCanvas() {
  if (!sigCtx) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}

function drawPresetSignature() {
  if (!sigCtx) return;
  clearSignatureCanvas();
  sigCtx.strokeStyle = '#0d2b45';
  sigCtx.lineWidth = 2;
  sigCtx.beginPath();
  
  // Realistic stylized signature stroke
  sigCtx.moveTo(40, 70);
  sigCtx.bezierCurveTo(70, 20, 90, 80, 130, 45);
  sigCtx.bezierCurveTo(150, 20, 160, 90, 200, 60);
  sigCtx.lineTo(240, 58);
  sigCtx.moveTo(110, 40);
  sigCtx.lineTo(260, 40);
  sigCtx.moveTo(80, 85);
  sigCtx.lineTo(310, 82);
  sigCtx.stroke();
  
  // Date annotation
  sigCtx.font = '10px "JetBrains Mono", monospace';
  sigCtx.fillStyle = '#64748b';
  sigCtx.fillText("DIGITALLY SIGNED / ARVIND S. SWAMINATHAN / 2026-09-22", 40, 105);
}

// Procedural Biometric Avatar on Canvas (for CV face-blur testing)
function renderAvatarCanvas() {
  const avatarCanvas = document.getElementById('avatar-canvas');
  if (!avatarCanvas) return;
  const ctx = avatarCanvas.getContext('2d');
  const w = avatarCanvas.width;
  const h = avatarCanvas.height;

  // Background gradient (ID badge style)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1e293b');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
  ctx.lineWidth = 1;
  for (let i = 15; i < w; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i, h);
    ctx.moveTo(0, i); ctx.lineTo(w, i);
    ctx.stroke();
  }

  // Draw stylized human face outline
  ctx.fillStyle = '#f6d8b8';
  ctx.beginPath();
  ctx.ellipse(w/2, h/2 - 5, 32, 40, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = '#261b17';
  ctx.beginPath();
  ctx.arc(w/2, h/2 - 18, 33, Math.PI, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(w/2 - 12, h/2 - 8, 3, 0, Math.PI * 2);
  ctx.arc(w/2 + 12, h/2 - 8, 3, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = '#261b17';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(w/2 - 18, h/2 - 15); ctx.lineTo(w/2 - 6, h/2 - 14);
  ctx.moveTo(w/2 + 6, h/2 - 14); ctx.lineTo(w/2 + 18, h/2 - 15);
  ctx.stroke();

  // Nose and Smile
  ctx.beginPath();
  ctx.moveTo(w/2, h/2 - 5); ctx.lineTo(w/2 - 2, h/2 + 5); ctx.lineTo(w/2 + 2, h/2 + 5);
  ctx.stroke();

  ctx.strokeStyle = '#a16207';
  ctx.beginPath();
  ctx.arc(w/2, h/2 + 10, 10, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // Shoulders / uniform
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.ellipse(w/2, h + 18, 55, 36, 0, Math.PI, 0, true);
  ctx.fill();

  // Security bounding box crosshairs overlay
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.strokeRect(w/2 - 38, h/2 - 48, 76, 88);
  ctx.fillStyle = '#38bdf8';
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.fillText("BIOMETRIC FACE MASK", 16, 122);
}

// Render Satellite Telemetry & Multi-Spectral Earth Observation Canvas (Tests DBNet CCL)
function renderSatelliteCanvas() {
  const canvas = document.getElementById('satellite-telemetry-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Deep space / telemetry gradient
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#040d1a');
  grad.addColorStop(0.5, '#0b1e36');
  grad.addColorStop(1, '#061325');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Coordinate grid lines (multi-spectral raster)
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
  ctx.lineWidth = 1;
  for (let x = 20; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 20; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Simulated Earth Horizon Arc
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w / 2, h + 180, 260, 1.1 * Math.PI, 1.9 * Math.PI);
  ctx.stroke();

  // Coastline / Terrain Landmass Fill
  ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
  ctx.beginPath();
  ctx.moveTo(180, 140);
  ctx.bezierCurveTo(240, 110, 320, 160, 420, 130);
  ctx.lineTo(460, 220);
  ctx.lineTo(160, 220);
  ctx.closePath();
  ctx.fill();

  // Orbital Track Vector
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(80, 180);
  ctx.quadraticCurveTo(w / 2, 70, w - 80, 150);
  ctx.stroke();
  ctx.setLineDash([]);

  // Satellite Sensor Crosshair
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  const cx = 310, cy = 110;
  ctx.strokeRect(cx - 18, cy - 18, 36, 36);
  ctx.beginPath();
  ctx.moveTo(cx - 24, cy); ctx.lineTo(cx + 24, cy);
  ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy + 24);
  ctx.stroke();

  // CLUSTER 1: Top-Left Mission Text Stamp (DBNet text cluster 1)
  ctx.fillStyle = 'rgba(13, 43, 69, 0.85)';
  ctx.fillRect(16, 16, 270, 46);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 16, 270, 46);

  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillStyle = '#f6ae2d';
  ctx.fillText("RESTRICTED PAYLOAD: CARTOSAT-3", 26, 34);
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText("BAND-4 PAN-SHARPENED / RESOLUTION 0.28M", 26, 50);

  // CLUSTER 2: Bottom-Right Geolocation Stamp (DBNet text cluster 2)
  ctx.fillStyle = 'rgba(13, 43, 69, 0.85)';
  ctx.fillRect(w - 280, h - 56, 264, 44);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.strokeRect(w - 280, h - 56, 264, 44);

  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText("TARGET ROI: LAT 13.719°N | LON 80.230°E", w - 270, h - 38);
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText("TIMESTAMP: 2026-09-22 18:30 UTC / PASS-742", w - 270, h - 22);
}

// Render Flight Director Biometric Badge Canvas (Tests BlazeFace)
function renderDirectorAvatarCanvas() {
  const canvas = document.getElementById('director-avatar-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Background ID badge gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // ID badge watermark
  ctx.strokeStyle = 'rgba(246, 174, 45, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, w - 12, h - 12);

  // Stylized Human Face for BlazeFace
  ctx.fillStyle = '#f3cbb1';
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2 - 4, 30, 38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dark hair
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 - 16, 31, Math.PI, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(w / 2 - 11, h / 2 - 6, 3, 0, Math.PI * 2);
  ctx.arc(w / 2 + 11, h / 2 - 6, 3, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 17, h / 2 - 13); ctx.lineTo(w / 2 - 5, h / 2 - 12);
  ctx.moveTo(w / 2 + 5, h / 2 - 12); ctx.lineTo(w / 2 + 17, h / 2 - 13);
  ctx.stroke();

  // Nose and mouth
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2 - 3); ctx.lineTo(w / 2 - 2, h / 2 + 6); ctx.lineTo(w / 2 + 2, h / 2 + 6);
  ctx.stroke();

  ctx.strokeStyle = '#9a3412';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 + 12, 8, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // Flight Commander Uniform / Saffron & Navy collar
  ctx.fillStyle = '#0d2b45';
  ctx.beginPath();
  ctx.ellipse(w / 2, h + 18, 52, 34, 0, Math.PI, 0, true);
  ctx.fill();

  ctx.fillStyle = '#f26419';
  ctx.fillRect(w / 2 - 12, h - 16, 24, 6);
}

// Reset form values to blanks
function resetPortalForm() {
  const activeView = document.querySelector('.portal-view.active');
  if (!activeView) return;
  activeView.querySelectorAll('input').forEach(input => {
    input.value = '';
  });
  clearSignatureCanvas();
}

// Load pre-populated realistic scenario
function loadSampleScenario() {
  if (currentPortal === 'eproc') {
    document.getElementById('vendor-name').value = 'Dr. Arvind S. Swaminathan';
    document.getElementById('vendor-email').value = 'arvind.swaminathan@aerocore-tech.in';
    document.getElementById('vendor-phone').value = '+91 98451 23456';
    document.getElementById('vendor-pan').value = 'AAACA7890B';
    document.getElementById('vendor-gstin').value = '29AAACA7890B1Z5';
    document.getElementById('vendor-bank-ifsc').value = 'SBIN0001040';
    document.getElementById('vendor-bank-account').value = '98765432109876';
    document.getElementById('quote-item-1').value = '₹ 4,850,000.00';
    document.getElementById('quote-item-2').value = '₹ 12,400,000.00';
    document.getElementById('quote-item-3').value = '₹ 1,875,000.00';
    document.getElementById('quote-total').value = '₹ 152,800,000.00';
    drawPresetSignature();
  } else if (currentPortal === 'hr') {
    document.getElementById('emp-name').value = 'Sunita R. Namboodiri';
    document.getElementById('emp-code').value = 'ISRO-SCI-SF-4891';
    document.getElementById('emp-designation').value = "Scientist / Engineer 'SF', URSC Bengaluru";
    document.getElementById('emp-email').value = 'sunita.namboodiri@isro.gov.in';
    document.getElementById('emp-aadhaar').value = '9999 9999 0019'; // Valid Verhoeff checksum
    document.getElementById('emp-passport').value = 'Z3489127';
    document.getElementById('mission-destination').value = 'ESA / CNES Lunar Surface Working Group (Toulouse, France)';
    document.getElementById('mission-dates').value = '14 Oct 2026 – 28 Oct 2026';
    renderAvatarCanvas();
  } else if (currentPortal === 'mission') {
    document.getElementById('mission-director-name').value = 'Dr. K. S. Radhakrishnan';
    document.getElementById('mission-director-pan').value = 'AAAGP1234M';
    document.getElementById('mission-director-aadhaar').value = '9999 9999 0019'; // Valid Verhoeff
    document.getElementById('transponder-key').value = '4532 0151 1283 0366'; // Valid Luhn
    document.getElementById('uplink-frequency').value = '8450.25 MHz / RHCP';
    document.getElementById('mission-budget').value = '₹ 620,00,00,000';
    document.getElementById('station-contact').value = '+91 80 2839 5000';
    document.getElementById('mission-notes').value = 'Trajectory fine-tuning for apogee 480km Sun-Synchronous Polar Orbit scheduled at 18:45 UTC.';
    renderSatelliteCanvas();
    renderDirectorAvatarCanvas();
  }
}

// Submission Handler — demonstrates that the submitted payload receives real data when re-hydrated locally!
function handleFormSubmission(formName) {
  const activeView = document.querySelector('.portal-view.active');
  const values = {};
  activeView.querySelectorAll('input').forEach(input => {
    if (input.id) values[input.id] = input.value;
  });

  console.log(`[TESTBED SUBMIT] ${formName} submitted values:`, values);
  alert(`[SUBMISSION DISPATCHED]\n\nForm: ${formName}\nFields submitted: ${Object.keys(values).length}\n\nNotice: Check the developer console to view the exact submitted values. If SentryAgent's local re-hydration is working, the values here are real, even though an outside observer only saw sanitized tokens!`);
}
