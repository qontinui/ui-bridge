import { a as UIBridgeServerHandlers } from '../types-DhipyJTn.js';
export { A as APIResponse, B as BrowserEventsResponse, C as CORSOptions, b as CapabilitiesResponse, c as ControlBatchRequest, d as ControlBatchResponse, e as ControlBatchStep, f as ControlBatchStepResult, D as DOMChangeEvent, E as ElementConditionSelector, g as EndpointCategory, h as EndpointInfo, R as RateLimitOptions, i as RenderLogQuery, j as RouteDefinition, U as UIBridgeServerConfig, k as UI_BRIDGE_ROUTES, l as WaitForElementByConditionRequest, m as WaitForElementByConditionResponse, n as WaitForElementPredicate, o as WaitForElementRequest, p as WaitForElementSuccessResponse, q as WaitForRouteChangeRequest, r as WaitForRouteChangeResponse, W as WebSocketMessage, s as WebSocketMessageType } from '../types-DhipyJTn.js';
export { ActionExecutorLike, CreateHandlersConfig, RegistryLike, createAIHandlers, createHandlers } from './handlers.js';
export { ExpressAdapterConfig, createExpressApp, createExpressRouter, uiBridgeMiddleware } from './express.js';
import { C as CommandRelay } from '../nextjs-CU2gNLXg.js';
export { a as CommandListener, b as CommandRelayOptions, N as NextJSAdapterConfig, c as NextRouteHandler, P as PendingCommand, Q as QueuedCommand, T as TabInfo, d as TabListener, e as TransportDiagnostics, W as WebSocketClient, f as createControlHandlers, g as createDebugHandlers, h as createNextRouteHandlers, i as createRenderLogHandlers, j as createUIBridgeHandler } from '../nextjs-CU2gNLXg.js';
import { U as UIBridgeWSHandler } from '../standalone-D3qaG3wK.js';
export { S as StandaloneServer, a as StandaloneServerConfig, W as WebSocketLike, c as createStandaloneServer, s as startCLI } from '../standalone-D3qaG3wK.js';
import { e as BridgeEvent, i as AnyCapturedEvent } from '../types-CXCbCmRP.js';
import { B as BrowserEventStream, S as StreamSubscription } from '../ws-streaming-DKZ5iHe4.js';
export { S as SSEManager } from '../sse-handler-7RrWBnEy.js';
import '../types-BFG8zj15.js';
import '../tracker-DpZSyunJ.js';
import '../render-log/index.js';
import '../find-l8WZ76Px.js';
import '../style-types-DaTmY4r1.js';
import '../types-C7D5seeQ.js';
import '../error-snapshot-wfvZ-MCP.js';
import '../store-DyHYpiRk.js';
import '../types-BXWFvx_x.js';
import '../navigation-adapter-D0eod-Ve.js';
import '../drag-drop-detector-xq2PQNUI.js';
import '../annotations/index.js';
import 'express';
import '../change-observer-hiF2OiFX.js';

interface WSStreamAdapterConfig {
    /** Minimum severity to forward (default: 'warning') */
    minSeverity?: 'crash' | 'error' | 'warning' | 'noise';
    /** Enable fingerprint-based deduplication (default: true) */
    deduplicate?: boolean;
    /** Optional log function for debug output */
    log?: (message: string) => void;
}
/**
 * Create an `onBrowserEvent` callback that forwards BridgeEvents to a
 * UIBridgeWSHandler's broadcastEvent method.
 *
 * Pass the returned callback as `config.onBrowserEvent` when calling
 * `createHandlers()`. The internal BrowserEventStream in handlers.ts will
 * auto-create a default subscription when `onBrowserEvent` is provided,
 * so classified events flow through to this callback automatically.
 *
 * @example
 * ```ts
 * const server = new StandaloneServer(handlers, { websocket: true });
 * // After server is created, wire the adapter:
 * const broadcast = createWSStreamBroadcast(server.getWSHandler()!);
 *
 * // Or pass during handler creation:
 * const handlers = createHandlers(registry, executor, {
 *   onBrowserEvent: createWSStreamBroadcast(wsHandler),
 * });
 * ```
 */
