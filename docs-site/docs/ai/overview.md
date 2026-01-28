# AI Features Overview

UI Bridge provides powerful AI-native capabilities for intelligent UI automation. These features enable natural language interaction, semantic element discovery, and context-aware navigation.

## Key Capabilities

### Intent-Based Actions

Execute user intentions without specifying exact elements:

```typescript
import { IntentExecutor } from '@anthropic/ui-bridge';

const executor = new IntentExecutor(registry);
const result = await executor.execute('submit the login form');
```

[Learn more about Intent-Based Actions](./intent-based-actions.md)

### Embedding Resolution

Find elements using semantic similarity:

```typescript
import { EmbeddingResolver } from '@anthropic/ui-bridge';

const resolver = new EmbeddingResolver(registry);
const elements = await resolver.findSimilar('email input field');
```

[Learn more about Embedding Resolution](./embedding-resolution.md)

### Visual Context

Generate AI-friendly snapshots of the current UI state:

```typescript
import { VisualContextGenerator } from '@anthropic/ui-bridge';

const generator = new VisualContextGenerator(registry);
const context = await generator.generate();
// Returns structured description of all visible elements
```

[Learn more about Visual Context](./visual-context.md)

### Navigation Assistance

Get intelligent suggestions for reaching target states:

```typescript
import { NavigationAssistant } from '@anthropic/ui-bridge';

const assistant = new NavigationAssistant(registry);
const path = await assistant.findPath('checkout page');
```

[Learn more about Navigation Assistance](./navigation-assistance.md)

## Architecture

The AI features are built on top of the core registry and provide:

1. **Semantic Understanding** - Natural language to UI element mapping
2. **Context Awareness** - Understanding current page state and history
3. **Intelligent Recovery** - Automatic error handling and retry strategies
4. **Structured Feedback** - Clear error messages with recovery suggestions

## Getting Started

Enable AI features in your provider:

```tsx
import { UIBridgeProvider } from '@anthropic/ui-bridge/react';

function App() {
  return (
    <UIBridgeProvider
      enableAI={true}
      aiConfig={{
        embeddingModel: 'default',
        intentRecognition: true,
        visualContext: true,
      }}
    >
      {children}
    </UIBridgeProvider>
  );
}
```

## API Reference

See the [AI API Endpoints](../api/ai-endpoints.md) documentation for the complete REST API reference.
