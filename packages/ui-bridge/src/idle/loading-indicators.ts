/**
 * Loading Indicator Detector
 *
 * Scans the DOM for common loading patterns: aria-busy, CSS class conventions,
 * animated spinners, cursor changes, and progress elements.
 *
 * This detector is reactive — it hooks into MutationObserver to re-scan
 * only when the DOM changes, rather than polling.
 */

import type {
  IdleSignal,
  LoadingIndicatorSignalStatus,
  LoadingIndicatorConfig,
  DetectedLoadingIndicator,
  SignalWaitOptions,
  SignalTransitionCallback,
} from './types';
import { classList } from '../core/class-name';

/** Common loading indicator CSS selectors */
const DEFAULT_LOADING_SELECTORS = [
  // ARIA
  '[aria-busy="true"]',
  '[role="progressbar"]',

  // Common class conventions
  '.loading',
  '.spinner',
  '.skeleton',
  '.shimmer',
  '.loader',
  '.pending',
  '[class*="loading"]',
  '[class*="spinner"]',
  '[class*="skeleton"]',
  '[class*="shimmer"]',

  // HTML elements
  'progress:not([value="100"]):not([value="1"])',

  // Framework-specific (popular libraries)
  '.MuiCircularProgress-root',
  '.MuiLinearProgress-root',
  '.MuiSkeleton-root',
  '.ant-spin',
  '.ant-skeleton',
  '.chakra-spinner',

  // Data attributes
  '[data-loading="true"]',
  '[data-pending="true"]',
  '[data-state="loading"]',
];

/** CSS animation names that typically indicate loading */
const LOADING_ANIMATION_KEYWORDS = [
  'spin',
  'rotate',
  'pulse',
  'shimmer',
  'bounce',
  'skeleton',
  'loading',
  'progress',
  'indeterminate',
];

export class LoadingIndicatorDetector implements IdleSignal<LoadingIndicatorSignalStatus> {
  readonly name = 'loading-indicators';
  readonly weight: number;

  private selectors: string[];
  private checkAnimations: boolean;
  private checkCursor: boolean;
  private observer: MutationObserver | null = null;
  private _indicators: DetectedLoadingIndicator[] = [];
  private _isIdle = true;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Array<SignalTransitionCallback<LoadingIndicatorSignalStatus>> = [];
  private installed = false;

  constructor(config: LoadingIndicatorConfig & { weight?: number } = {}) {
    this.weight = config.weight ?? 0.7;
    this.selectors = [...DEFAULT_LOADING_SELECTORS, ...(config.additionalSelectors ?? [])];
    this.checkAnimations = config.checkAnimations ?? true;
    this.checkCursor = config.checkCursor ?? true;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    // Do initial scan
    this.scan();

    // Watch for DOM changes that might add/remove loading indicators
    this.observer = new MutationObserver(() => {
      // Debounce scans — loading indicators often involve multiple mutations
      if (this.scanTimer) clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scan();
      }, 100);
    });

    this.observer.observe(document.body, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: ['class', 'aria-busy', 'data-loading', 'data-pending', 'data-state'],
    });
  }

  destroy(): void {
    if (!this.installed) return;
    this.installed = false;

    this.observer?.disconnect();
    this.observer = null;

    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }

    this.listeners = [];
  }

  isIdle(): boolean {
    return this._isIdle;
  }

  getStatus(): LoadingIndicatorSignalStatus {
    return {
      idle: this._isIdle,
      loading: !this._isIdle,
      indicators: [...this._indicators],
      timestamp: Date.now(),
    };
  }

  async waitForIdle(options?: SignalWaitOptions): Promise<LoadingIndicatorSignalStatus> {
    const timeout = options?.timeout ?? 30000;
    const minStable = options?.minStableMs ?? 0;

    return new Promise<LoadingIndicatorSignalStatus>((resolve, reject) => {
      const startTime = Date.now();
      let stableSince: number | null = null;

      const check = () => {
        // Re-scan to get fresh data
        this.scan();
        const status = this.getStatus();

        if (status.idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }

        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `Loading indicator timeout after ${timeout}ms. ` +
                `${this._indicators.length} indicators still active.`
            )
          );
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  onTransition(callback: SignalTransitionCallback<LoadingIndicatorSignalStatus>): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Wait for a specific CSS selector to disappear from the loading indicators.
   */
  async waitForIndicatorCleared(
    selector: string,
    timeout = 30000
  ): Promise<LoadingIndicatorSignalStatus> {
    return new Promise<LoadingIndicatorSignalStatus>((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        this.scan();
        const matchingSelector = this.selectors.includes(selector) ? selector : undefined;
        const hasMatch = matchingSelector
          ? document.querySelector(selector) !== null &&
            this.isElementVisible(document.querySelector(selector) as HTMLElement)
          : false;

        if (!hasMatch) {
          return resolve(this.getStatus());
        }

        if (Date.now() - startTime > timeout) {
          return reject(new Error(`Indicator "${selector}" still present after ${timeout}ms.`));
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private scan(): void {
    const indicators: DetectedLoadingIndicator[] = [];

    // 1. Check CSS selectors
    for (const selector of this.selectors) {
      try {
        const elements = document.querySelectorAll<HTMLElement>(selector);
        for (const el of elements) {
          if (this.isElementVisible(el)) {
            indicators.push({
              type: selector.startsWith('[aria-busy') ? 'aria-busy' : 'selector',
              selector,
              element: this.getElementId(el),
            });
          }
        }
      } catch {
        // Invalid selector — skip
      }
    }

    // 2. Check CSS animations (if enabled)
    if (this.checkAnimations && typeof document.getAnimations === 'function') {
      try {
        const animations = document.getAnimations();
        for (const anim of animations) {
          const cssAnim = anim as CSSAnimation;
          const name = cssAnim.animationName || '';
          if (name && LOADING_ANIMATION_KEYWORDS.some((k) => name.toLowerCase().includes(k))) {
            const target = (anim.effect as KeyframeEffect | null)?.target as HTMLElement | null;
            if (target && this.isElementVisible(target)) {
              indicators.push({
                type: 'animation',
                element: this.getElementId(target),
                details: name,
              });
            }
          }
        }
      } catch {
        // getAnimations not supported or error — skip
      }
    }

    // 3. Check cursor style
    if (this.checkCursor) {
      try {
        const bodyStyle = getComputedStyle(document.body);
        if (bodyStyle.cursor === 'wait' || bodyStyle.cursor === 'progress') {
          indicators.push({
            type: 'cursor',
            details: bodyStyle.cursor,
          });
        }
      } catch {
        // getComputedStyle not available — skip
      }
    }

    // Deduplicate by element+type
    const seen = new Set<string>();
    const deduped = indicators.filter((ind) => {
      const key = `${ind.type}:${ind.element || ''}:${ind.selector || ''}:${ind.details || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Check for transition
    const wasIdle = this._isIdle;
    this._indicators = deduped;
    this._isIdle = deduped.length === 0;

    if (wasIdle !== this._isIdle) {
      this.notifyTransition();
    }
  }

  private isElementVisible(el: HTMLElement | null): boolean {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  private getElementId(el: HTMLElement): string {
    return (
      el.getAttribute('data-testid') ||
      el.getAttribute('data-ui-bridge-id') ||
      el.id ||
      `${el.tagName.toLowerCase()}.${classList(el)[0] || 'unknown'}`
    );
  }

  private notifyTransition(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isIdle, status);
      } catch {
        // Don't let listener errors break the detector
      }
    }
  }
}

/** CSSAnimation type augmentation for animationName property */
interface CSSAnimation extends Animation {
  animationName?: string;
}
