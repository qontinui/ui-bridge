/**
 * UI Bridge Server
 *
 * HTTP/WebSocket server adapters for UI Bridge.
 */

// Types
export * from './types';

// Express adapter
export {
  createExpressRouter,
  createExpressApp,
  uiBridgeMiddleware,
  type ExpressAdapterConfig,
} from './express';

// Next.js adapter
export {
  createNextRouteHandlers,
  createRenderLogHandlers,
  createControlHandlers,
  createDebugHandlers,
  type NextJSAdapterConfig,
  type NextRouteHandler,
} from './nextjs';

// Standalone server
export {
  StandaloneServer,
  createStandaloneServer,
  startCLI,
  type StandaloneServerConfig,
} from './standalone';
