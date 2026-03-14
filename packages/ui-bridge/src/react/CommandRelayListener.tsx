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
}

export function CommandRelayListener(props: CommandRelayListenerProps): null {
  const options: UseCommandRelayOptions = {
    enabled: props.enabled,
    basePath: props.basePath,
    heartbeatInterval: props.heartbeatInterval,
  };
  useCommandRelay(options);
  return null;
}