declare function createWSStreamBroadcast(wsHandler: UIBridgeWSHandler, config?: Pick<WSStreamAdapterConfig, 'log'>): (event: BridgeEvent) => void;
/**
 * Full adapter that owns a subscription on an external BrowserEventStream
 * and forwards matching events to a broadcast function.
 *
 * Manages subscription lifecycle: subscribes on `attach()`, unsubscribes
 * on `detach()`. Use `notifyClientChange()` to auto-manage based on
 * connected WS client count.
 *
 * @example
 * ```ts
 * const stream = new BrowserEventStream();
 * const adapter = new WSStreamAdapter(stream, {
 *   broadcast: (event) => wsHandler.broadcastEvent(event),
 *   minSeverity: 'warning',
 * });
 * adapter.attach();
 *
 * // When a WS client connects/disconnects:
 * adapter.notifyClientChange(wsHandler.clientCount);
 * ```
 */
declare class WSStreamAdapter {
    private stream;
    private broadcast;
    private subscription;
    private config;
    private log?;
    constructor(stream: BrowserEventStream, options: {
        broadcast: (event: BridgeEvent) => void;
    } & WSStreamAdapterConfig);
    /**
     * Create a subscription on the stream. Safe to call multiple times
     * (no-op if already subscribed).
     */
    attach(): StreamSubscription;
    /**
     * Remove the subscription from the stream. Safe to call multiple times
     * (no-op if not subscribed).
     */
    detach(): void;
    /**
     * Update subscription based on WS client count.
     * Subscribes when the first client connects, unsubscribes when the last
     * client disconnects.
     */
    notifyClientChange(clientCount: number): void;
    /**
     * Process a raw browser event through the stream and broadcast any
     * messages that pass subscription filters.
     *
     * Call this from the capture's onEvent callback when using direct mode.
     */
    processAndBroadcast(event: AnyCapturedEvent): void;
    /** Whether the adapter currently has an active subscription */
    get isAttached(): boolean;
    /** The current subscription ID, or null */
    get subscriptionId(): string | null;
}

/**
 * Relay Handlers — Creates UIBridgeServerHandlers backed by CommandRelay
 *
 * Each handler queues a command to the browser via the relay and returns
 * the result. Server-only handlers (heartbeat, capabilities, render log,
 * metrics) execute directly without relay.
 *
 * This replaces the need for apps to write ~2700 lines of custom handler
 * code. Instead, ~30 lines of setup produces a fully functional handler set.
 */

interface RelayHandlersOptions {
    /** SDK version string for capabilities endpoint (default: '0.1.0') */
    version?: string;
    /**
     * URL of an external screenshot endpoint to call when the relay cannot
     * reach the browser (timeout, no listeners, empty response).
     *
     * Expected response shape: `{ success: true, data: { screenshot: "<base64>", width: N, height: N } }`
     *
     * Example: `'http://localhost:9876/ui-bridge/sdk/screenshot'`
     */
    screenshotFallbackUrl?: string;
    /** Cache TTL in milliseconds for snapshot staleness checks (default: 5000) */
    cacheTtlMs?: number;
    /**
     * Pre-loaded specs to serve from the server without relying on the browser
     * relay or React lifecycle. Pass the result of your app's `getAllSpecs()`
     * function here. The relay will still try the browser for live specs, but
     * falls back to these when the browser is disconnected or unresponsive.
     *
     * @example
     * ```ts
     * import { getAllSpecs } from '../spec-registry';
     * const handlers = createRelayHandlers(relay, {
     *   specs: getAllSpecs(),
     * });
     * ```
     */
    specs?: Array<{
        specId: string;
        config: unknown;
    }>;
}
/**
 * Create a full UIBridgeServerHandlers implementation backed by a CommandRelay.
 *
 * Every action/query wraps `relay.queueCommand()`. Server-only handlers
 * (heartbeat, capabilities, render log management) execute directly.
 *
 * @example
 * ```ts
 * import { CommandRelay, createRelayHandlers } from '@qontinui/ui-bridge/server';
 *
 * const relay = new CommandRelay();
 * const handlers = createRelayHandlers(relay);
 * ```
 */
declare function createRelayHandlers(relay: CommandRelay, options?: RelayHandlersOptions): UIBridgeServerHandlers;

/**
 * Chrome DevTools Protocol Tab Discovery
 *
 * Opt-in module that connects to Chrome's CDP endpoint to discover ALL
 * browser tabs, including those without the UI Bridge SDK loaded.
 *
 * Requires Chrome/Edge to be launched with `--remote-debugging-port=9222`.
 */
