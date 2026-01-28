# Accessibility

UI Bridge includes accessibility features for WCAG validation and ARIA attribute extraction.

## WCAG Validation

```typescript
import { validateAccessibility } from '@anthropic/ui-bridge';

const results = await validateAccessibility({
  level: 'AA',
  scope: document.body,
});

console.log(results);
// { passed: 45, failed: 3, warnings: 7, violations: [...] }
```

## ARIA Extraction

```typescript
import { getAriaAttributes } from '@anthropic/ui-bridge';

const aria = getAriaAttributes(element);
// { role: 'button', label: 'Submit form', disabled: false }
```

## Accessibility Tree

```typescript
import { getAccessibilityTree } from '@anthropic/ui-bridge';

const tree = await getAccessibilityTree();
// { role: 'document', name: 'Login Page', children: [...] }
```

## Accessible Element Discovery

```typescript
// Find by accessible name
const elements = await registry.findByAccessibleName('Submit');

// Find by role
const buttons = await registry.findByRole('button');

// Find by landmark
const main = await registry.findByLandmark('main');
```

## Keyboard Navigation

```typescript
import { pressKey, tabTo } from '@anthropic/ui-bridge';

await tabTo('Email input');
await pressKey('Tab');
await pressKey('Enter');
```

## Screen Reader Support

```typescript
import { announce } from '@anthropic/ui-bridge';

announce('Form submitted successfully', 'polite');
announce('Error: Invalid email address', 'assertive');
```

## Configuration

```typescript
import { configureAccessibility } from '@anthropic/ui-bridge';

configureAccessibility({
  validation: { enabled: true, level: 'AA', runOnChange: true },
  discovery: { preferAccessibleNames: true, fallbackToText: true },
  announcements: { enabled: true, defaultPoliteness: 'polite' },
});
```
