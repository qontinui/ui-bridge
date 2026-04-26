import * as react_jsx_runtime from 'react/jsx-runtime';
import React from 'react';
import { c7 as ElementIdentifier, at as ElementState, as as RegisteredElement, i as AnyCapturedEvent } from '../types-X8pyInrK.mjs';
export { ap as BrowserCaptureConfig, bj as BrowserCapturedEvent, n as BrowserEventType, m as CapturedError, bp as ClassifiedEvent, bz as ConsoleCapturedEvent, bM as DEFAULT_CAPTURE_CONFIG, bN as DEFAULT_NOISE_PATTERNS, D as DetectedErrorOverlay, bV as DomMetricsCapturedEvent, c3 as ElementEventLog, c4 as ElementEventLogConfig, cb as ErrorImpact, cc as ErrorImpactAssessor, cd as ErrorImpactConfig, E as ErrorSeverity, cq as FreezeCapturedEvent, cy as HmrCapturedEvent, cJ as LongTaskCapturedEvent, cO as MemoryCapturedEvent, cT as NavigationCapturedEvent, cX as NetworkCapturedEvent, aq as OnBrowserEventCallback, cZ as OnCaptureCallback, d3 as ReactErrorCapturedEvent, db as ResourceErrorCapturedEvent, dc as SEVERITY_RANK, dJ as UIConsequences, dK as UIStateSnapshot, em as WebVitalCapturedEvent, es as WsDisconnectionCapturedEvent, et as classifyEvent, eu as classifyEvents, ey as filterBySeverity, eA as getActiveOverlays, eC as installFrameworkOverlayCapture } from '../types-X8pyInrK.mjs';
export { B as BrowserEventCapture, M as MemoryTrendAnalyzer, a as MemoryTrendResult } from '../browser-capture-Da337fUf.mjs';
export { A as ActionTimelineEntry, B as BaselineComparison, b as BrowserEventCaptureLike, c as BrowserEventTimelineEntry, C as ClassifiedBrowserEvent, d as CorrelatedError, e as ErrorBaseline, f as ErrorDiff, g as ErrorSession, h as ErrorSessionManager, E as ErrorSessionSummary, a as ErrorSnapshot, i as ErrorSnapshotBuffer, j as ErrorSnapshotConfig, k as ErrorSnapshotPageState, F as FingerprintedEvent, H as HealthReport, l as HealthScoreConfig, m as HealthStatus, N as NetworkChain, n as NetworkChainConfig, o as NetworkChainTracker, p as NetworkRequest, q as NetworkResponse, r as TimelineBuffer, T as TimelineEntry, s as TimelineEntryType, t as TimelineQueryOptions, u as computeFingerprint, v as computeHealthReport, w as computeHealthScore, x as computeHealthStatus, y as deduplicateEvents, z as extractMessage, D as extractSourceLocation } from '../error-snapshot-DsIWbgYL.mjs';
export { B as BrowserEventStream, a as BrowserEventStreamMessage, b as StreamConfig, S as StreamSubscription } from '../ws-streaming-Bs2gx7kC.mjs';
export { A as ActionHistoryEntry, M as MetricsCollector, a as MetricsCollectorOptions, P as PerformanceMetrics, c as createMetricsCollector, f as formatDuration, b as formatPercentage } from '../metrics-Bi4IZDyI.mjs';
import '../tracker-DpZSyunJ.mjs';

/**
 * Inspector state
 */
interface InspectorState {
    /** Whether inspector is active */
    active: boolean;
    /** Currently hovered element */
    hoveredElement: HTMLElement | null;
    /** Selected element */
    selectedElement: HTMLElement | null;
    /** Highlight bounds */
    highlightBounds: DOMRect | null;
}
/**
 * Element info for display
 */
interface ElementInfo {
    identifier: ElementIdentifier;
    bestId: string;
    tagName: string;
    role?: string;
    state: ElementState;
    registered?: RegisteredElement;
}
/**
 * Inspector overlay component
 */
interface InspectorOverlayProps {
    bounds: DOMRect;
    label: string;
}
declare function InspectorOverlay({ bounds, label }: InspectorOverlayProps): react_jsx_runtime.JSX.Element;
/**
 * Element info panel component
 */
