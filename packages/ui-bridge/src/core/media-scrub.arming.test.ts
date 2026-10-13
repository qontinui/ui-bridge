/**
 * ARMING — plan 2026-10-13-image-generation-and-visual-judgment, Phase 5.
 *
 * Enters where every snapshot consumer's population enters: the snapshot
 * serializer, `serializeRegisteredElement`, over a media element registered
 * the way the scanners register one — with a refresh callback. Before Phase 5
 * the registry's refresh override wrote the RAW capture into
 * `state.mediaMetadata`, which the serializer ships beside its scrubbed
 * top-level copy, so a media element inside a `data-bridge-redact` boundary
 * leaked its src / srcset / alt / poster through `state`.
 *
 * It imports only modules that exist before Phase 5, so with the phase's
 * production hunks reverted it fails on its assertion, never on an import.
 */

import { it, expect, afterEach } from 'vitest';
import { UIBridgeRegistry, serializeRegisteredElement } from './registry';

const SECRET = 'SECRET123';

/** A measured media observation carrying secret URL and text fields. */
function secretObservation() {
  const at = new Date().toISOString();
  return {
    status: 'measured',
    value: {
      mediaType: 'video',
      src: `https://cdn.example/clip.mp4?token=${SECRET}`,
      srcset: `https://cdn.example/clip-2x.mp4?token=${SECRET} 2x`,
      altText: `recording of ${SECRET}`,
      isDecorative: false,
      renderedWidth: 320,
      renderedHeight: 180,
      loadingState: 'loaded',
      videoState: {
        poster: `data:image/png;base64,${SECRET}`,
        currentTime: 0,
        duration: 30,
        paused: true,
        muted: true,
      },
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

afterEach(() => {
  document.body.innerHTML = '';
});

it('a redacted media element ships no secret in its snapshot entry, in state or at top level', () => {
  const boundary = document.createElement('section');
  boundary.setAttribute('data-bridge-redact', 'true');
  document.body.appendChild(boundary);
  const video = document.createElement('video');
  boundary.appendChild(video);

  const registry = new UIBridgeRegistry();
  registry.registerMediaElement('media-clip', video, {
    mediaType: 'video',
    mediaMetadata: secretObservation() as never,
    label: 'Recording',
    refreshMetadata: () => secretObservation() as never,
  });

  const entry = serializeRegisteredElement(registry.getElement('media-clip')!) as unknown as {
    mediaMetadata?: { status?: string; value?: { src?: string } };
    state: {
      mediaMetadata?: {
        status?: string;
        value?: { src?: string; videoState?: { duration?: number } };
      };
    };
  };

  expect(JSON.stringify(entry).toLowerCase()).not.toContain(SECRET.toLowerCase());
  // Scrubbed, not dropped: the observation and its structural facts survive.
  expect(entry.state.mediaMetadata?.status).toBe('measured');
  expect(entry.state.mediaMetadata?.value?.src).toBe('[REDACTED]');
  expect(entry.state.mediaMetadata?.value?.videoState?.duration).toBe(30);
  expect(entry.mediaMetadata?.value?.src).toBe('[REDACTED]');
});
