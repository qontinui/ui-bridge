# Intent-Based Actions

Intent-based actions allow you to execute user intentions using natural language, without specifying exact element selectors or IDs.

## Overview

Instead of writing:
```typescript
await registry.executeAction('ui-login-form-submit-button', 'click');
```

You can write:
```typescript
await executor.execute('submit the login form');
```

The intent system understands common UI patterns and maps natural language to the appropriate actions.

## Built-in Intents

UI Bridge includes 11 built-in intents:

| Intent | Description | Example |
|--------|-------------|---------|
| `click` | Click on an element | "click the submit button" |
| `type` | Enter text into a field | "type hello into the search box" |
| `select` | Choose from a dropdown | "select California from state dropdown" |
| `check` | Check a checkbox | "check the terms checkbox" |
| `uncheck` | Uncheck a checkbox | "uncheck remember me" |
| `scroll` | Scroll to an element | "scroll to the footer" |
| `hover` | Hover over an element | "hover over the menu" |
| `focus` | Focus an input | "focus the email field" |
| `clear` | Clear an input | "clear the search input" |
| `submit` | Submit a form | "submit the login form" |
| `navigate` | Navigate to a page | "navigate to settings" |

## Usage

### Basic Execution

```typescript
import { IntentExecutor } from '@anthropic/ui-bridge';

const executor = new IntentExecutor(registry);

// Simple click
await executor.execute('click the login button');

// Type into a field
await executor.execute('type "user@example.com" into email field');

// Select from dropdown
await executor.execute('select "United States" from country dropdown');
```

### With Context

Provide additional context for better intent resolution:

```typescript
const result = await executor.execute('submit the form', {
  context: {
    currentPage: 'registration',
    formState: 'filled',
  },
  timeout: 5000,
});
```

### Intent Result

The executor returns a detailed result:

```typescript
interface IntentResult {
  success: boolean;
  intent: {
    action: string;      // e.g., 'click'
    target: string;      // e.g., 'login button'
    value?: string;      // e.g., 'user@example.com' for type intent
  };
  element?: {
    id: string;
    type: string;
  };
  error?: {
    code: string;
    message: string;
    suggestions: string[];
  };
}
```

## Custom Intents

Register custom intents for domain-specific actions:

```typescript
executor.registerIntent({
  name: 'add-to-cart',
  patterns: [
    /add (?:the )?(.+) to (?:my )?cart/i,
    /buy (?:the )?(.+)/i,
  ],
  handler: async (match, registry) => {
    const productName = match[1];
    const element = await registry.findByText(productName);
    const addButton = await registry.findNearby(element, 'button', 'Add to Cart');
    await addButton.click();
  },
});

// Now you can use it
await executor.execute('add the blue shirt to cart');
```

## Error Handling

When intent execution fails, you get structured feedback:

```typescript
const result = await executor.execute('click the checkout button');

if (!result.success) {
  console.log(result.error.code);        // 'ELEMENT_NOT_FOUND'
  console.log(result.error.message);     // 'Could not find element matching "checkout button"'
  console.log(result.error.suggestions); // ['Try "proceed to checkout"', 'Element may not be visible']
}
```

## Configuration

```typescript
const executor = new IntentExecutor(registry, {
  fuzzyMatch: true,           // Allow fuzzy text matching
  fuzzyThreshold: 0.8,        // Minimum similarity score
  timeout: 10000,             // Global timeout for actions
  retries: 3,                 // Number of retry attempts
  waitForVisible: true,       // Wait for elements to be visible
});
```
