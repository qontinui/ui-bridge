/**
 * Click Highlight — Visual Click Feedback for UI Bridge Apps
 *
 * Draws a brief animated highlight at click locations during automation,
 * giving users visual feedback of what the system is doing without
 * interfering with UI interaction.
 *
 * Inspired by TuriX-CUA's visual click highlighting overlay pattern.
 *
 * @example
 * ```ts
 * import { showClickHighlight } from './click-highlight';
 *
 * // Show a green highlight at coordinates (100, 200)
 * showClickHighlight(100, 200);
 *
 * // Custom options
 * showClickHighlight(300, 400, { color: '#ff0000', duration: 1000, size: 40 });
 * ```
 */

export interface ClickHighlightOptions {
  /** CSS color for the highlight ring. Default: '#00c800' (green). */
  color?: string;
  /** Duration in milliseconds before the highlight fades out. Default: 800. */
  duration?: number;
  /** Diameter of the highlight circle in pixels. Default: 30. */
  size?: number;
  /** Whether to show a ripple animation. Default: true. */
  ripple?: boolean;
}

const DEFAULT_OPTIONS: Required<ClickHighlightOptions> = {
  color: '#00c800',
  duration: 800,
  size: 30,
  ripple: true,
};

/** CSS class name for the highlight elements. */
const HIGHLIGHT_CLASS = 'ui-bridge-click-highlight';

/** Inject the CSS animation once. */
let styleInjected = false;

function injectStyles(): void {
  if (styleInjected) return;
  styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      border-radius: 50%;
      border: 3px solid var(--highlight-color, #00c800);
      opacity: 1;
      transform: scale(0.5);
      animation: ui-bridge-click-fade var(--highlight-duration, 800ms) ease-out forwards;
    }

    .${HIGHLIGHT_CLASS}--ripple {
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      border-radius: 50%;
      border: 2px solid var(--highlight-color, #00c800);
      opacity: 0.5;
      transform: scale(0.5);
      animation: ui-bridge-click-ripple var(--highlight-duration, 800ms) ease-out forwards;
    }

    @keyframes ui-bridge-click-fade {
      0% {
        opacity: 1;
        transform: scale(0.5);
      }
      50% {
        opacity: 0.8;
        transform: scale(1);
      }
      100% {
        opacity: 0;
        transform: scale(1.2);
      }
    }

    @keyframes ui-bridge-click-ripple {
      0% {
        opacity: 0.5;
        transform: scale(0.5);
      }
      100% {
        opacity: 0;
        transform: scale(2);
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Show a visual click highlight at the given screen coordinates.
 *
 * Creates a temporary CSS overlay element with a pulsing circle animation
 * at the specified position. The element is automatically removed after
 * the animation completes.
 *
 * @param x - X coordinate (viewport-relative, pixels).
 * @param y - Y coordinate (viewport-relative, pixels).
 * @param options - Optional customization.
 */
export function showClickHighlight(x: number, y: number, options?: ClickHighlightOptions): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  injectStyles();

  // Main highlight circle
  const el = document.createElement('div');
  el.className = HIGHLIGHT_CLASS;
  el.style.setProperty('--highlight-color', opts.color);
  el.style.setProperty('--highlight-duration', `${opts.duration}ms`);
  el.style.width = `${opts.size}px`;
  el.style.height = `${opts.size}px`;
  el.style.left = `${x - opts.size / 2}px`;
  el.style.top = `${y - opts.size / 2}px`;

  document.body.appendChild(el);

  // Optional ripple effect
  if (opts.ripple) {
    const ripple = document.createElement('div');
    ripple.className = `${HIGHLIGHT_CLASS}--ripple`;
    ripple.style.setProperty('--highlight-color', opts.color);
    ripple.style.setProperty('--highlight-duration', `${opts.duration}ms`);
    ripple.style.width = `${opts.size}px`;
    ripple.style.height = `${opts.size}px`;
    ripple.style.left = `${x - opts.size / 2}px`;
    ripple.style.top = `${y - opts.size / 2}px`;

    document.body.appendChild(ripple);

    // Remove ripple after animation
    setTimeout(() => {
      ripple.remove();
    }, opts.duration);
  }

  // Remove main highlight after animation
  setTimeout(() => {
    el.remove();
  }, opts.duration);
}

/**
 * Show a click highlight centered on an element's bounding rect.
 *
 * @param element - The DOM element to highlight.
 * @param options - Optional customization.
 */
export function showElementHighlight(element: HTMLElement, options?: ClickHighlightOptions): void {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  showClickHighlight(centerX, centerY, options);
}

/**
 * Color presets for different action types.
 */
export const HIGHLIGHT_COLORS = {
  click: '#00c800', // Green
  type: '#0064ff', // Blue
  scroll: '#ff8c00', // Orange
  select: '#b400b4', // Purple
  focus: '#00b4b4', // Teal
  error: '#ff0000', // Red
} as const;
