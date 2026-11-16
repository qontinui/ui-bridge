/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getActiveOverlays, installFrameworkOverlayCapture } from './framework-overlays';
import { REDACTED_VALUE } from '../../core/redaction';
import type { AnyCapturedEvent } from '../browser-capture-types';

const SECRET = 'SECRET-overlay-4471';

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * §4.6: overlay text is returned by `getActiveOverlays` (snapshot enrichment)
 * and emitted as a console capture event (the recording export), so a boundary
 * inside the overlay must read as the sentinel on both.
 */
describe('framework error overlays — redaction boundaries', () => {
  it('React error boundary: the boundary reads as the sentinel in the overlay and the event', () => {
    document.body.innerHTML = `<div data-react-error-boundary>Boom <span data-bridge-redact="true">${SECRET}</span></div>`;
    const overlays = getActiveOverlays();
    expect(overlays).toHaveLength(1);
    expect(overlays[0].message).toBe(`Boom ${REDACTED_VALUE}`);
    expect(JSON.stringify(overlays)).not.toContain(SECRET);

    const events: AnyCapturedEvent[] = [];
    const stop = installFrameworkOverlayCapture((e) => events.push(e));
    stop();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).toContain(REDACTED_VALUE);
  });

  it('Vite overlay (no shadow root): title, message and file collapse the boundary', () => {
    document.body.innerHTML =
      `<vite-error-overlay>` +
      `<h1><span data-bridge-redact="true">${SECRET}-title</span></h1>` +
      `<pre><span data-bridge-redact="true">${SECRET}-msg</span></pre>` +
      `</vite-error-overlay>`;
    const overlays = getActiveOverlays();
    expect(overlays).toHaveLength(1);
    expect(overlays[0].title).toBe(REDACTED_VALUE);
    expect(overlays[0].message).toBe(REDACTED_VALUE);
    expect(JSON.stringify(overlays)).not.toContain(SECRET);
  });

  it('Next.js build error overlay collapses the boundary', () => {
    document.body.innerHTML = `<div id="__next-build-error">Build failed <b data-bridge-redact="true">${SECRET}</b></div>`;
    const overlays = getActiveOverlays();
    expect(overlays[0].message).toBe(`Build failed ${REDACTED_VALUE}`);
    expect(JSON.stringify(overlays)).not.toContain(SECRET);
  });

  it('an overlay wholly inside a boundary reads as the sentinel', () => {
    document.body.innerHTML = `<div data-bridge-redact="true"><div data-react-error-boundary>${SECRET}</div></div>`;
    const overlays = getActiveOverlays();
    expect(JSON.stringify(overlays)).not.toContain(SECRET);
  });

  it('a cut through the sentinel drops it whole, in the overlay and in the emitted event', () => {
    document.body.innerHTML = `<div data-react-error-boundary>${'a'.repeat(497)}<span data-bridge-redact="true">${SECRET}</span></div>`;
    const overlays = getActiveOverlays();
    expect(overlays[0].message).toBe(`${'a'.repeat(497)}...`);

    document.body.innerHTML = `<div data-react-error-boundary>${'b'.repeat(195)}<span data-bridge-redact="true">${SECRET}</span></div>`;
    const events: AnyCapturedEvent[] = [];
    const stop = installFrameworkOverlayCapture((e) => events.push(e));
    stop();
    const message = (events[0] as { message: string }).message;
    expect(message).not.toMatch(/\[R/);
    expect(message.endsWith(': ' + 'b'.repeat(195))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it('a shadow-hosted overlay whose host sits inside a boundary reads as the sentinel', () => {
    document.body.innerHTML = `<div data-bridge-redact="true"><nextjs-portal id="p"></nextjs-portal></div>`;
    const shadow = document.getElementById('p')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div data-nextjs-dialog><div data-nextjs-dialog-header><h1>${SECRET}-title</h1></div><div data-nextjs-dialog-body>${SECRET}-body</div></div>`;
    const overlays = getActiveOverlays();
    expect(overlays).toHaveLength(1);
    expect(overlays[0].message).toBe(REDACTED_VALUE);
    expect(JSON.stringify(overlays)).not.toContain(SECRET);
  });
});
