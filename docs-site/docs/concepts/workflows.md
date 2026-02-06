---
sidebar_position: 4
---

# Workflows

Workflows are pre-defined sequences of actions that can be executed as a unit. They're useful for automating complex multi-step processes.

## Defining Workflows

### In React

Register workflows using the registry:

```tsx
import { useEffect } from 'react';
import { getGlobalRegistry } from 'ui-bridge';

function App() {
  useEffect(() => {
    const registry = getGlobalRegistry();

    registry.registerWorkflow({
      id: 'login-workflow',
      name: 'User Login',
      description: 'Complete user login process',
      steps: [
        {
          id: 'enter-email',
          type: 'action',
          target: 'login-email',
          action: 'type',
          params: { text: '{{email}}' },
        },
        {
          id: 'enter-password',
          type: 'action',
          target: 'login-password',
          action: 'type',
          params: { text: '{{password}}' },
        },
        {
          id: 'submit',
          type: 'action',
          target: 'login-submit',
          action: 'click',
        },
      ],
    });
  }, []);

  return <LoginForm />;
}
```

## Workflow Structure

```typescript
interface Workflow {
  id: string; // Unique identifier
  name: string; // Display name
  description?: string; // Optional description
  steps: WorkflowStep[]; // Array of steps
  variables?: Record<string, any>; // Default variable values
}

interface WorkflowStep {
  id: string; // Step identifier
  type: 'action' | 'wait' | 'condition' | 'component';
  target?: string; // Element or component ID
  action?: string; // Action to perform
  params?: Record<string, any>; // Action parameters
  waitFor?: string; // Wait condition
  condition?: string; // Conditional expression
  timeout?: number; // Step timeout (ms)
}
```

## Step Types

### Action Steps

Execute an action on an element:

```typescript
{
  id: 'click-button',
  type: 'action',
  target: 'submit-btn',
  action: 'click',
}
```

With parameters:

```typescript
{
  id: 'type-email',
  type: 'action',
  target: 'email-input',
  action: 'type',
  params: { text: 'user@example.com' },
}
```

### Wait Steps

Wait for a condition:

```typescript
{
  id: 'wait-for-modal',
  type: 'wait',
  target: 'success-modal',
  waitFor: 'visible',
  timeout: 5000,
}
```

### Component Action Steps

Execute a component action:

```typescript
{
  id: 'submit-form',
  type: 'component',
  target: 'checkout-form',
  action: 'submit',
  params: { paymentMethod: 'credit-card' },
}
```

## Running Workflows

### From Python

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient()

# Run with variables
result = client.run_workflow(
    workflow_id='login-workflow',
    params={
        'email': 'user@example.com',
        'password': 'secret123',
    }
)

print(f"Success: {result.success}")
print(f"Steps completed: {result.steps_completed}/{result.total_steps}")
print(f"Duration: {result.duration_ms}ms")
```

### Using Workflow Control

```python
# Get a workflow interface
workflow = client.workflow('login-workflow')

# Run it
result = workflow.run({
    'email': 'user@example.com',
    'password': 'secret123',
})
```

### With Step Control

```python
# Start from a specific step
result = client.run_workflow(
    'checkout-workflow',
    start_step='enter-payment',
    stop_step='review-order',
)
```

## Variables

Use variables in workflow steps with `{{variable}}` syntax:

```typescript
{
  steps: [
    {
      id: 'type-search',
      type: 'action',
      target: 'search-input',
      action: 'type',
      params: { text: '{{searchTerm}}' },
    },
  ],
}
```

Pass values when running:

```python
result = client.run_workflow('search-workflow', params={
    'searchTerm': 'ui bridge documentation'
})
```

### Default Variables

Define defaults in the workflow:

```typescript
{
  id: 'greet-workflow',
  name: 'Greeting',
  variables: {
    greeting: 'Hello',
    name: 'World',
  },
  steps: [
    {
      id: 'type-greeting',
      type: 'action',
      target: 'message-input',
      action: 'type',
      params: { text: '{{greeting}}, {{name}}!' },
    },
  ],
}
```

## Workflow Results

```python
result = client.run_workflow('checkout-workflow')

# Overall result
print(result.workflow_id)     # 'checkout-workflow'
print(result.success)         # True/False
print(result.steps_completed) # Number of completed steps
print(result.total_steps)     # Total steps
print(result.duration_ms)     # Total duration

# Error info (if failed)
print(result.error)           # Error message
print(result.failed_step)     # Step ID that failed
```

## Error Handling

```python
try:
    result = client.run_workflow('risky-workflow')
    if not result.success:
        print(f"Workflow failed at step: {result.failed_step}")
        print(f"Error: {result.error}")
except Exception as e:
    print(f"Workflow execution error: {e}")
```

## Best Practices

### 1. Use Descriptive Step IDs

```typescript
// Good
{ id: 'enter-shipping-address', ... }
{ id: 'select-payment-method', ... }

// Avoid
{ id: 'step1', ... }
{ id: 's2', ... }
```

### 2. Add Timeouts

```typescript
{
  id: 'wait-for-confirmation',
  type: 'wait',
  target: 'confirmation-modal',
  waitFor: 'visible',
  timeout: 10000,  // 10 seconds
}
```

### 3. Handle Dynamic Content

For elements that may take time to appear:

```typescript
{
  id: 'click-dynamic-button',
  type: 'action',
  target: 'async-button',
  action: 'click',
  waitFor: 'visible',
}
```

### 4. Keep Workflows Focused

Create separate workflows for distinct processes rather than one large workflow.
