/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { UndoDetector } from '../undo-detector';
import { REDACTED_VALUE } from '../../core/redaction';

const SECRET = 'SECRET-undo-9931';

afterEach(() => {
  document.body.innerHTML = '';
});

/** §4.6: the detection result is what the snapshot's undo context carries. */
describe('UndoDetector detect() — redaction boundaries', () => {
  it('a boundary inside an undo control reads as the sentinel in the label', () => {
    document.body.innerHTML = `<button class="undo-btn">Undo <span data-bridge-redact="true">${SECRET}</span></button>`;
    const result = new UndoDetector().detect();
    expect(result.undoElement).toBeDefined();
    expect(result.undoElement!.label).toBe(`Undo ${REDACTED_VALUE}`);
    expect(result.undoElement!.parsedDescription).toBe(REDACTED_VALUE);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('a text-matched control inside a boundary is labelled by the sentinel only', () => {
    document.body.innerHTML = `<div data-bridge-redact="true"><button>Undo ${SECRET}</button></div>`;
    const result = new UndoDetector().detect();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
