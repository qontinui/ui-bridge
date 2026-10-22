/**
 * Type-level test for the `vision/capture` wire shape (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary, Phase 7).
 * Typechecked by `npm run typecheck` (tsconfig includes `.test-d.ts`; vitest
 * does not run it) — see `core/redaction.brand.test-d.ts` for the mechanism.
 *
 * A capture result names its bytes by `url`, never by a host file `path`. If
 * `path` is ever re-added, the `@ts-expect-error` below becomes unused and tsc
 * fails with TS2578.
 */

import type { VisionCaptureRequest, VisionCaptureResult, VisionRawRequest } from './wire';

const result: VisionCaptureResult = {
  url: '/ui-bridge/vision/cache/' + '0'.repeat(64),
  base64: 'AAAA',
  sha256: '0'.repeat(64),
  width: 1,
  height: 1,
  bytes: 3,
  format: 'jpeg',
  contract: 'claude_vision_v1',
};

// @ts-expect-error `path` was deleted: it named a file in the runner's checkout.
const removedPath: string = result.path;

// `url` is required; `base64` is optional (present only on `inline: true`).
// @ts-expect-error a capture result without `url` does not compile
const noUrl: VisionCaptureResult = {
  sha256: '',
  width: 0,
  height: 0,
  bytes: 0,
  format: 'png',
  contract: 'png_strict',
};
const inlineBytes: string | undefined = result.base64;

const captureReq: VisionCaptureRequest = { inline: true, element: 'x' };
const rawReq: VisionRawRequest = { inline: true, reason: 'audit' };

void removedPath;
void noUrl;
void inlineBytes;
void captureReq;
void rawReq;
