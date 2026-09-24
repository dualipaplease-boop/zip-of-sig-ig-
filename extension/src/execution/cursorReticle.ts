// SentryAgent Tactical HUD Reticle / Cursor (Zero-Dependency)
// Provides visible visual telemetry for autonomous agent actions
// Aerospace / ISRO mission-control HUD targeting aesthetic.

export class SentryCursorReticle {
  private container: HTMLDivElement | null = null;
  private reticle: HTMLDivElement | null = null;
  private badge: HTMLSpanElement | null = null;

  constructor() {
    // Lazy init on first DOM touch
  }

  private ensureMounted(): void {
    if (this.container && document.body.contains(this.container)) return;

    this.container = document.createElement('div');
    this.container.id = 'sentry-hud-cursor-container';
    this.container.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 0; height: 0;
      z-index: 999998;
      pointer-events: none;
      font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, monospace;
    `;

    this.reticle = document.createElement('div');
    this.reticle.id = 'sentry-hud-reticle';
    this.reticle.style.cssText = `
      position: absolute;
      top: -24px; left: -24px;
      width: 48px; height: 48px;
      border: 2px solid #06b6d4;
      border-radius: 50%;
      box-shadow: 0 0 15px rgba(6, 182, 212, 0.6), inset 0 0 10px rgba(6, 182, 212, 0.3);
      transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate3d(100px, 100px, 0);
    `;

    // Center Crosshair Dot
    const dot = document.createElement('div');
    dot.style.cssText = `
      width: 6px; height: 6px;
      background: #f59e0b;
      border-radius: 50%;
      box-shadow: 0 0 8px #f59e0b;
    `;
    this.reticle.appendChild(dot);

    // Target Info Badge
    this.badge = document.createElement('span');
    this.badge.id = 'sentry-hud-badge';
    this.badge.style.cssText = `
      position: absolute;
      top: 52px; left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      letter-spacing: 0.3px;
    `;
    this.badge.textContent = 'SENTRY AGENT ACTIVE';
    this.reticle.appendChild(this.badge);

    this.container.appendChild(this.reticle);
    document.body.appendChild(this.container);
  }

  public async glideTo(
    targetX: number,
    targetY: number,
    label: string,
    actionType: string = 'CLICK'
  ): Promise<void> {
    this.ensureMounted();
    if (!this.reticle || !this.badge) return;

    this.badge.textContent = `TARGET [${actionType}]: ${label.substring(0, 24)}`;
    this.reticle.style.borderColor = actionType === 'TYPE' ? '#10b981' : '#06b6d4';

    // Move to target
    this.reticle.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) scale(1)`;

    // Wait for the glide transition
    await new Promise((r) => setTimeout(r, 450));

    // Tap pulse animation
    this.reticle.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) scale(0.85)`;
    await new Promise((r) => setTimeout(r, 120));
    this.reticle.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) scale(1)`;
  }

  public hide(): void {
    if (this.reticle) {
      this.reticle.style.opacity = '0';
      setTimeout(() => {
        if (this.container && document.body.contains(this.container)) {
          this.container.remove();
          this.container = null;
          this.reticle = null;
        }
      }, 300);
    }
  }
}

export const cursorReticleInstance = new SentryCursorReticle();
