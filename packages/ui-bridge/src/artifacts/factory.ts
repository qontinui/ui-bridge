/**
 * Artifact Factory
 *
 * Creates immutable ResultArtifact records from execution results.
 */

import type { ResultArtifact, ArtifactSource, ArtifactEnvironment, ArtifactResult } from './types';
import { computeHash } from './hash';

/**
 * Create an immutable ResultArtifact from an execution result.
 * Computes the content-addressed artifactId from the result payload.
 */
export async function createArtifact(
  result: ArtifactResult,
  source: ArtifactSource,
  environment?: Partial<ArtifactEnvironment>
): Promise<ResultArtifact> {
  const now = new Date();

  const env: ArtifactEnvironment = {
    timestamp: now.getTime(),
    sdkVersion: '1.0.0',
    ...environment,
  };

  // Hash the result + source + environment for content addressing
  const hashPayload = { result, source, environment: env };
  const artifactId = await computeHash(hashPayload);

  return {
    artifactId,
    source,
    result,
    environment: env,
    createdAt: now.toISOString(),
    immutable: true,
  };
}

/**
 * Collect environment context from the current browser context.
 * Returns an empty object in non-browser environments.
 */
export function captureEnvironment(): Partial<ArtifactEnvironment> {
  if (typeof window === 'undefined') {
    return { timestamp: Date.now() };
  }

  return {
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    url: window.location.href,
    timestamp: Date.now(),
  };
}
