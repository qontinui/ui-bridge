'use client';

/**
 * CommandRelayListener — Convenience component wrapping useCommandRelay
 *
 * Drop this inside your UIBridgeProvider to enable the command relay
 * with zero configuration.
 *
 * @example
 * ```tsx
 * <UIBridgeProvider features={{ renderLog: true, control: true, debug: true }}>
 *   <AutoRegisterProvider>
 *     <CommandRelayListener />
 *     {children}
 *   </AutoRegisterProvider>
 * </UIBridgeProvider>
 * ```
 */

import { useCommandRelay, type UseCommandRelayOptions } from './useCommandRelay';

export interface CommandRelayListenerProps {
  /** Base path for UI Bridge API routes (default: '/api/ui-bridge') */
  basePath?: string;
  /** Whether the relay is enabled (default: true) */
  enabled?: boolean;
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
   * Optional SDK / app version string forwarded to the server on each
   * heartbeat. Lets `/supervisor-bridge/health` (and equivalent runner
   * endpoints) report what's actually connected instead of build-time
   * defaults baked into the static config.
   */
  version?: string;
  /**
   * Optional hook returning the current session token (raw value, no
   * `Bearer ` prefix). When supplied, the SDK attaches
   * `Authorization: Bearer <value>` to outbound `POST /commands` and
   * `POST /heartbeat` and appends `_auth=<value>` to the SSE URL.
   * See `UseCommandRelayOptions.authHeader` for the full contract.
   */
  authHeader?: () => string | null | undefined;
  /**
   * Optional hook returning the current tab-ownership registration
   * metadata `{userId, sessionId}`. When supplied, every heartbeat
   * carries this envelope so the server can scope tabs to the
   * authenticated user (filter `/tabs`, reject cross-user
   * `targetTabId` dispatch, scope unscoped fanout). Strict mode is the
   * only mode in @qontinui/ui-bridge ≥ 0.12 — without this hook the
   * strict server returns HTTP 400 / `MISSING_REGISTRATION_METADATA`
   * on every heartbeat. See
   * `UseCommandRelayOptions.registrationMetadata` for the full contract.
   */
  registrationMetadata?: () => { userId: string; sessionId: string } | null | undefined;
}

export function CommandRelayListener(props: CommandRelayListenerProps): null {
  const options: UseCommandRelayOptions = {
    enabled: props.enabled,
    basePath: props.basePath,
    heartbeatInterval: props.heartbeatInterval,
    runnerUrl: props.runnerUrl,
    disablePhoneHome: props.disablePhoneHome,
    appId: props.appId,
    appName: props.appName,
    appType: props.appType,
    framework: props.framework,
    capabilities: props.capabilities,
    version: props.version,
    authHeader: props.authHeader,
    registrationMetadata: props.registrationMetadata,
  };
  useCommandRelay(options);
  return null;
}
