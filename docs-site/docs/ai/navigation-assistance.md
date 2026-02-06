# Navigation Assistance

Navigation Assistance helps AI agents understand how to navigate between pages and reach target states within your application.

## Overview

Navigation Assistance provides:

- Path finding between pages
- Breadcrumb tracking
- Navigation hints and suggestions
- State transition mapping

## Usage

### Find Navigation Path

```typescript
import { NavigationAssistant } from '@anthropic/ui-bridge';

const assistant = new NavigationAssistant(registry);

// Find how to reach a page
const path = await assistant.findPath('checkout page');

console.log(path);
// {
//   steps: [
//     { action: 'click', target: 'cart-icon', description: 'Open shopping cart' },
//     { action: 'click', target: 'checkout-btn', description: 'Proceed to checkout' }
//   ],
//   confidence: 0.95
// }
```

### Get Navigation Hints

```typescript
const hints = await assistant.getHints();

console.log(hints);
// {
//   currentPage: '/products',
//   breadcrumbs: ['Home', 'Products'],
//   availableNavigations: [
//     { label: 'Home', path: '/', element: 'nav-home' },
//     { label: 'Cart', path: '/cart', element: 'cart-icon' },
//     { label: 'Account', path: '/account', element: 'account-menu' }
//   ],
//   suggestedActions: [
//     'Add product to cart',
//     'Filter by category',
//     'Sort by price'
//   ]
// }
```

### Track Breadcrumbs

```typescript
// Automatically tracks navigation history
assistant.enableBreadcrumbTracking();

// Get current breadcrumbs
const breadcrumbs = assistant.getBreadcrumbs();
// ['Home', 'Products', 'Electronics', 'Phones']

// Navigate back
await assistant.navigateBack(2); // Goes to 'Products'
```

## Navigation Map

Define your application's navigation structure:

```typescript
const assistant = new NavigationAssistant(registry, {
  navigationMap: {
    home: {
      path: '/',
      links: ['products', 'cart', 'account'],
    },
    products: {
      path: '/products',
      parent: 'home',
      links: ['product-detail', 'cart'],
    },
    cart: {
      path: '/cart',
      parent: 'home',
      links: ['checkout', 'products'],
    },
    checkout: {
      path: '/checkout',
      parent: 'cart',
      links: ['confirmation'],
      requiresAuth: true,
    },
  },
});
```

## Navigation State

Track the current navigation state:

```typescript
interface NavigationState {
  currentPage: string;
  previousPage: string;
  breadcrumbs: string[];
  canGoBack: boolean;
  canGoForward: boolean;
  history: NavigationEntry[];
}

const state = assistant.getNavigationState();
```

## Event Handling

Listen for navigation events:

```typescript
assistant.on('navigate', (event) => {
  console.log(`Navigated from ${event.from} to ${event.to}`);
});

assistant.on('pathNotFound', (event) => {
  console.log(`Cannot find path to ${event.target}`);
});
```
