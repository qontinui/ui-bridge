/**
 * UI Bridge Discovery Module
 *
 * Discovers UI Bridge-enabled applications across web, desktop, and mobile platforms.
 *
 * @example
 * ```ts
 * import { discoverWebApps, discoverDesktopApps } from '@qontinui/ui-bridge/discovery';
 *
 * const webApps = await discoverWebApps();
 * const desktopApps = await discoverDesktopApps();
 * ```
 */

// Types
export type { AppType, DiscoveredApp, MobileDevice, ScanConfig, DiscoveryResult } from './types';

// Scanner
export { scanPorts } from './scanner';

// Web discovery
export { discoverWebApps, WEB_DEV_PORTS } from './web';

// Desktop discovery
export { discoverDesktopApps, DESKTOP_APP_PORTS } from './desktop';

// Mobile helpers
export { checkForwardedPort, hasUIBridge, MOBILE_UI_BRIDGE_PORT } from './mobile';
