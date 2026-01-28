/**
 * UI Bridge Core Module
 *
 * Exports all core types and WebSocket client.
 */

// Export all types
export * from './types';

// WebSocket client (web-specific)
export { UIBridgeWSClient, createWSClient } from './websocket-client';
