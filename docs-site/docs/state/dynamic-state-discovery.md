# Dynamic State Discovery

Dynamic State Discovery automatically learns and tracks application states without explicit configuration.

## Enabling Discovery

```typescript
import { StateDiscovery } from '@anthropic/ui-bridge';

const discovery = new StateDiscovery(registry, {
  enabled: true,
  learningMode: 'active',
});

await discovery.start();
```

## Learning Modes

### Passive Learning

Learns by observing user interactions:

```typescript
const discovery = new StateDiscovery(registry, {
  learningMode: 'passive',
});
```

### Active Learning

Actively explores the UI to discover states:

```typescript
const discovery = new StateDiscovery(registry, {
  learningMode: 'active',
  explorationStrategy: 'breadth-first',
  maxExplorationDepth: 5,
});
```

## Discovered States

```typescript
const states = discovery.getDiscoveredStates();

states.forEach((state) => {
  console.log(`${state.id}: ${state.description}`);
  console.log(`  URL: ${state.signature.url}`);
});
```

## Export and Import

```typescript
// Export
const model = discovery.export();
await fs.writeFile('state-model.json', JSON.stringify(model));

// Import
const saved = JSON.parse(await fs.readFile('state-model.json'));
discovery.import(saved);

// Convert to StateMachine
const stateMachine = discovery.toStateMachine();
```

## Configuration

```typescript
const discovery = new StateDiscovery(registry, {
  enabled: true,
  learningMode: 'passive',
  signatureComponents: {
    url: true,
    title: true,
    forms: true,
  },
  mergeThreshold: 0.85,
  autoMerge: false,
});
```
