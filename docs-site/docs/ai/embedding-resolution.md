# Embedding Resolution

Embedding resolution enables semantic search for UI elements using vector embeddings. Find elements by meaning rather than exact text matches.

## Overview

Traditional element lookup requires exact matches:

```typescript
// Only finds exact text match
registry.findByText('Submit Order');
```

With embedding resolution, you can find semantically similar elements:

```typescript
// Finds "Submit Order", "Place Order", "Complete Purchase", etc.
const elements = await resolver.findSimilar('confirm my purchase');
```

## How It Works

1. **Indexing** - Element text, labels, and attributes are converted to vector embeddings
2. **Query** - Your search query is converted to an embedding
3. **Similarity** - Cosine similarity finds the closest matches
4. **Ranking** - Results are ranked by relevance score

## Usage

### Basic Search

```typescript
import { EmbeddingResolver } from '@anthropic/ui-bridge';

const resolver = new EmbeddingResolver(registry);

// Find semantically similar elements
const results = await resolver.findSimilar('login button');

// Returns ranked results
results.forEach(({ element, score }) => {
  console.log(`${element.id}: ${score}`);
});
```

### With Filters

Narrow down results by element type or attributes:

```typescript
const results = await resolver.findSimilar('email field', {
  type: 'input',
  role: 'textbox',
  limit: 5,
});
```

### Threshold-Based Matching

Only return results above a confidence threshold:

```typescript
const results = await resolver.findSimilar('shopping cart', {
  threshold: 0.75, // Only results with 75%+ similarity
});
```

## Embedding Models

### Built-in Model

UI Bridge includes a lightweight embedding model suitable for most use cases:

```typescript
const resolver = new EmbeddingResolver(registry, {
  model: 'default',
});
```

### Custom Models

Use your own embedding model for specialized vocabularies:

```typescript
const resolver = new EmbeddingResolver(registry, {
  model: 'custom',
  embedFunction: async (text: string) => {
    // Call your embedding API
    const response = await fetch('/api/embed', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return response.json(); // Returns number[]
  },
});
```

## Element Text Sources

Embeddings are generated from multiple text sources:

| Source            | Weight | Example                |
| ----------------- | ------ | ---------------------- |
| `innerText`       | 1.0    | "Submit Order"         |
| `aria-label`      | 0.9    | "Place your order"     |
| `placeholder`     | 0.8    | "Enter email address"  |
| `title`           | 0.7    | "Click to submit"      |
| `data-ui-aliases` | 0.85   | "submit,confirm,order" |

Weights affect the final similarity score.

## API Reference

### EmbeddingResolver

```typescript
class EmbeddingResolver {
  constructor(registry: UIBridgeRegistry, options?: EmbeddingResolverOptions);

  findSimilar(query: string, options?: FindSimilarOptions): Promise<SimilarityResult[]>;

  generateIndex(): Promise<EmbeddingIndex>;

  updateIndex(elementId: string): Promise<void>;
}
```

### FindSimilarOptions

```typescript
interface FindSimilarOptions {
  threshold?: number; // Minimum similarity (0-1)
  limit?: number; // Max results to return
  type?: string; // Filter by element type
  role?: string; // Filter by ARIA role
  visible?: boolean; // Only visible elements
}
```
