# Visual Context

Visual Context generates AI-friendly descriptions of the current UI state, enabling LLMs to understand and reason about the interface.

## Overview

Visual Context provides:

- Structured descriptions of all visible elements
- Spatial relationships between elements
- Current state and values
- Interactive capabilities

This context can be passed to AI models to enable intelligent UI automation.

## Usage

### Generate Context

```typescript
import { VisualContextGenerator } from '@anthropic/ui-bridge';

const generator = new VisualContextGenerator(registry);
const context = await generator.generate();

console.log(context);
// {
//   page: { title: 'Login', url: '/login' },
//   elements: [...],
//   focusedElement: 'email-input',
//   forms: [...],
// }
```

### For LLM Prompts

Generate a text description suitable for LLM prompts:

```typescript
const textContext = await generator.generateText();

console.log(textContext);
// Page: Login (/login)
//
// Visible Elements:
// - [input] Email field (id: email-input) - empty text input
// - [input] Password field (id: password-input) - empty password input
// - [button] Sign In (id: signin-btn) - clickable button
// - [link] Forgot Password (id: forgot-link) - navigates to /forgot-password
```

### Selective Context

Generate context for specific areas:

```typescript
// Only form elements
const formContext = await generator.generate({
  filter: { type: ['input', 'select', 'textarea', 'button'] },
});

// Only visible elements
const visibleContext = await generator.generate({
  filter: { visible: true },
});

// Specific region
const headerContext = await generator.generate({
  region: { selector: 'header' },
});
```

## Semantic Snapshots

For AI agents, generate a semantic snapshot:

```typescript
const snapshot = await generator.getSemanticSnapshot();

// Returns structured data optimized for AI understanding
{
  summary: "Login page with email/password form",
  primaryAction: "Sign in with credentials",
  elements: {
    inputs: [
      { id: "email", purpose: "Email address entry", required: true },
      { id: "password", purpose: "Password entry", required: true }
    ],
    buttons: [
      { id: "signin", purpose: "Submit login form", primary: true }
    ]
  },
  suggestedFlow: ["Enter email", "Enter password", "Click sign in"]
}
```

## Page Summary

Get a concise page summary:

```typescript
const summary = await generator.getPageSummary();

console.log(summary);
// {
//   title: "Login",
//   purpose: "User authentication",
//   mainContent: "Login form with email and password fields",
//   availableActions: ["Sign in", "Navigate to forgot password", "Navigate to register"],
//   currentState: "Form empty, ready for input"
// }
```

## Configuration

```typescript
const generator = new VisualContextGenerator(registry, {
  includeHidden: false, // Exclude hidden elements
  includePositions: true, // Include x,y coordinates
  includeBoundingBoxes: true, // Include width/height
  maxElements: 100, // Limit for large pages
  textFormat: 'markdown', // Output format for text
});
```
