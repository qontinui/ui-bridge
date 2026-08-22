# Performance Metrics

UI Bridge collects performance metrics to help you understand and optimize automation performance.

Metrics are produced by a **`MetricsCollector`** — an in-process ring buffer of
action history that aggregates into a `PerformanceMetrics` snapshot on demand.
There is no background sampling loop and no push channel: you record actions
into the collector, and you read an aggregate out of it when you want one.

## Enabling Metrics

Inside a React app the provider builds the collector for you when the `debug`
feature is on:

```tsx
import { UIBridgeProvider } from '@qontinui/ui-bridge/react';

function App() {
  return (
    <UIBridgeProvider features={{ control: true, debug: true }}>
      <YourApp />
    </UIBridgeProvider>
  );
}
```

With `debug: false` (the default) no collector is constructed and the metrics
reads below return `undefined`.

Outside React — a Node driver, a test harness, a standalone server — construct
one directly:

```typescript
import { createMetricsCollector } from '@qontinui/ui-bridge';
import type { MetricsCollectorOptions } from '@qontinui/ui-bridge';

const options: MetricsCollectorOptions = {
  // Ring-buffer size; oldest entries are dropped past this. Default 1000.
  maxHistoryEntries: 1000,
  // Window used for the actionsPerSecond rate, in ms. Default 60000.
  rateWindow: 60_000,
};

const metrics = createMetricsCollector(options);
```

`createMetricsCollector` is a thin factory over the `MetricsCollector` class,
which is exported too if you prefer `new`:

```typescript
import { MetricsCollector } from '@qontinui/ui-bridge';

const metrics = new MetricsCollector({ maxHistoryEntries: 5000 });
```

## Recording Actions

A collector is fed, not scraped. There are two ways in.

### From bridge events

`recordEvent` accepts a `BridgeEvent` and records the `action:completed` and
`action:failed` ones, ignoring everything else. This is exactly how the React
provider wires itself up, and it is the path to use if you already have a
registry:

```typescript
import { getGlobalRegistry } from '@qontinui/ui-bridge';
import type { BridgeEvent } from '@qontinui/ui-bridge';

const registry = getGlobalRegistry();

const unsubCompleted = registry.on('action:completed', (event: BridgeEvent) => {
  metrics.recordEvent(event);
});
const unsubFailed = registry.on('action:failed', (event: BridgeEvent) => {
  metrics.recordEvent(event);
});
```

`registry.on` takes one concrete event type and returns its own unsubscribe
function — there is no wildcard subscription, so subscribe to both action
events if you want failures counted.

### Directly, per action

If you are driving actions yourself, record the response you got back:

```typescript
import { createActionExecutor } from '@qontinui/ui-bridge';
import type { ControlActionResponse } from '@qontinui/ui-bridge';

const executor = createActionExecutor(registry);

const response: ControlActionResponse = await executor.executeAction('login-btn', {
  action: 'click',
});

metrics.recordElementAction('login-btn', 'click', response);
```

The sibling recorders cover the other two action kinds:

```typescript
metrics.recordComponentAction('login-form', 'login', componentResponse);
metrics.recordWorkflowStep('checkout-flow', stepResult);
```

Each recorder returns the `ActionHistoryEntry` it appended — `id`, `timestamp`,
`type` (`element` / `component` / `workflow-step`), `target`, `action`,
`success`, `durationMs`, and `error` when it failed.

## Reading Metrics

`getMetrics()` aggregates the whole buffer into a `PerformanceMetrics`. Pass a
timestamp to aggregate only entries at or after it:

```typescript
import type { PerformanceMetrics } from '@qontinui/ui-bridge';

const all: PerformanceMetrics = metrics.getMetrics();
const lastFiveMinutes = metrics.getMetrics(Date.now() - 5 * 60_000);

// {
//   totalActions: 150,
//   successfulActions: 147,
//   failedActions: 3,
//   successRate: 0.98,
//   avgDurationMs: 245,
//   minDurationMs: 12,
//   maxDurationMs: 1890,
//   p95DurationMs: 450,
//   actionsPerSecond: 2.5,
//   errorsByType: { TimeoutError: 2, NotFound: 1 },
//   actionsByType: { 'element:click': 120, 'element:type': 30 },
// }
```

Note the exact field names — durations are `avgDurationMs` / `minDurationMs` /
`maxDurationMs` / `p95DurationMs`. There is no p50 or p99 in the snapshot; the
only percentile computed is p95. An empty buffer returns the same shape with
every number at `0` rather than `null` or a throw.

Two formatters ship alongside for display:

```typescript
import { formatDuration, formatPercentage } from '@qontinui/ui-bridge';

formatDuration(245); // '245ms'
formatDuration(2450); // '2.5s'
formatPercentage(0.98); // '98.0%'
```

## Querying History

The aggregate is derived; the history is the primary record, and it is
filterable:

```typescript
import type { ActionHistoryEntry } from '@qontinui/ui-bridge';

const failedClicks: ActionHistoryEntry[] = metrics.getHistory({
  type: 'element',
  action: 'click',
  success: false,
  since: Date.now() - 60_000,
  limit: 50,
});
```

Every filter is optional and they compose; `limit` takes the most recent N
after filtering.

Two shortcuts cover the common triage questions:

```typescript
const errors = metrics.getRecentErrors(10); // last 10 failed entries
const slowest = metrics.getSlowestActions(10); // 10 highest durationMs
```

## Export and Import

History serializes to JSON — useful for attaching a run's action log to a CI
artifact, or for replaying one collector's buffer into another:

```typescript
const json = metrics.exportHistory();

const restored = createMetricsCollector();
restored.importHistory(json);
```

`importHistory` keeps only the most recent `maxHistoryEntries` from the JSON, so
importing a larger buffer into a smaller collector truncates rather than grows
it. To start clean:

```typescript
metrics.clearHistory();
```

## Reading Metrics Over HTTP

When the bridge server is running, the collector's aggregate is served at:

```http
GET /debug/metrics
```

The response is the `PerformanceMetrics` object above, wrapped in the standard
API envelope. When no collector is attached to the registry, the route degrades
to a registry census (`elementCount`, `componentCount`) rather than failing —
so check for the metric fields you need instead of assuming they are present.

The companion route serves the raw entries:

```http
GET /debug/action-history?limit=100
```

From the Python client:

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:9876")
metrics = client.get_metrics()  # -> PerformanceMetrics
print(metrics.success_rate, metrics.p95_duration_ms)

history = client.get_action_history(limit=100)
```

## Reading Metrics From React

`useUIBridge` exposes the provider's collector through two reads. Both return
`undefined` when the `debug` feature is off:

```tsx
import { useUIBridge } from '@qontinui/ui-bridge/react';
import type { PerformanceMetrics } from '@qontinui/ui-bridge';

function MetricsPanel() {
  const bridge = useUIBridge();

  const snapshot = bridge.getMetrics() as PerformanceMetrics | undefined;
  if (!snapshot) return <p>Metrics disabled — enable the debug feature.</p>;

  return (
    <dl>
      <dt>Actions</dt>
      <dd>{snapshot.totalActions}</dd>
      <dt>Success rate</dt>
      <dd>{(snapshot.successRate * 100).toFixed(1)}%</dd>
      <dt>p95</dt>
      <dd>{snapshot.p95DurationMs}ms</dd>
    </dl>
  );
}
```

`bridge.getActionHistory()` returns the entries behind that snapshot.

Both are plain reads, not subscriptions — nothing re-renders on its own. If you
want a live panel, poll on an interval you choose, or re-read inside your own
event handler.
