/**
 * ARMING — plan 2026-10-13-image-generation-and-visual-judgment, Phase 5.
 *
 * The phase's arming line: `find {mediaOnly: true}` over the relay returns only
 * media rows, each with a scrubbed top-level `mediaMetadata` carrying the
 * observation envelope. This test enters where that population enters: the
 * browser half of the relay. `useCommandRelay` starts the relay client, which
 * receives the command over the fetch-streamed SSE channel exactly as the
 * runner's `/ui-bridge/sdk/*` proxy delivers it, dispatches it, and POSTs the
 * answer back — and the assertion reads that POSTed answer.
 *
 * It imports only modules that exist before Phase 5, so with the phase's
 * production hunks reverted it fails on its assertion (the relay ignored
 * `mediaOnly` and returned the button too), never on an import.
 */

import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { getGlobalRegistry } from '../core/registry';
import { useCommandRelay } from './useCommandRelay';

vi.mock('./useUIBridge', () => ({
  useUIBridge: () => ({ elements: [], getElement: () => undefined, components: [], workflows: [] }),
}));
vi.mock('./UIBridgeProvider', () => ({ useUIBridgeOptional: () => null }));

const SECRET = 'SECRET123';

type Row = {
  id: string;
  category?: string;
  mediaMetadata?: { status?: string; value?: { src?: string } };
};

/** A measured media observation over `value`, the envelope every row now carries. */
function observed(value: Record<string, unknown>) {
  const at = new Date().toISOString();
  return {
    status: 'measured',
    value: {
      mediaType: 'image',
      isDecorative: false,
      renderedWidth: 10,
      renderedHeight: 10,
      loadingState: 'loaded',
      ...value,
    },
    provenance: {
      producer: { id: 'test/media', version: '0' },
      observedAt: at,
      evaluatedAt: at,
      coverage: { considered: 1, measured: 1, unmeasured: [] },
      confidence: null,
      cache: null,
      source: null,
    },
  };
}

const posted: Array<{ commandId: string; success: boolean; result: { elements: Row[] } }> = [];

/**
 * The relay server, as seen from the tab: one queued command on the SSE
 * stream (left open — a closed stream reconnects and re-delivers), and a POST
 * endpoint that records the tab's answer.
 */
function relayServing(command: Record<string, unknown>) {
  const encoder = new TextEncoder();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/commands/stream')) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(command)}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.endsWith('/commands') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
    }
    return new Response('{}', { status: 200 });
  });
}

/** A tab running the relay listener — what an instrumented app mounts. */
function RelayTab() {
  useCommandRelay({ basePath: '/relay', heartbeatInterval: 3_600_000, disablePhoneHome: true });
  return null;
}

beforeEach(() => {
  posted.length = 0;
  const registry = getGlobalRegistry();

  const button = document.createElement('button');
  button.textContent = 'Save';
  document.body.appendChild(button);
  registry.registerElement('save', button, { type: 'button', actions: ['click'], label: 'Save' });

  const logo = document.createElement('img');
  document.body.appendChild(logo);
  const logoObs = observed({ src: 'https://cdn.example/logo.png', altText: 'Logo' });
  registry.registerMediaElement('media-public', logo, {
    mediaType: 'image',
    mediaMetadata: logoObs as never,
    label: 'Logo',
    refreshMetadata: () => logoObs as never,
  });

  const boundary = document.createElement('section');
  boundary.setAttribute('data-bridge-redact', 'true');
  document.body.appendChild(boundary);
  const qr = document.createElement('img');
  boundary.appendChild(qr);
  const qrObs = observed({
    src: `https://cdn.example/totp?token=${SECRET}`,
    altText: `QR ${SECRET}`,
  });
  registry.registerMediaElement('media-secret', qr, {
    mediaType: 'image',
    mediaMetadata: qrObs as never,
    label: 'QR code',
    refreshMetadata: () => qrObs as never,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  getGlobalRegistry().clear();
  document.body.innerHTML = '';
});

it('a relay find for mediaOnly answers only media rows, each with a scrubbed observation', async () => {
  vi.stubGlobal(
    'fetch',
    relayServing({
      commandId: 'cmd-1',
      action: 'find',
      payload: { mediaOnly: true, skipSettle: true },
    })
  );

  render(<RelayTab />);
  await waitFor(() => expect(posted.length).toBe(1), { timeout: 5000 });

  const reply = posted[0];
  expect(reply.commandId).toBe('cmd-1');
  expect(reply.success).toBe(true);
  const rows = reply.result.elements;
  expect(rows.map((r) => r.id).sort()).toEqual(['media-public', 'media-secret']);
  for (const row of rows) {
    expect(row.category).toBe('media');
    expect(row.mediaMetadata?.status).toBe('measured');
  }
  const secretRow = rows.filter((r) => r.id === 'media-secret')[0];
  expect(secretRow.mediaMetadata?.value?.src).toBe('[REDACTED]');
  // Nowhere in the answer — not in `state`, not in a label.
  expect(JSON.stringify(reply).toLowerCase()).not.toContain(SECRET.toLowerCase());
});
