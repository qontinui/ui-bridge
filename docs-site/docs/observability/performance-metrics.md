# Performance Metrics

UI Bridge collects performance metrics to help you understand and optimize automation performance.

## Enabling Metrics

```typescript
import { configureMetrics } from '@anthropic/ui-bridge';

configureMetrics({
  enabled: true,
  collectInterval: 1000,
  historySize: 1000,
});
```

## Built-in Metrics

### Action Metrics

```typescript
import { getActionMetrics } from '@anthropic/ui-bridge';

const metrics = getActionMetrics();
// {
//   totalActions: 150,
//   successRate: 0.98,
//   avgDuration: 245,
//   p50Duration: 180,
//   p95Duration: 450,
//   p99Duration: 890,
// }
```

### Discovery Metrics

```typescript
import { getDiscoveryMetrics } from '@anthropic/ui-bridge';

const metrics = getDiscoveryMetrics();
// { totalDiscoveries: 25, avgDiscoveryTime: 45, elementCount: 150 }
```

## Real-Time Monitoring

```typescript
import { subscribeToMetrics } from '@anthropic/ui-bridge';

const unsubscribe = subscribeToMetrics((metrics) => {
  console.log('Current metrics:', metrics);
});
```

## Custom Metrics

```typescript
import { recordMetric } from '@anthropic/ui-bridge';

recordMetric('custom.checkout.time', 2500);
recordMetric('custom.cart.items', 3);
```

## Export Formats

```typescript
import { exportPrometheus, exportMetrics } from '@anthropic/ui-bridge';

// Prometheus format
const prometheus = exportPrometheus();

// JSON format
const json = exportMetrics('json');
```

## Dashboard

```typescript
import { MetricsDashboard } from '@anthropic/ui-bridge/react';

function App() {
  return (
    <div>
      <MetricsDashboard position="bottom-right" collapsed={true} />
      {/* Your app */}
    </div>
  );
}
```
