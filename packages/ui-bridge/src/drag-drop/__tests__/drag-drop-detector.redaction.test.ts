/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DragDropDetector } from '../drag-drop-detector';
import { REDACTED_VALUE } from '../../core/redaction';

const SECRET = 'SECRET-dnd-5527';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DragDropDetector labels — redaction boundaries', () => {
  it('a boundary inside a drag source reads as the sentinel in the reported label', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-grabbed', 'false');
    el.innerHTML = `Card <span data-bridge-redact="true">${SECRET}</span>`;
    document.body.appendChild(el);

    const result = new DragDropDetector().scanARIA([{ id: 'card', element: el }]);
    expect(result.sources[0].label).toBe(`Card ${REDACTED_VALUE}`);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
