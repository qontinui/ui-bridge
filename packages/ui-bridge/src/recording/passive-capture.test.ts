/**
 * Passive real-session capture — the SDK half of
 * `POST /apps/{app_id}/journey/observe` (plan
 * 2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time,
 * Phase 3).
 *
 * Pins: one relay per human interaction, in the runner's CLOSED body shape
 * (qontinui-runner `journey/observe.rs` `PassiveInteraction`); no typed value
 * on the wire — and the value is never even read; an agent's action is not
 * recorded as a human's, including the TRUSTED events the browser fires as its
 * consequence; relays only when the runner admits the page; nothing relays
 * after `stop()`, after a 403, or past the in-flight cap; a refused or failed
 * relay never throws and is counted per mount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIBridgeRegistry, getGlobalRegistry } from '../core/registry';
import { requestFormSubmit } from '../control/action-executor';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';
import {
  __clearPassiveCaptureStatusForTest,
  admissionFromRegistration,
  buildObservation,
  getPassiveCaptureStatuses,
  isObserveIdentifier,
  observeUrl,
  startPassiveCapture,
  PASSIVE_CAPTURE_MAX_IN_FLIGHT,
  PASSIVE_CAPTURE_RELAY_TIMEOUT_MS,
  PASSIVE_CAPTURE_BODY_READ_TIMEOUT_MS,
  type PassiveCaptureAdmission,
  type PassiveCaptureHandle,
  type PassiveCaptureOptions,
} from './passive-capture';

const SENTINEL = 's3ntinel-typed-secret';
const ELEMENT_TEXT = 'Account of Jane Q Public';
const RUNNER = 'http://127.0.0.1:9876';
const APP = 'localhost:3001';
const OBSERVE = `${RUNNER}/apps/localhost%3A3001/journey/observe`;
/** observe.rs `PassiveInteraction` — `deny_unknown_fields`. */
const RUNNER_FIELDS = ['actionType', 'appVersion', 'sessionId', 'tabId', 'targetElementId'];

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bodies(fetchMock: FetchMock): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(
    ([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
  );
}

/** jsdom has no layout; the relay's visibility gate reads offsetParent. */
function visible<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
  return el;
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('passive capture', () => {
  let registry: UIBridgeRegistry;
  let button: HTMLButtonElement;
  let input: HTMLInputElement;
  let fetchMock: FetchMock;
  let handles: PassiveCaptureHandle[];
  let warn: ReturnType<typeof vi.fn>;
  let handle: PassiveCaptureHandle;

  const start = (over: Partial<PassiveCaptureOptions> = {}) => {
    handle = startPassiveCapture({
      registry,
      runnerUrl: RUNNER,
      appId: APP,
      tabId: 'tab-1',
      admission: () => 'admitted',
      // jsdom marks every scripted event untrusted; these tests stand in for
      // a human unless they test the default.
      isHumanEvent: () => true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      keystrokeCoalesceMs: 50,
      warn,
      ...over,
    });
    handles.push(handle);
    return handle;
  };

  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    __clearPassiveCaptureStatusForTest();
    registry = new UIBridgeRegistry();
    button = document.createElement('button');
    button.textContent = ELEMENT_TEXT;
    input = document.createElement('input');
    input.type = 'text';
    document.body.append(button, input);
    registry.registerElement('open-account', button);
    registry.registerElement('search-box', input);
    fetchMock = vi.fn(async () => jsonResponse(202, { recorded: true }));
    warn = vi.fn();
    handles = [];
  });

  afterEach(() => {
    for (const h of handles) h.stop();
    document.body.innerHTML = '';
    getGlobalRegistry().clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('relays each human interaction once, in the runner body shape, to the observe route', async () => {
    start({ appVersion: '1.4.0+g3f2a' });
    button.click();
    button.click();
    button.click();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OBSERVE);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const [body] = bodies(fetchMock);
    expect(body).toEqual({
      actionType: 'click',
      targetElementId: 'open-account',
      tabId: 'tab-1',
      sessionId: expect.stringMatching(/^passive-/),
      appVersion: '1.4.0+g3f2a',
    });
    for (const b of bodies(fetchMock)) {
      expect(isObserveIdentifier(b.sessionId)).toBe(true);
      expect(isObserveIdentifier(b.tabId)).toBe(true);
    }
    expect(handle.status()).toMatchObject({ state: 'active', relayed: 3, refused: 0, failed: 0 });
  });

  it("the body's keys are exactly the runner's closed set — nothing else is on the wire", async () => {
    start({ appVersion: '1.0.0' });
    button.click();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(60);
    await settle();

    expect(bodies(fetchMock)).toHaveLength(2);
    for (const b of bodies(fetchMock)) expect(Object.keys(b).sort()).toEqual(RUNNER_FIELDS);
  });

  it('relays no typed value and no text field — and never reads the typed value', async () => {
    let valueReads = 0;
    const proto = Object.getPrototypeOf(input) as HTMLInputElement;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        valueReads++;
        return desc.get!.call(this);
      },
      set(v: string) {
        desc.set!.call(this, v);
      },
    });
    start();

    input.value = SENTINEL;
    valueReads = 0;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(60); // past the coalescing window
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    button.click();
    await settle();

    const wire = fetchMock.mock.calls.map(([, init]) => String((init as RequestInit).body));
    expect(wire.length).toBe(3); // type, Enter-as-submit, click
    expect(bodies(fetchMock).map((b) => b.actionType)).toEqual(['type', 'submit', 'click']);
    for (const w of wire) {
      expect(w).not.toContain(SENTINEL);
      // The element's text content is not a field; its id is the registry id.
      expect(w).not.toContain(ELEMENT_TEXT);
    }
    expect(valueReads).toBe(0);
  });

  it('a human checkbox toggle is ONE interaction (check), not also a type', async () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.append(cb);
    registry.registerElement('agree', cb);
    start();
    cb.click(); // fires input + change (trusted in a browser)
    await settle();
    expect(bodies(fetchMock).map((b) => b.actionType)).toEqual(['check']);
  });

  it('does not relay untrusted events by default, and counts them as events', async () => {
    start({ isHumanEvent: undefined });
    button.click(); // jsdom: isTrusted === false
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(handle.status().skippedSyntheticEvents).toBe(1);
  });

  describe("an agent's action is not recorded as a human's (default isHumanEvent)", () => {
    // These run with the DEFAULT human-event predicate (`isTrusted`). jsdom,
    // like a browser, fires TRUSTED `submit` / `input` / `change` as the
    // consequence of requestSubmit() and of a click on a checkbox or a submit
    // button — exactly what an agent's relayed action does.
    let form: HTMLFormElement;
    let checkbox: HTMLInputElement;
    let submitButton: HTMLButtonElement;

    // The command's post-action waits run on (fake) timers.
    const runCommand = async (action: string) => {
      const pending = executeCommand(
        'executeElementAction',
        { id: 'send', request: { action } },
        emptyBridge
      );
      await vi.advanceTimersByTimeAsync(10_000);
      return pending;
    };

    beforeEach(() => {
      form = document.createElement('form');
      form.addEventListener('submit', (e) => e.preventDefault());
      checkbox = visible(document.createElement('input'));
      checkbox.type = 'checkbox';
      submitButton = visible(document.createElement('button'));
      submitButton.type = 'submit';
      form.append(checkbox, submitButton);
      document.body.append(form);
      const g = getGlobalRegistry();
      g.registerElement('signup-form', form);
      g.registerElement('agree', checkbox, { type: 'checkbox' });
      g.registerElement('send', submitButton, { type: 'button' });
      start({ registry: g, isHumanEvent: undefined });
    });

    it('the control path: requestFormSubmit (requestSubmit) fires a trusted submit — suppressed', async () => {
      expect(requestFormSubmit(form, submitButton)).toBeNull();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(handle.status().suppressedSdkActionEvents).toBeGreaterThanOrEqual(1);
    });

    it('a relayed click on a checkbox fires a trusted change — suppressed', async () => {
      const r = (await executeCommand(
        'executeElementAction',
        { id: 'agree', request: { action: 'click' } },
        emptyBridge
      )) as { success?: boolean };
      expect(r.success).toBe(true);
      expect(checkbox.checked).toBe(true);
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(handle.status().suppressedSdkActionEvents).toBeGreaterThanOrEqual(1);
    });

    it('a relayed click on a submit button fires a trusted submit — suppressed', async () => {
      let submitted = 0;
      form.addEventListener('submit', () => submitted++);
      await runCommand('click');
      expect(submitted).toBe(1);
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a relayed submit action (requestSubmit) — suppressed', async () => {
      let submitted = 0;
      form.addEventListener('submit', () => submitted++);
      await runCommand('submit');
      expect(submitted).toBe(1);
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('positive control: the same trusted events OUTSIDE an SDK action are relayed', async () => {
      form.requestSubmit(); // trusted submit, as a human pressing Enter
      checkbox.click(); // trusted change, as a human ticking it
      await settle();
      expect(bodies(fetchMock).map((b) => b.actionType)).toEqual(['submit', 'check']);
    });
  });

  it('ignores interactions on unregistered elements', async () => {
    start();
    const loose = document.createElement('button');
    document.body.append(loose);
    loose.click();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('relays nothing after stop(), including a keystroke buffer the stop flushes', async () => {
    start();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    handle.stop();
    button.click();
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(handle.status().state).toBe('stopped');
    expect(getPassiveCaptureStatuses()).toEqual([]);
  });

  describe('admission', () => {
    const cases: Array<
      [PassiveCaptureAdmission, keyof ReturnType<PassiveCaptureHandle['status']>]
    > = [
      ['not_admitted', 'skippedNotAdmitted'],
      ['admission_unknown', 'skippedNotAdmitted'],
      ['unregistered', 'skippedUnregistered'],
    ];
    for (const [admission, counter] of cases) {
      it(`relays nothing while ${admission}, and says so`, async () => {
        start({ admission: () => admission });
        button.click();
        await settle();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(handle.status()).toMatchObject({ admission, [counter]: 1 });
      });
    }

    it('defaults to admission_unknown — nothing relays until admitted', async () => {
      start({ admission: undefined });
      button.click();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(handle.status().admission).toBe('admission_unknown');
    });

    it('follows the admission live', async () => {
      let a: PassiveCaptureAdmission = 'unregistered';
      start({ admission: () => a });
      button.click();
      a = 'admitted';
      button.click();
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // These bodies model the runner's PENDING `journeyObserve` field: no runner
    // build emits it yet (a follow-up stacked on qontinui-runner#2438).
    it('reads journeyObserve.admitted from the registration answer, envelope or top level', () => {
      const env = (admitted: unknown) => ({
        success: true,
        data: { journeyObserve: { admitted } },
      });
      expect(admissionFromRegistration(env(true))).toBe('admitted');
      expect(admissionFromRegistration(env(false))).toBe('not_admitted');
      expect(admissionFromRegistration({ journeyObserve: { admitted: true } })).toBe('admitted');
      expect(admissionFromRegistration({ success: true, data: {} })).toBe('admission_unknown');
      expect(admissionFromRegistration(env('yes'))).toBe('admission_unknown');
      expect(admissionFromRegistration(undefined)).toBe('admission_unknown');
    });
  });

  it('stops relaying for the mount on a 403, and records the refusal', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(403, { code: 'CROSS_ORIGIN_REFUSED' }));
    start();
    button.click();
    await settle();
    button.click();
    button.click();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const s = handle.status();
    expect(s).toMatchObject({
      state: 'disabled',
      refused: 1,
      lastRefusalStatus: 403,
      lastRefusalReason: 'CROSS_ORIGIN_REFUSED',
    });
    expect(s.disabledReason).toContain('403');
    // Still listed: a disabled mount is how the refusal stays observable.
    expect(getPassiveCaptureStatuses()).toHaveLength(1);
  });

  it(`caps in-flight relays at ${PASSIVE_CAPTURE_MAX_IN_FLIGHT} and counts the excess`, async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async () => {
      await gate;
      return jsonResponse(202, {});
    });
    start();
    for (let i = 0; i < PASSIVE_CAPTURE_MAX_IN_FLIGHT + 2; i++) button.click();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(PASSIVE_CAPTURE_MAX_IN_FLIGHT);
    expect(handle.status().droppedInFlightCap).toBe(2);

    release();
    await settle();
    button.click();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(PASSIVE_CAPTURE_MAX_IN_FLIGHT + 1);
  });

  it('releases the slot when the HEADERS arrive — a runner stalling its body holds none', async () => {
    // A refusal whose body never ends: headers arrive, the stream never closes.
    fetchMock.mockImplementation(
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    start();
    for (let i = 0; i < PASSIVE_CAPTURE_MAX_IN_FLIGHT; i++) button.click();
    await settle();
    expect(handle.status()).toMatchObject({ refused: PASSIVE_CAPTURE_MAX_IN_FLIGHT });

    // Every body is still unread, yet the slots are free.
    button.click();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(PASSIVE_CAPTURE_MAX_IN_FLIGHT + 1);
    expect(handle.status().droppedInFlightCap).toBe(0);

    // And the reason read gives up rather than pending for ever.
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PASSIVE_CAPTURE_BODY_READ_TIMEOUT_MS);
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(handle.status()).toMatchObject({ lastRefusalStatus: 503, lastRefusalReason: undefined });
  });

  it('abandons a relay the runner never answers, counts it failed and frees its slot', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    start();
    for (let i = 0; i < PASSIVE_CAPTURE_MAX_IN_FLIGHT; i++) button.click();
    await settle();
    button.click();
    expect(handle.status().droppedInFlightCap).toBe(1);

    await vi.advanceTimersByTimeAsync(PASSIVE_CAPTURE_RELAY_TIMEOUT_MS);
    await settle();
    expect(handle.status()).toMatchObject({ failed: PASSIVE_CAPTURE_MAX_IN_FLIGHT });
    expect(handle.status().lastFailure).toContain('no answer from the runner');

    button.click();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(PASSIVE_CAPTURE_MAX_IN_FLIGHT + 1);
  });

  it('reports every live mount; stopping one does not hide another', async () => {
    const first = start();
    const second = start({ appId: 'localhost:3002' });
    first.stop();
    const live = getPassiveCaptureStatuses();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      mountId: second.status().mountId,
      appId: 'localhost:3002',
      state: 'active',
    });
  });

  it('a relay that fails never throws into the app; it is counted and warned once', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    start();
    expect(() => {
      button.click();
      button.click();
    }).not.toThrow();
    await settle();

    const [s] = getPassiveCaptureStatuses();
    expect(s.failed).toBe(2);
    expect(s.relayed).toBe(0);
    expect(s.lastFailure).toBe('Failed to fetch');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a fetch that throws synchronously is counted, not thrown', async () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('sync boom');
    });
    start();
    expect(() => button.click()).not.toThrow();
    await settle();
    expect(handle.status()).toMatchObject({ failed: 1, lastFailure: 'sync boom' });
  });

  it('a runner refusal is counted with its status and fixed-phrase reason', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(429, {
        error: 'the journey queue is down to its reserve for agent and explorer events',
      })
    );
    start();
    button.click();
    await settle();

    expect(handle.status()).toMatchObject({
      state: 'active',
      refused: 1,
      relayed: 0,
      lastRefusalStatus: 429,
      lastRefusalReason: 'the journey queue is down to its reserve for agent and explorer events',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a throwing warn logger does not reach the app', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(503, { error: 'x' }));
    start({
      warn: () => {
        throw new Error('logger down');
      },
    });
    button.click();
    await settle();
    expect(handle.status().refused).toBe(1);
  });

  it("refuses to start for the runner's own webview and for a non-identifier app id", async () => {
    start({ appId: 'QONTINUI-RUNNER' });
    button.click();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handle.status().state).toBe('disabled');

    start({ appId: '[::1]:3001' });
    button.click();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handle.status()).toMatchObject({ state: 'disabled', appId: '[::1]:3001' });
  });

  it('drops a non-identifier app version or tab id rather than have every relay refused', async () => {
    start({ appVersion: '1.0 / search?q=x', tabId: 'a b/c' });
    button.click();
    await settle();

    const [body] = bodies(fetchMock);
    expect(body).not.toHaveProperty('appVersion');
    expect(body).not.toHaveProperty('tabId');
    expect(handle.status().droppedIds).toEqual(['tabId', 'appVersion']);
  });
});

