/**
 * Stuck Screen Detector
 *
 * On-demand diagnostic that determines whether an application is stuck on a
 * loading screen. Works by taking two snapshots separated by an observation
 * window and comparing signals: if loading indicators are present but the DOM
 * hasn't changed and the network is idle, the app is stuck.
 *
 * This is general-purpose — it does not know about any specific app. It relies
 * on the existing LoadingIndicatorDetector, DOMSettlingDetector, and
 * NetworkIdleDetector signals via the CompositeIdleDetector.
 */

import type { CompositeIdleDetector } from './composite-idle';
import type {
  StuckScreenConfig,
  StuckScreenDiagnosis,
  StuckScreenEvidence,
  StuckVerdict,
  LoadingIndicatorSignalStatus,
  DOMSignalStatus,
  NetworkSignalStatus,
  DetectedLoadingIndicator,
} from './types';

interface SignalSnapshot {
  loadingIndicators: DetectedLoadingIndicator[];
  /** Whether the DOM has been quiet for the settling period */
  domSettled: boolean;
  /** Number of DOM mutations in the last 1s window (rolling count) */
  recentDOMMutations: number;
  networkIdle: boolean;
  pendingNetworkRequests: number;
  idleScore: number;
  timestamp: number;
}

export class StuckScreenDetector {
  private detector: CompositeIdleDetector;
  private observationWindowMs: number;
  private domMutationThreshold: number;

  constructor(detector: CompositeIdleDetector, config: StuckScreenConfig = {}) {
    this.detector = detector;
    this.observationWindowMs = config.observationWindowMs ?? 3000;
    this.domMutationThreshold = config.domMutationThreshold ?? 3;
  }

