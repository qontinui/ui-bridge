# WebSocket Communication

The HTTP control API is request/response: you ask, the page answers. WebSocket
adds the other direction — the page pushes bridge events as they happen, so a
driver can react to a modal opening or a workflow step completing instead of
polling for it.

WebSocket is **additive, not an alternative transport**. The same handler set
serves both, and turning WebSocket on does not turn the HTTP routes off.

## Server Side

`StandaloneServer` speaks both. Build a handler set, then start the server with
`websocket: true`:

```typescript
import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
import { createHandlers } from '@qontinui/ui-bridge-server';
import { createStandaloneServer } from '@qontinui/ui-bridge-server/standalone';

const registry = getGlobalRegistry();
const handlers = createHandlers(registry, createActionExecutor(registry));

const server = await createStandaloneServer(handlers, {
  host: 'localhost',
  port: 9876,
  websocket: true,
  websocketPort: 9876, // defaults to `port`
});

console.log(server.getAddress()); // { host: 'localhost', port: 9876 }
```

`createStandaloneServer` **starts** the server before it resolves — there is no
separate `server.start()` call to make after it. Use `new StandaloneServer(…)`
directly if you want to construct and start in separate steps.

The server can push to every connected client:

```typescript
server.broadcastEvent({ type: 'element:registered', data: { elementId: 'save-btn' }, timestamp: Date.now() });
server.broadcast({ type: 'event', channel: 'custom', data: { cartTotal: 42 }, timestamp: Date.now() });

await server.stop();
```

`broadcastEvent` takes a `BridgeEvent`; `broadcast` takes a raw
`WebSocketMessage` whose `type` is one of `subscribe`, `unsubscribe`, `event`,
`snapshot`, `action` or `error`.

### Mounting on Your Own Server

If you already run a `ws` (or compatible) server, use `UIBridgeWSHandler`
directly instead of `StandaloneServer`. It has no transport of its own — you
hand it socket objects:

```typescript
import { UIBridgeWSHandler } from '@qontinui/ui-bridge-server';

const wsHandler = new UIBridgeWSHandler(handlers, { verbose: true });

wss.on('connection', (ws, req) => {
  const tabId = new URL(req.url!, 'http://localhost').searchParams.get('tabId') ?? undefined;
  const clientId = wsHandler.handleConnection(ws, tabId);

  ws.on('close', () => wsHandler.handleDisconnect(clientId, ws));
});
```

Passing the client's own stable id as `preferredId` is what keeps a browser tab
identified across reconnects rather than minting a new id each time.
`wsHandler.broadcastEvent(event)` fans an event out to subscribers, and
`wsHandler.disconnectAll()` closes every socket.

A running `StandaloneServer` exposes its handler via `server.getWSHandler()`.

## Client Side

```typescript
import { createWSClient } from '@qontinui/ui-bridge';

const client = createWSClient({
  url: 'ws://localhost:9876',
  tabId: 'my-tab',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 10, // 0 = infinite
  pingInterval: 30000, // 0 = disabled
  connectionTimeout: 10000,
});

await client.connect();
```

Those seven fields are the entire `WSClientConfig`. There is no `transport`
option (the client is WebSocket-only), no `auth` block and no `fallback` block:
authentication belongs to whatever fronts the socket, and falling back to HTTP
means calling the HTTP routes, which are always there. `new UIBridgeWSClient(config)`
is the class form of `createWSClient`.

### Subscribing to Events

Subscribe by event type, and optionally narrow to specific elements or
components:

```typescript
await client.subscribe({
  events: ['element:stateChanged', 'action:completed', 'navigation:change'],
  elementIds: ['cart-total'],
});

const unsubscribe = client.onEvent('element:stateChanged', (event) => {
  console.log(event.type, event.data);
});

client.onEvent('*', (event) => console.log('any event', event.type));

await client.unsubscribe(['navigation:change']); // or unsubscribe() for all
```

`BridgeEventType` covers element lifecycle (`element:registered`,
`element:unregistered`, `element:stateChanged`), components
(`component:registered`, `component:unregistered`), actions (`action:started`,
`action:completed`, `action:failed`), workflows (`workflow:started`,
`workflow:stepCompleted`, `workflow:completed`, `workflow:failed`), idle
detection (`app:busy`/`app:idle`, `network:*`, `dom:mutating`/`dom:settled`,
`loading:*`, `form:*`), `navigation:change`, toasts (`toast:appeared`,
`toast:dismissed`), captured browser events (`browser:error`,
`browser:warning`, `browser:crash`), `render:snapshot` and `error`.

### Requests Over the Socket

The client is not read-only — the same operations the HTTP API offers are
available as awaited requests:

```typescript
const snapshot = await client.getSnapshot();
const elements = await client.find({ interactiveOnly: true, includeState: true });
const element = await client.getElement('save-btn');

await client.executeAction('save-btn', { action: 'click' });
await client.executeComponentAction('login-form', 'login', { email, password });
```

Workflows can stream their progress, which is the main thing the socket buys you
over HTTP:

```typescript
const result = await client.executeWorkflow('checkout', { coupon: 'SAVE10' }, (progress) => {
  console.log(`${progress.currentStep}/${progress.totalSteps}: ${progress.step.id} ${progress.step.status}`);
});
```

## Connection Management

Reconnection is built in and on by default. Observe it rather than
reimplementing it:

```typescript
client.onConnectionChange((state) => {
  // 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  console.log('ws', state);
});

client.onError((err) => console.error(err));

client.reconnectNow(); // force an immediate reconnect attempt
client.disconnect(); // stop, and stop auto-reconnecting
```

`reconnectDelay` backs off between attempts up to `maxReconnectAttempts`
(`0` meaning "keep trying"), and `pingInterval` keeps an idle connection alive.
Subscriptions are re-applied on reconnect, so listeners registered with
`onEvent` keep working across a drop.

## In React

`UIBridgeProvider` creates and manages the client when the WebSocket config is
set — you do not construct one yourself:

```tsx
import { UIBridgeProvider, useUIBridgeContext } from '@qontinui/ui-bridge';

function App({ children }: { children: React.ReactNode }) {
  return (
    <UIBridgeProvider config={{ websocket: true, websocketPort: 9876 }}>
      {children}
    </UIBridgeProvider>
  );
}

function ConnectionBadge() {
  const { wsClient, wsConnectionState } = useUIBridgeContext();
  return <span data-connected={wsConnectionState === 'connected'}>{wsConnectionState}</span>;
}
```

`wsClient` is `undefined` when WebSocket is not enabled, so guard on it before
calling into it.