describe('buildObservation', () => {
  it('copies only allowlisted fields — never value or the element', () => {
    const el = document.createElement('input');
    el.value = SENTINEL;
    const event = {
      actionType: 'type' as const,
      targetElementId: 'q',
      targetElement: el,
      value: SENTINEL,
      timestamp: 1,
    };
    const body = buildObservation(event as Parameters<typeof buildObservation>[0], {
      tabId: 't',
      sessionId: 's',
    });
    expect(body).toEqual({ actionType: 'type', targetElementId: 'q', tabId: 't', sessionId: 's' });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  });

  it('omits the target for navigate, as the runner reads it', () => {
    expect(buildObservation({ actionType: 'navigate', targetElementId: 'x' }, {})).toEqual({
      actionType: 'navigate',
    });
  });

  it('builds the observe URL with an encoded app id and no doubled slash', () => {
    expect(observeUrl('http://127.0.0.1:9876/', 'localhost:3001')).toBe(OBSERVE);
  });

  it('mirrors the runner identifier alphabet and length bound', () => {
    expect(isObserveIdentifier('rec-2026-10-28:abc_1')).toBe(true);
    expect(isObserveIdentifier('1.4.0+g3f2a')).toBe(true);
    expect(isObserveIdentifier('')).toBe(false);
    expect(isObserveIdentifier('my password is hunter2')).toBe(false);
    expect(isObserveIdentifier('a'.repeat(129))).toBe(false);
    expect(isObserveIdentifier('a'.repeat(128))).toBe(true);
  });
});
