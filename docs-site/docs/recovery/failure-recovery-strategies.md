# Failure Recovery Strategies

UI Bridge provides automated recovery strategies to handle common failure scenarios.

## Built-in Strategies

### 1. Wait and Retry

```typescript
{
  strategy: 'wait-retry',
  config: {
    maxWait: 5000,
    pollInterval: 100,
    condition: 'visible',
  }
}
```

### 2. Scroll Into View

```typescript
{
  strategy: 'scroll-into-view',
  config: {
    behavior: 'smooth',
    block: 'center',
    timeout: 2000,
  }
}
```

### 3. Close Overlays

```typescript
{
  strategy: 'close-overlays',
  config: {
    selectors: ['.modal', '.popup', '.overlay', '[role="dialog"]'],
    closeMethod: 'click-outside',
  }
}
```

### 4. Refresh Registry

```typescript
{
  strategy: 'refresh-registry',
  config: {
    scope: 'all',
    timeout: 3000,
  }
}
```

### 5. Wait for Navigation

```typescript
{
  strategy: 'wait-navigation',
  config: {
    timeout: 10000,
    waitUntil: 'networkidle',
  }
}
```

### 6. Alternative Element

```typescript
{
  strategy: 'alternative-element',
  config: {
    alternatives: ['submit-btn-2', 'form-submit', '[type="submit"]'],
    matchBy: 'id',
  }
}
```

## Configuration

```typescript
import { configureRecovery } from '@anthropic/ui-bridge';

configureRecovery({
  enabled: true,
  maxAttempts: 3,
  strategies: [
    { strategy: 'wait-retry', priority: 1 },
    { strategy: 'scroll-into-view', priority: 2 },
    { strategy: 'close-overlays', priority: 3 },
    { strategy: 'refresh-registry', priority: 4 },
  ],
});
```

## Error-Specific Strategies

```typescript
configureRecovery({
  errorStrategies: {
    ELEMENT_NOT_VISIBLE: ['scroll-into-view', 'wait-retry'],
    ELEMENT_OBSCURED: ['close-overlays', 'scroll-into-view'],
    STALE_ELEMENT: ['refresh-registry', 'wait-retry'],
    TIMEOUT: ['wait-retry'],
  },
});
```

## Custom Strategies

```typescript
import { registerStrategy } from '@anthropic/ui-bridge';

registerStrategy({
  name: 'dismiss-cookies',
  description: 'Dismiss cookie consent banner',
  async execute(context) {
    const banner = document.querySelector('.cookie-banner');
    if (banner) {
      const acceptBtn = banner.querySelector('.accept');
      if (acceptBtn) {
        acceptBtn.click();
        return { success: true };
      }
    }
    return { success: false, reason: 'No cookie banner found' };
  },
});
```
