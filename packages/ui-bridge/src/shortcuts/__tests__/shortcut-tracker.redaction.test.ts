/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ShortcutTracker } from '../shortcut-tracker';
import { REDACTED_VALUE } from '../../core/redaction';

const SECRET = 'SECRET-keys-7714';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ShortcutTracker descriptions — redaction boundaries', () => {
  it('a boundary inside a shortcut control reads as the sentinel in the snapshot context', () => {
    document.body.innerHTML = `<button aria-keyshortcuts="Control+K">Open <span data-bridge-redact="true">${SECRET}</span></button>`;
    const tracker = new ShortcutTracker({ scanDOM: false });
    tracker.rescan();
    const ctx = tracker.getSnapshotShortcutContext();
    expect(ctx.shortcuts[0].description).toBe(`Open ${REDACTED_VALUE}`);
    expect(JSON.stringify(ctx)).not.toContain(SECRET);
  });
});
