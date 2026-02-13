/**
 * Desktop App Discovery
 *
 * Discovers desktop applications (Tauri, Electron) with UI Bridge enabled.
 * Scans common desktop application ports.
 */

import type { DiscoveredApp, ScanConfig } from './types';
import { scanPorts } from './scanner';

/** Common desktop application ports */
export const DESKTOP_APP_PORTS = [
  1420, // Tauri dev server
  9876, // Qontinui Runner
  9877,
  9878, // Runner fallback ports
  8888, // Electron common
  3333, // Desktop misc
];

/**
 * Discover desktop applications with UI Bridge enabled
 *
 * @param config - Optional scan configuration overrides
 * @returns Array of discovered desktop apps
 */
export async function discoverDesktopApps(config?: Partial<ScanConfig>): Promise<DiscoveredApp[]> {
  const apps = await scanPorts({
    ports: config?.ports ?? DESKTOP_APP_PORTS,
    timeout: config?.timeout,
    healthPaths: config?.healthPaths,
  });

  // Filter to desktop-type apps
  return apps.filter((app) => app.appType === 'desktop' || app.appType === 'other');
}