interface InfoPanelProps {
    element: HTMLElement | null;
    onClose: () => void;
    registeredElement?: RegisteredElement;
}
declare function InfoPanel({ element, onClose, registeredElement }: InfoPanelProps): react_jsx_runtime.JSX.Element | null;
/**
 * useInspector hook options
 */
interface UseInspectorOptions {
    /** Callback when element is selected */
    onSelect?: (element: HTMLElement) => void;
    /** Get registered element by DOM element */
    getRegisteredElement?: (element: HTMLElement) => RegisteredElement | undefined;
    /** Keyboard shortcut to toggle (default: Ctrl+Shift+I) */
    shortcut?: {
        key: string;
        ctrl?: boolean;
        shift?: boolean;
        alt?: boolean;
    };
}
/**
 * useInspector hook
 *
 * Provides inspector functionality for debugging.
 */
declare function useInspector(options?: UseInspectorOptions): {
    active: boolean;
    toggle: () => void;
    hoveredElement: HTMLElement | null;
    selectedElement: HTMLElement | null;
    setSelectedElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
    displayElement: HTMLElement | null;
    bounds: DOMRect | null;
    registeredElement: RegisteredElement | undefined;
    clearSelection: () => void;
};
/**
 * Inspector component
 *
 * Full inspector UI with overlay and info panel.
 */
interface InspectorProps {
    /** Get registered element by DOM element */
    getRegisteredElement?: (element: HTMLElement) => RegisteredElement | undefined;
    /** Initial active state */
    initialActive?: boolean;
}
declare function Inspector({ getRegisteredElement, initialActive }: InspectorProps): react_jsx_runtime.JSX.Element | null;

/**
 * Shared utilities for the debug module.
 *
 * Common helpers extracted to avoid duplication across debug sub-modules.
 */

/**
 * Extract the stack trace from an event, if the event carries one.
 */
declare function getEventStack(event: AnyCapturedEvent): string | undefined;

/**
 * Click Highlight — Visual Click Feedback for UI Bridge Apps
 *
 * Draws a brief animated highlight at click locations during automation,
 * giving users visual feedback of what the system is doing without
 * interfering with UI interaction.
 *
 * Inspired by TuriX-CUA's visual click highlighting overlay pattern.
 *
 * @example
 * ```ts
 * import { showClickHighlight } from './click-highlight';
 *
 * // Show a green highlight at coordinates (100, 200)
 * showClickHighlight(100, 200);
 *
 * // Custom options
 * showClickHighlight(300, 400, { color: '#ff0000', duration: 1000, size: 40 });
 * ```
 */
interface ClickHighlightOptions {
    /** CSS color for the highlight ring. Default: '#00c800' (green). */
    color?: string;
    /** Duration in milliseconds before the highlight fades out. Default: 800. */
    duration?: number;
    /** Diameter of the highlight circle in pixels. Default: 30. */
    size?: number;
    /** Whether to show a ripple animation. Default: true. */
    ripple?: boolean;
}
/**
 * Show a visual click highlight at the given screen coordinates.
 *
 * Creates a temporary CSS overlay element with a pulsing circle animation
 * at the specified position. The element is automatically removed after
 * the animation completes.
 *
 * @param x - X coordinate (viewport-relative, pixels).
 * @param y - Y coordinate (viewport-relative, pixels).
 * @param options - Optional customization.
 */
declare function showClickHighlight(x: number, y: number, options?: ClickHighlightOptions): void;
/**
 * Show a click highlight centered on an element's bounding rect.
 *
 * @param element - The DOM element to highlight.
 * @param options - Optional customization.
 */
declare function showElementHighlight(element: HTMLElement, options?: ClickHighlightOptions): void;
/**
 * Color presets for different action types.
 */
declare const HIGHLIGHT_COLORS: {
    readonly click: "#00c800";
    readonly type: "#0064ff";
    readonly scroll: "#ff8c00";
    readonly select: "#b400b4";
    readonly focus: "#00b4b4";
    readonly error: "#ff0000";
};

export { AnyCapturedEvent, type ClickHighlightOptions, type ElementInfo, HIGHLIGHT_COLORS, InfoPanel, type InfoPanelProps, Inspector, InspectorOverlay, type InspectorOverlayProps, type InspectorProps, type InspectorState, type UseInspectorOptions, getEventStack, showClickHighlight, showElementHighlight, useInspector };
