/**
 * Web App Discovery
 *
 * Discovers web applications running locally with UI Bridge enabled.
 * Scans common development server ports.
 */

import type { DiscoveredApp, ScanConfig } from './types';
import { scanPorts } from './scanner';

/** Common web development server ports */
export const WEB_DEV_PORTS = [
  3000,
  3001,
  3002,
  3003,
  3004,
  3005,
  3006,
  3007,
  3008,
  3009,
  3010,
  4200, // Angular
  5173,
  5174,
  5175, // Vite
  8080,
  8081, // Generic
  4000, // Phoenix/misc
];

/**
 * Discover web applications with UI Bridge enabled
 *
 * @param config - Optional scan configuration overrides
 * @returns Array of discovered web apps
 */
export async function discoverWebApps(config?: Partial<ScanConfig>): Promise<DiscoveredApp[]> {
  const apps = await scanPorts({
    ports: config?.ports ?? WEB_DEV_PORTS,
    timeout: config?.timeout,
    healthPaths: config?.healthPaths,
  });

  // Filter to only web-type apps (or unknown type on web ports)
  return apps.filter((app) => app.appType === 'web' || app.appType === 'other');
}
