/**
 * @vitest-environment jsdom
 */

/**
 * A recording session keeps one recorded interaction per user action.
 *
 * A checkbox toggle used to reach `RecordingSessionManager` twice from its
 * interceptor: as `check`, and as a coalesced `type` carrying the box's value
 * attribute (`"on"`). The session then derived a variable candidate from that
 * `type`. This pins the toggle, entered through `start()` and `stop()`, to one
 * `check` and no variable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { RecordingSessionManager } from './session-manager';

describe('RecordingSessionManager', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('records a checkbox toggle as one check and derives no variable from it', async () => {
    vi.useFakeTimers();
    const registry = new UIBridgeRegistry();
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.append(box);
    registry.registerElement('remember-me', box, { type: 'checkbox' });

    const session = new RecordingSessionManager(registry);
    session.start();
    box.click();
    // Past the interceptor's keystroke window (100 ms) and the session's settle debounce (300 ms).
    await vi.advanceTimersByTimeAsync(1000);
    const result = session.stop();

    expect(result.exportData.transitions.map((t) => t.actionType)).toEqual(['check']);
    expect(result.interactionCount).toBe(1);
    expect(result.variables).toEqual([]);
  });
});
