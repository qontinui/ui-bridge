# Structured Failure Feedback

Structured Failure Feedback provides detailed, actionable error information when UI actions fail.

## Error Codes

UI Bridge defines 14 standard error codes:

| Code | Description |
|------|-------------|
| `ELEMENT_NOT_FOUND` | Target element doesn't exist in the registry |
| `ELEMENT_NOT_VISIBLE` | Element exists but is hidden or off-screen |
| `ELEMENT_DISABLED` | Element is disabled and cannot be interacted with |
| `ELEMENT_OBSCURED` | Element is covered by another element |
| `ACTION_NOT_SUPPORTED` | Element doesn't support the requested action |
| `INVALID_VALUE` | Provided value is invalid for the element |
| `TIMEOUT` | Action didn't complete within the time limit |
| `STALE_ELEMENT` | Element reference is no longer valid |
| `NAVIGATION_FAILED` | Page navigation didn't complete |
| `FORM_VALIDATION_ERROR` | Form validation prevented submission |
| `PERMISSION_DENIED` | Action requires elevated permissions |
| `NETWORK_ERROR` | Network request failed |
| `STATE_MISMATCH` | Current state doesn't match expected state |
| `UNKNOWN_ERROR` | Unclassified error |

## Usage

```typescript
import { executeAction, UIBridgeError } from '@anthropic/ui-bridge';

try {
  await executeAction('submit-btn', 'click');
} catch (error) {
  if (error instanceof UIBridgeError) {
    console.log(error.code);        // 'ELEMENT_NOT_VISIBLE'
    console.log(error.message);     // 'Element submit-btn is not visible'
    console.log(error.suggestions); // ['Scroll element into view', 'Wait for element to appear']
    console.log(error.context);     // { elementId: 'submit-btn', visibility: 'hidden' }
  }
}
```

## Error Context

Each error includes relevant context:

```typescript
interface ErrorContext {
  elementId?: string;
  action?: string;
  expectedState?: any;
  actualState?: any;
  timestamp: number;
  stackTrace?: string;
  screenshot?: string;  // Base64 encoded
}
```

## Recovery Suggestions

Errors include actionable suggestions:

```typescript
const error = await result.error;

error.suggestions.forEach(suggestion => {
  console.log(suggestion);
});
// Output:
// - 'Wait for element to become visible'
// - 'Scroll the page to bring element into view'
// - 'Check if element is inside a collapsed container'
```
