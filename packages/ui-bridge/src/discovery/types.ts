/**
 * UI Bridge Discovery Types
 *
 * Types for discovering UI Bridge-enabled applications across web, desktop, and mobile.
 */

/**
 * Application type
 */
export type AppType = 'web' | 'desktop' | 'mobile' | 'other';

/**
 * A discovered UI Bridge-enabled application
 */
export interface DiscoveredApp {
  /** Unique application identifier */
  appId: string;
  /** Human-readable application name */
  appName: string;
  /** Application type */
  appType: AppType;
  /** Framework used (e.g., 'next.js', 'tauri', 'react-native') */
  framework?: string;
  /** Base URL of the application */
  url: string;
  /** Port the application is running on */
  port: number;
  /** UI Bridge SDK version */
  version?: string;
  /** Supported capabilities */
  capabilities: string[];
  /** Number of registered elements */
  elementCount?: number;
  /** Number of registered components */
  componentCount?: number;
  /** When this app was discovered (epoch ms) */
  discoveredAt: number;
}

/**
 * A connected mobile device
 */
export interface MobileDevice {
  /** ADB device ID */
  deviceId: string;
  /** Device type */
  deviceType: 'device' | 'emulator';
  /** Device model name */
  model?: string;
  /** Device connection status */
  status: 'online' | 'offline' | 'unauthorized';
  /** UI Bridge app info (if detected) */
  uiBridge?: DiscoveredApp;
}

/**
 * Configuration for port scanning
 */
export interface ScanConfig {
  /** Override default port list */
  ports?: number[];
  /** Per-port connection timeout in ms (default: 500) */
  timeout?: number;
  /** Health endpoint paths to check (default: ['/ui-bridge/health', '/health']) */
  healthPaths?: string[];
}

/**
 * Result of a full discovery scan
 */
export interface DiscoveryResult {
  /** Discovered web applications */
  web: DiscoveredApp[];
  /** Discovered desktop applications */
  desktop: DiscoveredApp[];
  /** Connected mobile devices */
  mobile: MobileDevice[];
  /** When the scan was performed (epoch ms) */
  scannedAt: number;
  /** How long the scan took in ms */
  durationMs: number;
}
