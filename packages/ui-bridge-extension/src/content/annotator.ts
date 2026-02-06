import type { Annotation } from '../shared/types';
import { ANNOTATION_PURPOSES } from '../shared/types';
import type { BridgeClient } from './bridge-client';

/**
 * Annotation popover form rendered inside the shadow DOM.
 * Opens near a selected element and allows creating/editing/deleting annotations.
 */
export class Annotator {
  private shadowRoot: ShadowRoot;
  private client: BridgeClient;
  private popover: HTMLDivElement | null = null;
  private currentElementId: string | null = null;
  private existingAnnotation: Annotation | null = null;
  private onAfterSave: (() => void) | null = null;

  constructor(shadowRoot: ShadowRoot, client: BridgeClient) {
    this.shadowRoot = shadowRoot;
    this.client = client;
  }

  /** Register a callback to run after save/delete */
  setOnAfterSave(callback: () => void): void {
    this.onAfterSave = callback;
  }

  /** Open the annotation popover for an element */
  async open(elementId: string, rect: DOMRect): Promise<void> {
    // Close any existing popover first
    this.close();

    this.currentElementId = elementId;

    // Fetch existing annotation
    this.existingAnnotation = await this.client.getAnnotation(elementId);

    // Build the popover
    this.popover = this.buildPopover(elementId, rect);
    this.shadowRoot.appendChild(this.popover);

    // Position the popover
    this.positionPopover(rect);
  }

  /** Close and remove the popover */
  close(): void {
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
    this.currentElementId = null;
    this.existingAnnotation = null;
  }

  /** Whether the popover is currently open */
  get isOpen(): boolean {
    return this.popover !== null;
  }

  /** Build the popover DOM structure */
  private buildPopover(elementId: string, _rect: DOMRect): HTMLDivElement {
    const popover = document.createElement('div');
    popover.className = 'uib-popover';

    // Header
    const header = document.createElement('div');
    header.className = 'uib-popover-header';

    const title = document.createElement('span');
    title.className = 'uib-popover-header-title';
    title.textContent = elementId;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'uib-popover-header-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    popover.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'uib-popover-body';

    const existing = this.existingAnnotation;

    // Description field
    body.appendChild(
      this.buildTextareaField(
        'description',
        'Description',
        existing?.description || '',
        'What does this element do?'
      )
    );

    // Purpose field
    body.appendChild(
      this.buildSelectField(
        'purpose',
        'Purpose',
        ['', ...ANNOTATION_PURPOSES],
        existing?.purpose || ''
      )
    );

    // Notes field
    body.appendChild(
      this.buildTextareaField('notes', 'Notes', existing?.notes || '', 'Additional notes...')
    );

    // Tags field
    body.appendChild(this.buildTagsField('tags', 'Tags', existing?.tags || []));

    // Button group
    const btnGroup = document.createElement('div');
    btnGroup.className = 'uib-btn-group';

    if (existing) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'uib-btn uib-btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => this.handleDelete());
      btnGroup.appendChild(deleteBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'uib-btn uib-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());
    btnGroup.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'uib-btn uib-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => this.handleSave());
    btnGroup.appendChild(saveBtn);

    body.appendChild(btnGroup);
    popover.appendChild(body);

    // Prevent clicks inside the popover from propagating to the inspector
    popover.addEventListener('click', (e) => e.stopPropagation());
    popover.addEventListener('mousedown', (e) => e.stopPropagation());

    return popover;
  }

  /** Position the popover below or above the target element */
  private positionPopover(rect: DOMRect): void {
    if (!this.popover) return;

    const gap = 8;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Temporarily show to measure
    this.popover.style.visibility = 'hidden';
    this.popover.style.display = 'block';
    const popoverRect = this.popover.getBoundingClientRect();
    this.popover.style.visibility = '';

    // Prefer below the element
    let top = rect.bottom + gap;

    // If not enough space below, position above
    if (top + popoverRect.height > viewportHeight) {
      top = rect.top - popoverRect.height - gap;
    }

    // If still off-screen, clamp to viewport
    if (top < 0) top = gap;

    // Horizontal: align to left of element, clamp to viewport
    let left = rect.left;
    if (left + popoverRect.width > viewportWidth) {
      left = viewportWidth - popoverRect.width - gap;
    }
    if (left < gap) left = gap;

    this.popover.style.top = `${top}px`;
    this.popover.style.left = `${left}px`;
  }

  // ── Form field builders ──

  private buildTextareaField(
    name: string,
    label: string,
    value: string,
    placeholder: string
  ): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'uib-field';

    const lbl = document.createElement('label');
    lbl.className = 'uib-label';
    lbl.textContent = label;
    field.appendChild(lbl);

    const textarea = document.createElement('textarea');
    textarea.className = 'uib-textarea';
    textarea.name = name;
    textarea.placeholder = placeholder;
    textarea.value = value;
    field.appendChild(textarea);

    return field;
  }

