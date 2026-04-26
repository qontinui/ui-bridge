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
  };
  useCommandRelay(options);
  return null;
}