  /**
   * Run a stuck-screen diagnosis.
   *
   * Takes two snapshots separated by the observation window and compares them
   * to determine if the app is stuck, loading normally, idle, or in an
   * ambiguous state.
   */
  async diagnose(): Promise<StuckScreenDiagnosis> {
    // Phase 1: initial snapshot
    const snap1 = this.captureSnapshot();

    // Wait for observation window
    await new Promise<void>((resolve) => setTimeout(resolve, this.observationWindowMs));

    // Phase 2: second snapshot
    const snap2 = this.captureSnapshot();

    const actualWindowMs = snap2.timestamp - snap1.timestamp;

    // Build evidence
    // DOM is "changing" if either snapshot saw recent mutations above threshold,
    // or the DOM was not settled at either point. recentDOMMutations is a 1s
    // sliding window count, so we check both snapshots to avoid missing activity
    // that happened to fall between windows.
    const peakMutations = Math.max(snap1.recentDOMMutations, snap2.recentDOMMutations);
    const domChanged =
      peakMutations >= this.domMutationThreshold || !snap1.domSettled || !snap2.domSettled;

    const evidence: StuckScreenEvidence = {
      loadingIndicators: snap2.loadingIndicators,
      domChanged,
      domMutationCount: peakMutations,
      networkBusy: !snap2.networkIdle,
      pendingNetworkRequests: snap2.pendingNetworkRequests,
      idleScoreStart: snap1.idleScore,
      idleScoreEnd: snap2.idleScore,
    };

    // Determine verdict
    const hasLoadingIndicators =
      snap1.loadingIndicators.length > 0 && snap2.loadingIndicators.length > 0;
    const hadLoadingIndicators =
      snap1.loadingIndicators.length > 0 || snap2.loadingIndicators.length > 0;

    let verdict: StuckVerdict;
    let confidence: number;
    let summary: string;
    const suggestions: string[] = [];

    if (!hadLoadingIndicators) {
      // No loading indicators at either point — app is idle
      verdict = 'idle';
      confidence = 0.9;
      summary = 'No loading indicators detected. The app appears to be in a normal resting state.';
    } else if (hasLoadingIndicators && !domChanged && snap2.networkIdle) {
      // Loading indicators present at BOTH points, DOM static, network idle — stuck
      verdict = 'stuck';
      confidence = 0.95;
      const indicatorDesc = this.describeIndicators(snap2.loadingIndicators);
      summary =
        `The app appears stuck. Loading indicators (${indicatorDesc}) have been ` +
        `visible throughout the ${Math.round(actualWindowMs / 1000)}s observation window ` +
        `with no meaningful DOM changes and no pending network requests.`;
      suggestions.push('Try refreshing the page.');
      suggestions.push('Check the browser console for JavaScript errors.');
      suggestions.push('Check if a required backend service is running.');
    } else if (hasLoadingIndicators && !domChanged && !snap2.networkIdle) {
      // Loading indicators present, DOM static, but network busy — might be waiting on a hung request
      verdict = 'stuck';
      confidence = 0.7;
      summary =
        `The app appears stuck. Loading indicators are visible with no DOM changes, ` +
        `but ${snap2.pendingNetworkRequests} network request(s) are still in flight. ` +
        `A network request may be hanging.`;
      suggestions.push('Check if a network request is hanging (e.g., unresponsive API server).');
      suggestions.push('Check the network tab for requests that have been pending too long.');
      suggestions.push('Verify the server or API endpoint is reachable.');
    } else if (hadLoadingIndicators && domChanged) {
      // Loading indicators present but DOM is changing — normal loading
      verdict = 'loading';
      confidence = 0.85;
      summary =
        `The app is loading. Loading indicators are visible and the DOM is actively ` +
        `changing (${peakMutations} recent mutations), indicating content is being rendered.`;
    } else if (!hasLoadingIndicators && hadLoadingIndicators) {
      // Loading indicators appeared then disappeared — just finished loading
      verdict = 'idle';
      confidence = 0.8;
      summary =
        'Loading indicators were present at the start but cleared during observation. ' +
        'The app has finished loading.';
    } else {
      verdict = 'unknown';
      confidence = 0.4;
      summary =
        'The app state is ambiguous. Signals do not clearly indicate stuck, loading, or idle.';
      suggestions.push('Try running the diagnosis again with a longer observation window.');
    }

    return {
      verdict,
      confidence,
      summary,
      evidence,
      observationWindowMs: actualWindowMs,
      suggestions,
      timestamp: Date.now(),
    };
  }

  private captureSnapshot(): SignalSnapshot {
    const compositeStatus = this.detector.getStatus();

    // Extract individual signal statuses
    const loadingSig = compositeStatus.signals['loading-indicators'];
    const domSig = compositeStatus.signals['dom'];
    const networkSig = compositeStatus.signals['network'];

    const loadingStatus = loadingSig?.status as LoadingIndicatorSignalStatus | undefined;
    const domStatus = domSig?.status as DOMSignalStatus | undefined;
    const networkStatus = networkSig?.status as NetworkSignalStatus | undefined;

    return {
      loadingIndicators: loadingStatus?.indicators ?? [],
      domSettled: domSig?.idle ?? true,
      recentDOMMutations: domStatus?.recentMutationCount ?? 0,
      networkIdle: networkSig?.idle ?? true,
      pendingNetworkRequests: networkStatus?.pendingCount ?? 0,
      idleScore: compositeStatus.idleScore,
      timestamp: Date.now(),
    };
  }

  private describeIndicators(indicators: DetectedLoadingIndicator[]): string {
    if (indicators.length === 0) return 'none';
    const descriptions = indicators.slice(0, 3).map((ind) => {
      if (ind.type === 'animation') return `animation "${ind.details}"`;
      if (ind.type === 'cursor') return `cursor: ${ind.details}`;
      if (ind.selector) return ind.selector;
      return ind.element ?? ind.type;
    });
    const suffix = indicators.length > 3 ? ` +${indicators.length - 3} more` : '';
    return descriptions.join(', ') + suffix;
  }
}
