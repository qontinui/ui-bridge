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

// Page health diagnostics (producer `sdk-server/page-health`)
export {
  diagnosePageHealth,
  pageHealthUnknown,
  SERVER_PAGE_HEALTH_PRODUCER_ID,
  type PageHealthValue,
  type PageHealthObservation,
  type PageHealthInput,
  type PageHealthOptions,
  type PageHealthFinding,
  type PageHealthSeverity,
} from './page-health';

// The observation envelope every page-health answer rides in — re-exported so
// a server consumer need not import `@qontinui/ui-bridge/observation` itself.
export {
  Observation,
  ObservationError,
  UNKNOWN_CODES,
  isUnknownCode,
  type UnknownCode,
  type ObservationStatus,
  type ObservationProducer,
  type ObservationCoverage,
  type UnmeasuredDimension,
  type ObservationCache,
  type ObservationProvenance,
  type ObservationUnknown,
  type MeasuredObservation,
  type AbsentObservation,
  type UnknownObservation,
} from '@qontinui/ui-bridge/observation';
