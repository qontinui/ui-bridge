// @vitest-environment node
/**
 * The exported request parsers are pure at CALL time, not only at load time:
 * a host with no DOM (the React Native server, a bare Node consumer of
 * `./specs`) can call `parseEvaluateRequest`, `parseDesignSnapshotRequest`
 * and `parseResponsiveSnapshotsRequest` with valid and invalid bodies and get
 * an answer, never `window is not defined`. The package default environment
 * is jsdom, so without the pragma above this file could not fail. Plan:
 * 2026-11-21-native-design-evaluate-snapshot-responsive-validate-through-the-shared-parsers.
 */

import { describe, expect, it } from 'vitest';
import {
  DesignRequestError,
  QualityRequestError,
  parseDesignSnapshotRequest,
  parseEvaluateRequest,
  parseResponsiveSnapshotsRequest,
} from '../index';

describe('request parsers without a DOM', () => {
  it('there is no DOM in this environment', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('parseEvaluateRequest answers a valid body and leaves the viewport to the caller', () => {
    const parsed = parseEvaluateRequest({ context: 'mobile', elementIds: ['a'] }, null);
    expect(parsed.context.name).toBe('mobile');
    expect(parsed.elementIds).toEqual(['a']);
    expect(parsed.viewport).toBeUndefined();
  });

  it('parseEvaluateRequest refuses an invalid body with INVALID_REQUEST', () => {
    expect(() => parseEvaluateRequest({ viewport: { width: 0 } }, null)).toThrow(
      new QualityRequestError(
        '/design/evaluate: viewport must be { width, height }, each a finite number greater than 0'
      )
    );
  });

  it('parseDesignSnapshotRequest answers valid and refuses invalid bodies', () => {
    expect(parseDesignSnapshotRequest({ limit: 2 })).toEqual({ limit: 2 });
    expect(() => parseDesignSnapshotRequest({ limit: 0 })).toThrow(
      new DesignRequestError('/design/snapshot: limit must be an integer >= 1')
    );
  });

  it('parseResponsiveSnapshotsRequest answers valid and refuses invalid bodies', () => {
    expect(parseResponsiveSnapshotsRequest({ viewports: [320] }).viewports).toEqual([320]);
    expect(() => parseResponsiveSnapshotsRequest({ viewports: [] })).toThrow(DesignRequestError);
  });
});
