---
sidebar_position: 1
---

# Element Identification

UI Bridge uses multiple strategies to uniquely identify DOM elements. Understanding these strategies helps you write more robust automation code.

## Identification Priority

When finding elements, UI Bridge tries these strategies in order:

1. **`data-ui-id`** - Explicit UI Bridge identifier
2. **`data-testid`** - Testing library convention
3. **`data-awas-element`** - Legacy support
4. **`id`** - HTML id attribute
5. **CSS Selector** - Generated selector
6. **XPath** - Generated XPath (last resort)

## Best Practices

### Use `data-ui-id` for Automation

The most reliable way to identify elements is with explicit `data-ui-id` attributes:

```tsx
<button data-ui-id="checkout-btn">Checkout</button>
<input data-ui-id="search-input" type="text" />
<select data-ui-id="country-select">...</select>
```

This approach:

- Won't break when class names change
- Works even without an HTML `id`
- Is explicit about automation intent
- Separates automation concerns from styling

### Naming Conventions

Use descriptive, hierarchical IDs:

```tsx
// Good - clear and descriptive
<button data-ui-id="cart-checkout-btn">
<input data-ui-id="login-email-input">
<select data-ui-id="shipping-country-select">

// Avoid - too generic
<button data-ui-id="btn1">
<input data-ui-id="input">
```

### Leverage Existing Test IDs

If your app already uses `data-testid` for testing, UI Bridge will use those:

```tsx
// Works with existing test IDs
<button data-testid="submit-button">Submit</button>
```

```python
# Reference by testid value
client.click('submit-button')
```

## ElementIdentifier Object

When you need full identification details, UI Bridge provides an `ElementIdentifier` object:

```typescript
interface ElementIdentifier {
  uiId?: string; // data-ui-id value
  testId?: string; // data-testid value
  awasId?: string; // data-awas-element value
  htmlId?: string; // id attribute value
  xpath: string; // Generated XPath
  selector: string; // Generated CSS selector
}
```

### Getting Element Identifiers

In React:

```tsx
const element = useUIElement({ id: 'my-element' });
const identifier = element.getIdentifier();
console.log(identifier.xpath);
```

In Python:

```python
discovery = client.discover()
for el in discovery.elements:
    print(f"XPath: {el.identifier.xpath}")
    print(f"Selector: {el.identifier.selector}")
```

## Generated Selectors

When explicit identifiers aren't available, UI Bridge generates CSS selectors and XPaths.

### CSS Selector Generation

The generated selector prefers:

1. Element ID: `#my-element`
2. Data attributes: `[data-ui-id="my-element"]`
3. Ancestor with ID + path: `#container > div > button`
4. nth-child for uniqueness: `div:nth-child(2) > button`

### XPath Generation

The generated XPath uses:

1. Element ID: `//*[@id="my-element"]`
2. Data attributes: `//button[@data-ui-id="submit"]`
3. Positional path: `/html/body/div[2]/form/button[1]`

## Finding Elements

### By String Identifier

```python
# UI Bridge tries all strategies automatically
client.click('submit-btn')  # Tries data-ui-id, data-testid, id, then CSS/XPath
```

### By CSS Selector

```python
# Use CSS selector directly
client.click('.btn-primary')
client.click('#main-form button[type="submit"]')
```

### By XPath

```python
# Use XPath for complex queries
element = client.find_element('//button[contains(text(), "Submit")]')
```

## Troubleshooting

### Element Not Found

If an element isn't found:

1. Check that the element is in the DOM
2. Verify the identifier matches exactly
3. Use `client.discover()` to see available elements
4. Check if the element is visible (hidden elements may be excluded)

### Multiple Matches

If multiple elements match:

1. Add a more specific `data-ui-id`
2. Use a more specific CSS selector
3. Use XPath with position: `(//button[@class="btn"])[1]`

### Dynamic Elements

For dynamically rendered elements:

```python
# Wait for element to appear
client.click('dynamic-btn', wait_visible=True, timeout=5000)
```
