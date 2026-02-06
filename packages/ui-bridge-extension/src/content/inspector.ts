import type { BridgeClient } from './bridge-client';

/**
 * Inspector overlay for element highlighting and selection.
 * Renders inside a shadow DOM to avoid style conflicts with the host page.
 */
export class Inspector {
  private shadowRoot: ShadowRoot;
  private client: BridgeClient;
  private onElementClick: (elementId: string) => void;

  private active = false;
  private overlay: HTMLDivElement;
  private overlayLabel: HTMLDivElement;
  private currentElement: HTMLElement | null = null;
  private annotatedIds: Set<string> = new Set();

  // Bound handlers for cleanup
  private handleMouseMove: (e: MouseEvent) => void;
  private handleClick: (e: MouseEvent) => void;
  private handleKeyDown: (e: KeyboardEvent) => void;

  constructor(
    shadowRoot: ShadowRoot,
    client: BridgeClient,
    onElementClick: (elementId: string) => void
  ) {
    this.shadowRoot = shadowRoot;
    this.client = client;
    this.onElementClick = onElementClick;

    // Create overlay elements
    this.overlay = document.createElement('div');
    this.overlay.className = 'uib-overlay';
    this.overlay.style.display = 'none';

    this.overlayLabel = document.createElement('div');
    this.overlayLabel.className = 'uib-overlay-label';
    this.overlay.appendChild(this.overlayLabel);

    this.shadowRoot.appendChild(this.overlay);

    // Bind event handlers
    this.handleMouseMove = this.onMouseMove.bind(this);
    this.handleClick = this.onClick.bind(this);
    this.handleKeyDown = this.onKeyDown.bind(this);
  }

  /** Whether the inspector is currently active */
  get isActive(): boolean {
    return this.active;
  }

  /** Toggle inspector on/off */
  toggle(): void {
    if (this.active) {
      this.disable();
    } else {
      this.enable();
    }
  }

  /** Enable the inspector */
  async enable(): Promise<void> {
    if (this.active) return;
    this.active = true;

    // Refresh the set of annotated element IDs
    await this.refreshAnnotatedIds();

    // Add event listeners on document (capture phase to intercept before page handlers)
    document.addEventListener('mousemove', this.handleMouseMove, true);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeyDown, true);

    // Mark unannotated elements
    this.markUnannotatedElements();
  }

  /** Disable the inspector */
  disable(): void {
    if (!this.active) return;
    this.active = false;

    // Remove event listeners
    document.removeEventListener('mousemove', this.handleMouseMove, true);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);

    // Hide overlay
    this.overlay.style.display = 'none';
    this.currentElement = null;

    // Remove all unannotated markers from the page
    this.clearUnannotatedMarkers();
  }

  /** Highlight a specific element by ID (for external highlight requests) */
  highlightElement(elementId: string): void {
    const el = document.querySelector(
      `[data-ui-id="${CSS.escape(elementId)}"]`
    ) as HTMLElement | null;
    if (!el) return;

    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Position overlay over the element
    const rect = el.getBoundingClientRect();
    this.positionOverlay(rect);
    this.overlay.style.display = 'block';

    // Flash animation
    this.overlay.classList.add('uib-overlay--flash');
    setTimeout(() => {
      this.overlay.classList.remove('uib-overlay--flash');
      if (!this.active) {
        this.overlay.style.display = 'none';
      }
    }, 1500);
  }

  /** Refresh the cached set of annotated element IDs */
  private async refreshAnnotatedIds(): Promise<void> {
    try {
      const annotations = await this.client.getAnnotations();
      this.annotatedIds = new Set(Object.keys(annotations || {}));
    } catch {
      this.annotatedIds = new Set();
    }
  }

  /** Add visual markers to unannotated elements on the page */
  private markUnannotatedElements(): void {
    const elements = document.querySelectorAll('[data-ui-id]');
    elements.forEach((el) => {
      const id = el.getAttribute('data-ui-id');
      if (id && !this.annotatedIds.has(id)) {
        (el as HTMLElement).classList.add('uib-unannotated-page');
      }
    });

    // Inject a style tag if not present
    if (!document.getElementById('uib-page-styles')) {
      const style = document.createElement('style');
      style.id = 'uib-page-styles';
      style.textContent = `
        .uib-unannotated-page {
          outline: 2px dotted #f97316 !important;
          outline-offset: 1px !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /** Remove all unannotated markers from the page */
  private clearUnannotatedMarkers(): void {
    const elements = document.querySelectorAll('.uib-unannotated-page');
    elements.forEach((el) => {
      el.classList.remove('uib-unannotated-page');
    });

    const style = document.getElementById('uib-page-styles');
    if (style) {
      style.remove();
    }
  }

  /** Find the closest ancestor (or self) with a data-ui-id attribute */
  private findUiElement(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('[data-ui-id]') as HTMLElement | null;
  }

  /** Position the overlay over a bounding rect */
  private positionOverlay(rect: DOMRect): void {
    this.overlay.style.top = `${rect.top}px`;
    this.overlay.style.left = `${rect.left}px`;
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
  }

  /** Update the overlay label text and status dot */
  private updateLabel(elementId: string): void {
    const isAnnotated = this.annotatedIds.has(elementId);
    const dotClass = isAnnotated ? 'uib-status-dot--annotated' : 'uib-status-dot--unannotated';
    this.overlayLabel.innerHTML = `<span class="uib-status-dot ${dotClass}"></span>${this.escapeHtml(elementId)}`;
  }

  /** Escape HTML to prevent XSS in label */
  private escapeHtml(text: string): string {
    const div = document.createElement('span');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Event handlers ──

  private onMouseMove(e: MouseEvent): void {
    if (!this.active) return;

    const target = this.findUiElement(e.target);

    if (!target) {
      // No UI element under cursor, hide overlay
      if (this.currentElement) {
        this.overlay.style.display = 'none';
        this.currentElement = null;
      }
      return;
    }

    // Same element, no update needed
    if (target === this.currentElement) return;

    this.currentElement = target;
    const elementId = target.getAttribute('data-ui-id');
    if (!elementId) return;

    const rect = target.getBoundingClientRect();
    this.positionOverlay(rect);
    this.updateLabel(elementId);
    this.overlay.style.display = 'block';
  }

  private onClick(e: MouseEvent): void {
    if (!this.active) return;

    const target = this.findUiElement(e.target);
    if (!target) return;

    const elementId = target.getAttribute('data-ui-id');
    if (!elementId) return;

    // Prevent the page from handling this click
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    this.onElementClick(elementId);
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Escape key disables inspector
    if (e.key === 'Escape' && this.active) {
      e.preventDefault();
      e.stopPropagation();
      this.disable();
    }
  }

  /** Notify that an annotation was added/removed so we can update markers */
  async refreshAfterAnnotation(): Promise<void> {
    await this.refreshAnnotatedIds();
    if (this.active) {
      this.clearUnannotatedMarkers();
      this.markUnannotatedElements();
    }
  }
}
