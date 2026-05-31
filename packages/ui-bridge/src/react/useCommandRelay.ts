'use client';

/**
 * useCommandRelay — Browser-side hook for the SDK command relay
 *
 * Connects to the server's command relay via SSE, receives commands,
 * executes them using the UIBridgeRegistry, and POSTs results back.
 * Also sends periodic heartbeats to signal app responsiveness.
 *
 * This is the SDK equivalent of qontinui-web's useUIBridgeCommandHandler,
 * but portable to any app using @qontinui/ui-bridge.
 */

import { useEffect, useRef, useMemo, useState } from 'react';
import { useUIBridge } from './useUIBridge';
import { useUIBridgeOptional } from './UIBridgeProvider';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import {
  startRelayClient,
  resolveTabId,
  resolveAuthToken,
  transportHeaders,
  parseSSEDataBlock,
  resolveRegistrationMetadata,
} from '../relay/relay-client';

export interface UseCommandRelayOptions {
  /** Whether the relay is enabled (default: true) */
  enabled?: boolean;
  /** Base path for UI Bridge API routes (default: '/api/ui-bridge') */
  basePath?: string;
  /** Heartbeat interval in ms (default: 10000) */
  heartbeatInterval?: number;
  /**
   * Explicit runner URL override for phone-home registration.
   * Default: 'http://127.0.0.1:9876'. When set, phone-home fires regardless
   * of hostname; otherwise it is gated to localhost-family hosts.
   */
  runnerUrl?: string;
  /** Opt out of the phone-home registration entirely. */
  disablePhoneHome?: boolean;
  /** Stable identity for this app in the runner's registry. Default: hostname. */
  appId?: string;
  /** Display name. Default: `document.title || location.hostname`. */
  appName?: string;
  /** App classification. Default: 'web'. */
  appType?: 'web' | 'desktop' | 'mobile' | 'dashboard' | 'other';
  /** Framework hint. Default: 'react'. */
  framework?: string;
  /** Capability tags. Default: ['control']. */
  capabilities?: string[];
  /**
   * Optional SDK / app version string surfaced on heartbeats so the server
   * can report what is actually connected (rather than relying on
   * build-time defaults baked into a static config).
   */
  version?: string;
  /**
   * Optional hook that returns the current session token (the raw token
   * value, WITHOUT a `Bearer ` prefix). When supplied and returns a
   * non-empty string, the SDK:
   *
   *   - attaches `Authorization: Bearer <value>` to outbound
   *     `POST {basePath}/commands` and `POST {basePath}/heartbeat`;
   *   - attaches `Authorization: Bearer <value>` to the SSE
   *     `GET {basePath}/commands/stream` request as well — the stream is
   *     consumed via `fetch` streaming, so the header rides on the request
   *     (no token in the URL).
   *
   * Called fresh on every outbound request — implementations should read
   * the token from a live source (e.g. `sessionStorage`) so a token
   * rotation is picked up without remounting the listener. Returning
   * `null` / `undefined` / empty string means "no auth this call" and
   * the transport falls back to legacy unauth'd / cookie-based behavior
   * (matching the SDK's pre-`authHeader` shape).
   *
   * Required to authenticate against any relay endpoint that enforces a
   * session-bound auth gate (e.g. qontinui-web's
   * `UI_BRIDGE_REQUIRE_AUTH=1` mode).
   */
  authHeader?: () => string | null | undefined;
  /**
   * Per-user tab-scoping registration metadata. When supplied, every
   * heartbeat carries `{userId, sessionId}` as a top-level
   * `registrationMetadata` field. The server uses these values to:
   *
   *   - record tab ownership keyed on this tabId
   *   - filter `/tabs` / `/tabs/wait` responses to the caller's own tabs
   *   - reject cross-user `targetTabId` dispatch with a 404
   *   - scope unscoped fanout (no `targetTabId`) to the caller's tabs
   *
   * Strict mode: as of @qontinui/ui-bridge 0.12 the server REJECTS any
   * `POST /heartbeat` whose body is missing this field. Tabs without
   * registration metadata never enter the ownership registry and so are
   * unreachable by authenticated dispatch — this hook is therefore
   * effectively required when the consumer (qontinui-web et al.) ships
   * the strict relay route. Older relays simply ignore the extra field.
   *
   * Like `authHeader`, this is a function (not a static value) so a
   * consumer can rotate `sessionId` on re-login without remounting the
   * listener. Read fresh on every heartbeat. Returning `null` /
   * `undefined` or a value missing either field means "no metadata this
   * beat" — strict servers will respond 400.
   */
  registrationMetadata?: () => { userId: string; sessionId: string } | null | undefined;
}

/**
 * Test-only re-exports for the transport helpers, now sourced from the
 * framework-free `relay-client` module. The `__test_` prefix follows the SDK
 * convention for non-public-but-accessible names (cf. `__SDK_VERSION__`). NOT
 * part of the public API surface and may change at any time.
 */
