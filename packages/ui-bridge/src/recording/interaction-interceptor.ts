/**
 * Interaction Interceptor
 *
 * Attaches document-level event listeners to capture user interactions on
 * registered UI Bridge elements. Applies event segmentation (from OpenAdapt)
 * by only capturing interactions on registered elements and coalescing
 * rapid keystroke sequences.
 */

import type { UIBridgeRegistry } from '../core/registry';
import { findNearestRegisteredElement } from '../core/element-fingerprint';
import { verdictOf, scrubValueByVerdict, readScrubbedValue } from '../core/redaction';
import type { InteractionEvent, InteractionActionType } from './types';

export interface InteractionInterceptorConfig {
  /** Only capture interactions on registered elements (default: true) */
  filterUnregistered: boolean;
  /** Keystroke coalescing window in ms (default: 100) */
  keystrokeCoalesceMs: number;
}

type InteractionCallback = (event: InteractionEvent) => void;

/**
 * Intercepts user interactions on the document and emits structured
 * InteractionEvents for registered elements.
 */
export class InteractionInterceptor {
  private registry: UIBridgeRegistry;
  private config: InteractionInterceptorConfig;
  private callback: InteractionCallback;
  private active = false;

  // Keystroke coalescing state
  private keystrokeTimer: ReturnType<typeof setTimeout> | null = null;
  private keystrokeBuffer = '';
  private keystrokeTargetId: string | null = null;
  private keystrokeTargetElement: HTMLElement | null = null;

  // Bound handlers for cleanup
  private handleClick: (e: MouseEvent) => void;
  private handleInput: (e: Event) => void;
  private handleChange: (e: Event) => void;
  private handleSubmit: (e: Event) => void;
  private handleKeydown: (e: KeyboardEvent) => void;

  constructor(
    registry: UIBridgeRegistry,
    callback: InteractionCallback,
    config: Partial<InteractionInterceptorConfig> = {}
  ) {
    this.registry = registry;
    this.callback = callback;
    this.config = {
      filterUnregistered: config.filterUnregistered ?? true,
      keystrokeCoalesceMs: config.keystrokeCoalesceMs ?? 100,
    };

    // Bind handlers
    this.handleClick = this.onClick.bind(this);
    this.handleInput = this.onInput.bind(this);
    this.handleChange = this.onChange.bind(this);
    this.handleSubmit = this.onSubmit.bind(this);
    this.handleKeydown = this.onKeydown.bind(this);
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    // Use capture phase to intercept before application handlers
    document.addEventListener('click', this.handleClick, { capture: true, passive: true });
    document.addEventListener('input', this.handleInput, { capture: true, passive: true });
    document.addEventListener('change', this.handleChange, { capture: true, passive: true });
    document.addEventListener('submit', this.handleSubmit, { capture: true, passive: true });
    document.addEventListener('keydown', this.handleKeydown, { capture: true, passive: true });
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    // Flush any pending keystroke buffer
    this.flushKeystrokeBuffer();

    document.removeEventListener('click', this.handleClick, { capture: true });
    document.removeEventListener('input', this.handleInput, { capture: true });
    document.removeEventListener('change', this.handleChange, { capture: true });
    document.removeEventListener('submit', this.handleSubmit, { capture: true });
    document.removeEventListener('keydown', this.handleKeydown, { capture: true });
  }

  private resolveTarget(
    domTarget: EventTarget | null
  ): { elementId: string; element: HTMLElement } | null {
    if (!(domTarget instanceof HTMLElement)) return null;

    const registered = findNearestRegisteredElement(domTarget, this.registry);
    if (!registered && this.config.filterUnregistered) return null;
    if (!registered) return null;

    return { elementId: registered.id, element: registered.element };
  }

  private emit(
    actionType: InteractionActionType,
    elementId: string,
    element: HTMLElement,
    value?: string
  ): void {
    this.callback({
      timestamp: Date.now(),
      actionType,
      targetElementId: elementId,
      targetElement: element,
      // §4.6 capture-time gate: `value` is the raw keystroke buffer read off a
      // live `<input>`. Scrub it HERE — where the element ref exists — so a
      // password/boundary value is never stored in the recorded interaction or
      // the derived variable candidate (no later DOM scrub can reach it).
      value: scrubValueByVerdict(value, verdictOf(element)),
    });
  }

  private onClick(e: MouseEvent): void {
    const target = this.resolveTarget(e.target);
    if (!target) return;

    // Don't emit click for checkboxes/radios — handled by onChange
    const el = target.element;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return;

    this.emit('click', target.elementId, target.element);
  }

  private onInput(e: Event): void {
    const target = this.resolveTarget(e.target);
    if (!target) return;

    const el = target.element;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;

    // Coalesce keystrokes: buffer input events and flush after a quiet period
    if (this.keystrokeTargetId === target.elementId) {
      // Same target — extend buffer
      this.keystrokeBuffer = readScrubbedValue(el) ?? '';
    } else {
      // Different target — flush previous and start new
      this.flushKeystrokeBuffer();
      this.keystrokeTargetId = target.elementId;
      this.keystrokeTargetElement = target.element;
      this.keystrokeBuffer = readScrubbedValue(el) ?? '';
    }

    // Reset coalescing timer
    if (this.keystrokeTimer) clearTimeout(this.keystrokeTimer);
    this.keystrokeTimer = setTimeout(
      () => this.flushKeystrokeBuffer(),
      this.config.keystrokeCoalesceMs
    );
  }

  private flushKeystrokeBuffer(): void {
    if (this.keystrokeTimer) {
      clearTimeout(this.keystrokeTimer);
      this.keystrokeTimer = null;
    }

    if (this.keystrokeTargetId && this.keystrokeTargetElement && this.keystrokeBuffer) {
      this.emit('type', this.keystrokeTargetId, this.keystrokeTargetElement, this.keystrokeBuffer);
    }

    this.keystrokeTargetId = null;
    this.keystrokeTargetElement = null;
    this.keystrokeBuffer = '';
  }

  private onChange(e: Event): void {
    const target = this.resolveTarget(e.target);
    if (!target) return;

    const el = target.element;

    if (el instanceof HTMLSelectElement) {
      this.emit('select', target.elementId, target.element, readScrubbedValue(el));
    } else if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        this.emit(
          el.checked ? 'check' : 'uncheck',
          target.elementId,
          target.element,
          String(el.checked)
        );
      } else if (el.type === 'radio') {
        this.emit('check', target.elementId, target.element, readScrubbedValue(el));
      }
    }
  }

  private onSubmit(e: Event): void {
    const target = this.resolveTarget(e.target);
    if (!target) return;

    // Flush any pending keystrokes before submit
    this.flushKeystrokeBuffer();

    this.emit('submit', target.elementId, target.element);
  }

  private onKeydown(e: KeyboardEvent): void {
    // Only capture Enter (as submit trigger) and Escape (as cancel)
    if (e.key !== 'Enter' && e.key !== 'Escape') return;

    const target = this.resolveTarget(e.target);
    if (!target) return;

    if (e.key === 'Enter') {
      // Flush keystrokes before Enter
      this.flushKeystrokeBuffer();

      // If inside a form, this will trigger submit — don't double-emit
      const form = target.element.closest('form');
      if (form) return;

      // Otherwise emit as submit
      this.emit('submit', target.elementId, target.element);
    }
    // Escape is captured but not emitted as an interaction — it's noise
  }
}
