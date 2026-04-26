import { Router } from 'express';
import { U as UIBridgeServerConfig, a as UIBridgeServerHandlers } from '../types-h-6suk8E.mjs';
import { S as SSEManager } from '../sse-handler-Du44lYTM.mjs';
import '../types-svkOxfrJ.mjs';
import '../types-CNyrSSSQ.mjs';
import '../tracker-DpZSyunJ.mjs';
import '../render-log/index.mjs';
import '../find-CHUFcAzn.mjs';
import '../style-types-CSsr7rsk.mjs';
import '../types-C7D5seeQ.mjs';
import '../error-snapshot-DlaqDYcU.mjs';

/**
 * Express Adapter
 *
 * Express.js middleware for UI Bridge server.
 */

/**
 * Express-specific configuration
 */
interface ExpressAdapterConfig extends UIBridgeServerConfig {
    /** Use JSON body parser (if not already configured) */
    useBodyParser?: boolean;
    /** SSE manager for streaming events (pass to enable GET /control/events/stream) */
    sseManager?: SSEManager;
}
/**
 * Create Express router with UI Bridge routes
 */
declare function createExpressRouter(handlers: Partial<UIBridgeServerHandlers>, config?: ExpressAdapterConfig): Router;
/**
 * Create Express app with UI Bridge routes
 *
 * Convenience function that creates a complete Express app with UI Bridge.
 */
declare function createExpressApp(handlers: Partial<UIBridgeServerHandlers>, config?: ExpressAdapterConfig): unknown;
/**
 * Express middleware that adds UI Bridge to an existing app
 */
declare function uiBridgeMiddleware(handlers: Partial<UIBridgeServerHandlers>, config?: ExpressAdapterConfig): Router;

export { type ExpressAdapterConfig, createExpressApp, createExpressRouter, uiBridgeMiddleware };