  private buildSelectField(
    name: string,
    label: string,
    options: readonly string[],
    selected: string
  ): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'uib-field';

    const lbl = document.createElement('label');
    lbl.className = 'uib-label';
    lbl.textContent = label;
    field.appendChild(lbl);

    const select = document.createElement('select');
    select.className = 'uib-select';
    select.name = name;

    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt || '-- Select --';
      if (opt === selected) option.selected = true;
      select.appendChild(option);
    }

    field.appendChild(select);
    return field;
  }

  private buildTagsField(name: string, label: string, tags: string[]): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'uib-field';

    const lbl = document.createElement('label');
    lbl.className = 'uib-label';
    lbl.textContent = label;
    field.appendChild(lbl);

    const container = document.createElement('div');
    container.className = 'uib-tag-input';
    container.dataset.name = name;

    // Render existing tags
    const currentTags: string[] = [...tags];

    const renderTags = () => {
      // Remove all tag elements
      container.querySelectorAll('.uib-tag').forEach((el) => el.remove());

      // Re-render tags before the input
      for (const tag of currentTags) {
        const tagEl = document.createElement('span');
        tagEl.className = 'uib-tag';
        tagEl.innerHTML = `${this.escapeHtml(tag)}<span class="uib-tag-remove">\u00d7</span>`;
        tagEl.addEventListener('click', () => {
          const idx = currentTags.indexOf(tag);
          if (idx >= 0) {
            currentTags.splice(idx, 1);
            renderTags();
          }
        });
        container.insertBefore(tagEl, input);
      }
    };

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add tag...';
    input.addEventListener('keydown', (e) => {
      const value = input.value.trim();
      if ((e.key === 'Enter' || e.key === ',') && value) {
        e.preventDefault();
        // Split on comma to allow pasting comma-separated tags
        const newTags = value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        for (const t of newTags) {
          if (!currentTags.includes(t)) {
            currentTags.push(t);
          }
        }
        input.value = '';
        renderTags();
      }
      if (e.key === 'Backspace' && !value && currentTags.length > 0) {
        currentTags.pop();
        renderTags();
      }
    });

    container.appendChild(input);
    container.addEventListener('click', () => input.focus());
    renderTags();

    field.appendChild(container);
    return field;
  }

  // ── Actions ──

  private async handleSave(): Promise<void> {
    if (!this.popover || !this.currentElementId) return;

    const body = this.popover.querySelector('.uib-popover-body');
    if (!body) return;

    const description = this.getFieldValue(body, 'textarea[name="description"]');
    const purpose = this.getFieldValue(body, 'select[name="purpose"]');
    const notes = this.getFieldValue(body, 'textarea[name="notes"]');
    const tags = this.collectTags(body);

    const annotation: Annotation = {
      description: description || undefined,
      purpose: purpose || undefined,
      notes: notes || undefined,
      tags: tags.length > 0 ? tags : undefined,
    };

    try {
      await this.client.setAnnotation(this.currentElementId, annotation);
      this.close();
      this.onAfterSave?.();
    } catch (err) {
      console.error('[UI Bridge] Failed to save annotation:', err);
    }
  }

  private async handleDelete(): Promise<void> {
    if (!this.currentElementId) return;

    try {
      await this.client.deleteAnnotation(this.currentElementId);
      this.close();
      this.onAfterSave?.();
    } catch (err) {
      console.error('[UI Bridge] Failed to delete annotation:', err);
    }
  }

  /** Get the value of a form element by selector */
  private getFieldValue(container: Element, selector: string): string {
    const el = container.querySelector(selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    return el?.value?.trim() || '';
  }

  /** Collect tags from the tag input container */
  private collectTags(container: Element): string[] {
    const tagContainer = container.querySelector('.uib-tag-input');
    if (!tagContainer) return [];

    const tags: string[] = [];
    tagContainer.querySelectorAll('.uib-tag').forEach((el) => {
      // Get text content excluding the remove button
      const text = el.childNodes[0]?.textContent?.trim();
      if (text) tags.push(text);
    });

    // Also include any text in the input that hasn't been committed
    const input = tagContainer.querySelector('input') as HTMLInputElement | null;
    if (input?.value?.trim()) {
      const pending = input.value
        .trim()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      tags.push(...pending);
    }

    return tags;
  }

  /** Escape HTML to prevent XSS */
  private escapeHtml(text: string): string {
    const span = document.createElement('span');
    span.textContent = text;
    return span.innerHTML;
  }
}
