# State Machine Integration

UI Bridge integrates with the `multistate` library to provide explicit state management for UI automation.

## Basic Setup

### Define States

```typescript
import { StateMachine } from '@anthropic/ui-bridge';

const machine = new StateMachine({
  states: {
    'logged-out': {
      description: 'User is not authenticated',
      indicators: [
        { type: 'element-exists', selector: '#login-form' },
        { type: 'url-matches', pattern: /\/(login|signin)/ },
      ],
    },
    'logged-in': {
      description: 'User is authenticated',
      indicators: [
        { type: 'element-exists', selector: '#user-menu' },
        { type: 'element-not-exists', selector: '#login-form' },
      ],
    },
  },
});
```

### Define Transitions

```typescript
machine.addTransitions({
  'logged-out -> logged-in': {
    description: 'User logs in',
    actions: [
      { action: 'type', target: '#email', value: '{{email}}' },
      { action: 'type', target: '#password', value: '{{password}}' },
      { action: 'click', target: '#login-btn' },
    ],
  },
  'logged-in -> logged-out': {
    description: 'User logs out',
    actions: [
      { action: 'click', target: '#user-menu' },
      { action: 'click', target: '#logout-btn' },
    ],
  },
});
```

## State Detection

```typescript
const currentState = await machine.getCurrentState();
console.log(currentState); // 'logged-out'
```

## State Navigation

```typescript
// Automatically finds and executes path to target state
await machine.navigateTo('dashboard', {
  credentials: {
    email: 'user@example.com',
    password: 'secret',
  },
});
```

## State Indicators

### Element-Based

```typescript
{ type: 'element-exists', selector: '#user-menu' }
{ type: 'element-not-exists', selector: '#login-form' }
{ type: 'element-visible', selector: '.dashboard' }
{ type: 'element-has-text', selector: '#status', text: 'Connected' }
```

### URL-Based

```typescript
{ type: 'url-matches', pattern: /\/dashboard/ }
{ type: 'url-equals', url: '/settings' }
```

## Visualization

```typescript
const diagram = machine.toMermaid();
// stateDiagram-v2
//   [*] --> logged_out
//   logged_out --> logged_in: login
//   logged_in --> logged_out: logout
```
