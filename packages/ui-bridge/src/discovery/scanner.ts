/**
 * UI Bridge Port Scanner
 *
 * Scans localhost ports for UI Bridge-enabled applications by checking
 * health endpoints for the `uiBridge` metadata field.
 *
 * NOTE: This module uses Node.js `http` module and is intended for
 * server-side / CLI use. Browser contexts should use the runner's
 * discovery API instead.
 */

import type { DiscoveredApp, ScanConfig } from './types';

const DEFAULT_HEALTH_PATHS = ['/ui-bridge/health', '/health'];
const DEFAULT_TIMEOUT = 500;

/**
 * Check a single port for a UI Bridge health endpoint
 */
async function checkPort(
  port: number,
  healthPaths: string[],
  timeout: number
): Promise<DiscoveredApp | null> {
  for (const path of healthPaths) {
    try {
      const http = await import('http');
      const result = await new Promise<DiscoveredApp | null>((resolve) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port,
            path,
            method: 'GET',
            timeout,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk: string) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.uiBridge) {
                  const ub = json.uiBridge;
                  resolve({
                    appId: ub.appId || `app-${port}`,
                    appName: ub.appName || `App on port ${port}`,
                    appType: ub.appType || 'other',
                    framework: ub.framework,
                    url: `http://localhost:${port}`,
                    port,
                    version: ub.version,
                    capabilities: ub.capabilities || [],
                    elementCount: ub.elementCount,
                    componentCount: ub.componentCount,
                    discoveredAt: Date.now(),
                  });
                } else {
                  resolve(null);
                }
              } catch {
                resolve(null);
              }
            });
          }
        );

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
        req.end();
      });

      if (result) return result;
    } catch {
      // Port not reachable or import failed
    }
  }
  return null;
}

/**
 * Scan multiple ports for UI Bridge applications
 *
 * @param config - Scan configuration
 * @returns Array of discovered apps
 */
export async function scanPorts(config: ScanConfig = {}): Promise<DiscoveredApp[]> {
  const { ports = [], timeout = DEFAULT_TIMEOUT, healthPaths = DEFAULT_HEALTH_PATHS } = config;

  const results = await Promise.allSettled(
    ports.map((port) => checkPort(port, healthPaths, timeout))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DiscoveredApp | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((app): app is DiscoveredApp => app !== null);
}
