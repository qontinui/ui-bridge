# Logging & Tracing

UI Bridge provides comprehensive logging and distributed tracing capabilities.

## Basic Logging

```typescript
import { configureLogging, logger } from '@anthropic/ui-bridge';

configureLogging({
  level: 'debug',
  format: 'json',
  output: console,
});

logger.info('Action executed', {
  action: 'click',
  element: 'submit-btn',
  duration: 150,
});
```

## Log Levels

| Level   | Description           |
| ------- | --------------------- |
| `error` | Failures and errors   |
| `warn`  | Potential issues      |
| `info`  | Important events      |
| `debug` | Detailed information  |
| `trace` | Very detailed tracing |

## Distributed Tracing

### W3C Trace Context

```typescript
import { createTrace, withTrace } from '@anthropic/ui-bridge';

const trace = createTrace();

await withTrace(trace, async () => {
  await registry.executeAction('submit-btn', 'click');
  await registry.executeAction('confirm-btn', 'click');
});
```

### Trace Propagation

```typescript
import { getTraceHeaders } from '@anthropic/ui-bridge';

const headers = getTraceHeaders();
// { 'traceparent': '00-abc123-def456-01', 'tracestate': '...' }

await fetch('/api/submit', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
});
```

### Spans

```typescript
import { startSpan } from '@anthropic/ui-bridge';

const span = startSpan('login-flow');

try {
  await registry.executeAction('email-input', 'type', 'user@example.com');
  await registry.executeAction('login-btn', 'click');
  span.setStatus('success');
} catch (error) {
  span.setStatus('error', error.message);
  throw error;
} finally {
  span.end();
}
```

## Custom Log Handlers

```typescript
configureLogging({
  handlers: [
    { type: 'console', level: 'debug', format: 'text' },
    {
      type: 'http',
      url: 'https://logs.example.com/ingest',
      level: 'info',
      batchSize: 100,
    },
  ],
});
```
