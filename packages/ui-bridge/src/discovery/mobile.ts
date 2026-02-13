/**
 * Mobile Device Discovery Types and Helpers
 *
 * Provides types for mobile device discovery and helpers for checking
 * UI Bridge availability on forwarded ports.
 *
 * NOTE: Actual ADB operations (device listing, port forwarding) must be
 * performed server-side (e.g., in the qontinui-runner Rust backend).
 * This module provides the types and the health check logic for
 * already-forwarded ports.
 */

import type { DiscoveredApp, MobileDevice, ScanConfig } from './types';
import { scanPorts } from './scanner';

/** Default port that React Native UI Bridge listens on */
export const MOBILE_UI_BRIDGE_PORT = 9876;

/**
 * Check a forwarded port for UI Bridge availability
 *
 * After ADB port forwarding (e.g., `adb forward tcp:LOCAL tcp:9876`),
 * call this to check if the device has UI Bridge running.
 *
 * @param localPort - The local port that was forwarded
 * @param config - Optional scan configuration
 * @returns The discovered app, or null if not found
 */
export async function checkForwardedPort(
  localPort: number,
  config?: Partial<ScanConfig>
): Promise<DiscoveredApp | null> {
  const apps = await scanPorts({
    ports: [localPort],
    timeout: config?.timeout ?? 1000, // mobile is slower
    healthPaths: config?.healthPaths,
  });

  return apps[0] ?? null;
}

/**
 * Type guard to check if a mobile device has UI Bridge
 */
export function hasUIBridge(
  device: MobileDevice
): device is MobileDevice & { uiBridge: DiscoveredApp } {
  return device.uiBridge !== undefined;
}