interface CDPTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
    /** True if this target also has an SDK connection (merged from UI Bridge) */
    hasSDK?: boolean;
    sdkTabId?: string;
}
interface CDPTabsConfig {
    /** CDP endpoint URL. Empty string or undefined = disabled. */
    endpoint?: string;
    /** Timeout for CDP HTTP requests in ms. Default 5000. */
    timeout?: number;
}
/**
 * CDP-based browser tab discovery and control.
 *
 * Requires Chrome/Edge to be launched with `--remote-debugging-port=9222`.
 * When enabled, extends UI Bridge's tab awareness beyond SDK-connected
 * tabs to include ALL browser tabs.
 */
declare class CDPTabDiscovery {
    private endpoint;
    private timeout;
    private enabled;
    constructor(config?: CDPTabsConfig);
    isEnabled(): boolean;
    /**
     * List all CDP targets (tabs, service workers, etc.).
     * Returns an empty array if CDP is disabled or unreachable.
     */
    listTargets(): Promise<CDPTarget[]>;
    /**
     * Activate (bring to front) a tab by its CDP target ID.
     */
    activateTarget(targetId: string): Promise<boolean>;
    /**
     * Close a tab by its CDP target ID.
     */
    closeTarget(targetId: string): Promise<boolean>;
    /**
     * Open a new tab, optionally navigated to a URL.
     * Returns the new target metadata, or null on failure.
     */
    openNewTab(url?: string): Promise<CDPTarget | null>;
    /**
     * Merge CDP targets with SDK-connected tab metadata.
     *
     * For each CDP target, checks if any SDK tab has a matching URL.
     * If so, sets hasSDK=true and sdkTabId on the target.
     */
    mergeWithSDKTabs(cdpTargets: CDPTarget[], sdkTabMetadata: Map<string, {
        url: string;
    }>): CDPTarget[];
}

/**
 * Shared element selector matching logic used by every endpoint that
 * filters the registry by a query object (`getElements`, `waitForElementByCondition`,
 * relay-handlers `getElements`, etc.).
 *
 * Historical context: three separate copies of this logic existed and drifted.
 * `getElements` filtered strictly on the `title` field; `waitForElementByCondition`
 * used an accessible-name fallback chain; the relay only had the `label` field.
 * The result was that `GET /control/elements?title=X` and
 * `POST /ai/wait-for-element-condition {selector:{title:X}}` could return
 * different results for the same X. This module is the single source of truth.
 */
/**
 * Narrow shape the matcher needs. Covers both the live-DOM `materialized`
 * element (has `title`/`ariaLabel`/`label`/`id`/`type`) and the relay cache
 * element (only has `label`/`id`/`type`).
 */
interface MatchableElement {
    id: string;
    type?: string;
    label?: string;
    /** Live DOM `aria-label` attribute, populated by materializeElements. Absent in relay. */
    ariaLabel?: string;
    /** Live DOM `title` attribute, populated by materializeElements. Absent in relay. */
    title?: string;
    [key: string]: unknown;
}
interface ElementSelector {
    /** Exact-match on element id. */
    id?: string;
    /** Case-insensitive substring match. Checks title → ariaLabel → label (accessible name chain). */
    title?: string;
    /** Case-insensitive substring match. Checks ariaLabel → label. */
    aria_label?: string;
    /** Case-insensitive substring match. Checks label → id. */
    text?: string;
    /** Exact-match on element type (e.g. "button", "input"). */
    type?: string;
}
/**
 * Return true if `el` matches every non-empty field of `selector`.
 *
 * An empty or undefined selector matches everything — callers must check that
 * at least one field is set if they want to require a match.
 *
 * Accessible-name fallbacks matter: the live DOM `title` attribute is often
 * empty even when the element clearly has a title from aria-label or label
 * text, so `selector.title` checks all three in order.
 */
declare function matchesElementSelector(el: MatchableElement, selector: ElementSelector): boolean;

export { CDPTabDiscovery, type CDPTabsConfig, type CDPTarget, CommandRelay, type ElementSelector, type MatchableElement, type RelayHandlersOptions, UIBridgeServerHandlers, UIBridgeWSHandler, WSStreamAdapter, type WSStreamAdapterConfig, createRelayHandlers, createWSStreamBroadcast, matchesElementSelector };
