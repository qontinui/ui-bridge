import { Router } from 'express';
import { U as UIBridgeServerConfig, a as UIBridgeServerHandlers } from '../types-MrIbC8tH.js';
import { S as SSEManager } from '../sse-handler-BSy6e6vc.js';
import '../types-svkOxfrJ.js';
import '../types-BFG8zj15.js';
import '../tracker-DpZSyunJ.js';
import '../render-log/index.js';
import '../find-Cy9pKSdy.js';
import '../style-types-DqStlGZJ.js';
import '../types-C7D5seeQ.js';
import '../error-snapshot-Cla7Go5B.js';

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
