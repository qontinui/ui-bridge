/**
 * UI Bridge Server
 *
 * HTTP/WebSocket server adapters for UI Bridge.
 */

// Types
export * from './types';

// Handler factory
export {
  createHandlers,
  createAIHandlers,
  closeAllSpawnedHeadlessTabs,
  type RegistryLike,
  type ActionExecutorLike,
  type CreateHandlersConfig,
} from './handlers';

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
  createUIBridgeHandler,
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

// WebSocket handler
export { UIBridgeWSHandler, type WebSocketLike } from './websocket-handler';

// WebSocket stream adapter
export {
  createWSStreamBroadcast,
  WSStreamAdapter,
  type WSStreamAdapterConfig,
} from './ws-stream-adapter';

// SSE handler
export { SSEManager } from './sse-handler';

// Command relay
export {
  CommandRelay,
  TabRoutingError,
  type QueuedCommand,
  type CommandListener,
  type TabListener,
  type PendingCommand,
  type WebSocketClient,
  type TabInfo,
  type TransportDiagnostics,
  type CommandRelayOptions,
} from './command-relay';

// Relay handlers
export { createRelayHandlers, type RelayHandlersOptions } from './relay-handlers';

// CDP tab discovery
export { CDPTabDiscovery, type CDPTarget, type CDPTabsConfig } from './cdp-tabs';

// Shared selector matcher (single source of truth for element filter queries)
export {
  matchesElementSelector,
  type MatchableElement,
  type ElementSelector,
} from './selector-match';