export const __test_resolveAuthToken = resolveAuthToken;
export const __test_transportHeaders = transportHeaders;
export const __test_parseSSEDataBlock = parseSSEDataBlock;
export const __test_resolveRegistrationMetadata = resolveRegistrationMetadata;

/**
 * Hook that connects the browser to the server's command relay.
 *
 * 1. Connects to `{basePath}/commands/stream` via SSE
 * 2. Receives commands, executes via UIBridge registry + browser APIs
 * 3. POSTs results back to `{basePath}/commands`
 * 4. Sends heartbeat every 10s to `{basePath}/heartbeat`
 * 5. Handles reconnection on visibility change
 */
export function useCommandRelay(options?: UseCommandRelayOptions): void {
  const enabled = options?.enabled ?? true;
  const basePath = options?.basePath ?? '/api/ui-bridge';
  // Default mirrors `startRelayClient`'s own (10s); passed through explicitly
  // so the effect's dep array tracks an override.
  const heartbeatIntervalMs = options?.heartbeatInterval ?? 10_000;
  // Capture the auth-header hook in a ref so the 3 transport call sites
  // read the freshest token without re-running effects on every render.
  // The hook is called per-request inside the helpers above.
  const authHeaderRef = useRef<UseCommandRelayOptions['authHeader']>(undefined);
  authHeaderRef.current = options?.authHeader;
  // Same ref pattern for registrationMetadata: every heartbeat reads the
  // current value so a sessionId rotation (re-login) is picked up without
  // remounting. See the option-type docblock for the strict-mode contract.
  const registrationMetadataRef =
    useRef<UseCommandRelayOptions['registrationMetadata']>(undefined);
  registrationMetadataRef.current = options?.registrationMetadata;

  const uiBridge = useUIBridge();
  const context = useUIBridgeOptional();

  // Build BridgeAccess with registry from context
  const bridge = useMemo<BridgeAccess>(
    () => ({
      ...(uiBridge as unknown as BridgeAccess),
      registry: context?.registry
        ? {
            getAllStates: () => context.registry.getAllStates(),
            getState: (id: string) => context.registry.getState(id),
            getActiveStates: () => context.registry.getActiveStates(),
            activateState: (id: string) => context.registry.activateState(id),
            deactivateState: (id: string) => context.registry.deactivateState(id),
            getAllStateGroups: () => context.registry.getAllStateGroups(),
            getStateGroup: (id: string) => context.registry.getStateGroup(id),
            activateStateGroup: (id: string) => context.registry.activateStateGroup(id),
            deactivateStateGroup: (id: string) => context.registry.deactivateStateGroup(id),
            getAllTransitions: () => context.registry.getAllTransitions(),
            getTransition: (id: string) => context.registry.getTransition(id),
            canExecuteTransition: (id: string) => context.registry.canExecuteTransition(id),
            executeTransition: (id: string) => context.registry.executeTransition(id),
            findPath: (targets: string[]) => context.registry.findPath(targets),
            navigateTo: (targets: string[]) => context.registry.navigateTo(targets),
            getStateSnapshot: () => ({
              timestamp: Date.now(),
              activeStates: context.registry.getActiveStates(),
              states: context.registry.getAllStates(),
              groups: context.registry.getAllStateGroups(),
              transitions: context.registry.getAllTransitions(),
            }),
          }
        : undefined,
    }),
    [uiBridge, context]
  );

  // Stable per-tab identifier, persisted across re-renders but unique per
  // browser tab. Lazy initializer so the side effects (sessionStorage
  // read/write, crypto.randomUUID) run exactly once during mount.
  const [tabId] = useState<string>(() => resolveTabId());

  // Keep the live BridgeAccess in a ref so the relay client's `execute`
  // closure always dispatches against the freshest registry wiring without
  // restarting the SSE/heartbeat loop on every render.
  const bridgeRef = useRef<BridgeAccess>(bridge as unknown as BridgeAccess);
  bridgeRef.current = bridge as unknown as BridgeAccess;

  // Heartbeat metadata fields — mirror the identity fields used by phone-home
  // registration so the server's "what's connected right now" view matches
  // the runner registry. Read here so the effect restarts when they change.
  const heartbeatAppId = options?.appId;
  const heartbeatAppName = options?.appName;
  const heartbeatAppType = options?.appType;
  const heartbeatFramework = options?.framework;
  const heartbeatCapabilities = options?.capabilities;
  const heartbeatVersion = options?.version;

  // ========================================================================
  // Relay transport (SSE receive + execute + result POST + heartbeat)
  //
  // Delegated to the framework-free `startRelayClient`, shared verbatim with
  // the injected runtime bundle. The hook owns only the React-specific
  // wiring: the live `bridge` ref, the freshest `authHeader` /
  // `registrationMetadata` hooks (via refs), and effect lifecycle.
  // ========================================================================
  useEffect(() => {
    if (!enabled) return;

    const client = startRelayClient({
      basePath,
      tabId,
      heartbeatIntervalMs,
      execute: (action, payload) =>
        executeCommand(action, payload as Record<string, unknown>, bridgeRef.current),
      authHeader: () => authHeaderRef.current?.(),
      registrationMetadata: () => registrationMetadataRef.current?.(),
      appId: heartbeatAppId,
      appName: heartbeatAppName,
      appType: heartbeatAppType,
      framework: heartbeatFramework,
      capabilities: heartbeatCapabilities,
      version: heartbeatVersion,
    });

    return () => client.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capabilities is a stable array reference for the component's lifetime
  }, [
    enabled,
    basePath,
    heartbeatIntervalMs,
    tabId,
    heartbeatAppId,
    heartbeatAppName,
    heartbeatAppType,
    heartbeatFramework,
    heartbeatVersion,
  ]);

  // ========================================================================
  // Phone-home registration
  // ========================================================================
  // POSTs a registration payload to the local qontinui-runner so the
  // integration tool can discover this app without a port scan. Gated to
  // localhost-family hostnames by default; opt in on non-localhost via
  // `runnerUrl`, or opt out with `disablePhoneHome`.
  useEffect(() => {
    if (!enabled || options?.disablePhoneHome) return;
    if (typeof window === 'undefined') return; // SSR guard

    const host = window.location.hostname;
    const isLocalhost =
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local');

    // Dev-mode override: `?uiBridgeRunnerUrl=http://127.0.0.1:9877` or the
    // shorthand `?uiBridgeRunnerPort=9877`. Lets a developer point an existing
    // running app at a temp runner on a different port without rebuilding the
    // app. Only honored on localhost origins, and only accepts URLs whose
    // host is itself localhost — the stated purpose is pointing at a local
    // temp runner, so allowing arbitrary hosts would just be an exfiltration
    // channel for the registration payload.
    let qspRunnerUrl: string | undefined;
    if (typeof URLSearchParams !== 'undefined' && isLocalhost) {
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('uiBridgeRunnerUrl');
      const portParam = params.get('uiBridgeRunnerPort');
      if (urlParam) {
        try {
          const parsed = new URL(urlParam);
          const parsedHost = parsed.hostname;
          const parsedIsLocalhost =
            parsedHost === '127.0.0.1' ||
            parsedHost === 'localhost' ||
            parsedHost === '0.0.0.0' ||
            parsedHost === '::1';
          if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsedIsLocalhost) {
            qspRunnerUrl = urlParam;
          }
        } catch {
          // Invalid URL — ignore
        }
      } else if (portParam) {
        const portNum = Number(portParam);
        if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535) {
          qspRunnerUrl = `http://127.0.0.1:${portNum}`;
        }
      }
    }

    const runnerUrl = qspRunnerUrl ?? options?.runnerUrl ?? 'http://127.0.0.1:9876';
    // Guard: only phone home on localhost unless explicitly overridden (prop or QSP).
    if (!isLocalhost && !options?.runnerUrl && !qspRunnerUrl) return;

    const origin = window.location.origin;
    const baseUrl = `${origin}${basePath}`;
    const resolvedAppId = options?.appId ?? host;
    const appName = options?.appName ?? (document.title || host);
    const appType = options?.appType ?? 'web';
    const framework = options?.framework ?? 'react';
    const capabilities = options?.capabilities ?? ['control'];

    const payload = {
      appId: resolvedAppId,
      appName,
      appType,
      transport: 'http',
      baseUrl,
      framework,
      capabilities,
      origin,
    };

    let cancelled = false;

    const register = async () => {
      try {
        await fetch(`${runnerUrl}/ui-bridge/apps/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Runner not reachable — silent. Expected when runner is down or
        // unreachable (e.g. DNS failure inside a container).
      }
    };

    register();
    const interval = setInterval(() => {
      if (!cancelled) register();
    }, 10_000);

    // Best-effort deregister on tab close. Uses fetch(keepalive) because
    // sendBeacon only supports POST and the runner's deregister route is a
    // DELETE. keepalive lets the browser finish the request after the tab
    // navigates away. If this fails (older browser, request blocked, etc.)
    // the runner's 30s staleness sweeper will evict the entry anyway.
    const onBeforeUnload = () => {
      try {
        void fetch(`${runnerUrl}/ui-bridge/apps/register/${encodeURIComponent(resolvedAppId)}`, {
          method: 'DELETE',
          keepalive: true,
        });
      } catch {
        /* swallow: unreachable-runner is the common case and not actionable here */
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values read from options are stable for the component's lifetime
  }, [
    enabled,
    basePath,
    options?.disablePhoneHome,
    options?.runnerUrl,
    options?.appId,
    options?.appName,
    options?.appType,
    options?.framework,
  ]);
}
