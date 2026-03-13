/**
 * Memory Trend Analyzer
 *
 * Analyzes memory snapshots over time to detect leaks and growth trends.
 * Not a capture — an analyzer that consumes memory capture events.
 */

export interface MemoryTrendResult {
  trend: 'stable' | 'growing' | 'critical';
  /** Bytes per second growth rate */
  growthRate: number;
  /** Count of consecutive snapshots where heap usage increased */
  consecutiveGrowth: number;
  /** Percentage of heap limit currently in use (0-1) */
  heapUsagePercent: number;
}

interface MemorySnapshot {
  timestamp: number;
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const MAX_SNAPSHOTS = 20;
const CONSECUTIVE_GROWTH_THRESHOLD = 5;
const CRITICAL_HEAP_USAGE = 0.85;

export class MemoryTrendAnalyzer {
  private snapshots: MemorySnapshot[] = [];
  private latestTrend: MemoryTrendResult | null = null;

  addSnapshot(
    timestamp: number,
    usedJSHeapSize: number,
    jsHeapSizeLimit: number,
  ): MemoryTrendResult {
    this.snapshots.push({ timestamp, usedJSHeapSize, jsHeapSizeLimit });

    // Keep rolling window
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS);
    }

    const result = this.analyze();
    this.latestTrend = result;
    return result;
  }

  getLatestTrend(): MemoryTrendResult | null {
    return this.latestTrend;
  }

  reset(): void {
    this.snapshots = [];
    this.latestTrend = null;
  }

  private analyze(): MemoryTrendResult {
    const snaps = this.snapshots;
    if (snaps.length === 0) {
      return { trend: 'stable', growthRate: 0, consecutiveGrowth: 0, heapUsagePercent: 0 };
    }

    const latest = snaps[snaps.length - 1];
    const heapUsagePercent = latest.jsHeapSizeLimit > 0
      ? latest.usedJSHeapSize / latest.jsHeapSizeLimit
      : 0;

    // Count consecutive growth from the end
    let consecutiveGrowth = 0;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i].usedJSHeapSize > snaps[i - 1].usedJSHeapSize) {
        consecutiveGrowth++;
      } else {
        break;
      }
    }

    // Calculate growth rate (bytes per second) over the window
    let growthRate = 0;
    if (snaps.length >= 2) {
      const first = snaps[0];
      const timeDeltaS = (latest.timestamp - first.timestamp) / 1000;
      if (timeDeltaS > 0) {
        growthRate = (latest.usedJSHeapSize - first.usedJSHeapSize) / timeDeltaS;
      }
    }

    // Determine trend
    let trend: MemoryTrendResult['trend'] = 'stable';
    if (heapUsagePercent > CRITICAL_HEAP_USAGE) {
      trend = 'critical';
    } else if (consecutiveGrowth >= CONSECUTIVE_GROWTH_THRESHOLD) {
      trend = 'growing';
    }

    return { trend, growthRate, consecutiveGrowth, heapUsagePercent };
  }
}
