---
sidebar_position: 1
---

# Element Identification

UI Bridge uses multiple strategies to uniquely identify DOM elements. The AutoRegisterProvider automatically discovers interactive elements and assigns stable semantic IDs — no manual attributes needed.

## Identification Priority

When finding elements, UI Bridge tries these strategies in order:

1. **`data-testid`** - Testing library convention
2. **`id`** - HTML id attribute (skips React auto-generated IDs like `:r1a:`)
3. **Semantic ID** - Generated from element type + label/content
4. **CSS Selector** - Generated selector
5. **XPath** - Generated XPath (last resort)

## AutoRegisterProvider (Recommended)

The easiest way to make elements discoverable is to use the `AutoRegisterProvider`. It automatically discovers all interactive elements (buttons, inputs, links, etc.) and assigns stable semantic IDs:

```tsx
<AutoRegisterProvider>
  <YourApp />
</AutoRegisterProvider>
```

IDs are generated deterministically from element content:

- `button-save` (from `<button>Save</button>`)
- `input-email` (from `<input aria-label="Email" />`)
- `link-dashboard-sidebar` (with ancestor context for disambiguation)

### How Semantic IDs Work

The format is: `{type}-{label-slug}[-{context}][-{index}]`

- **type**: Element type (button, input, link, select, etc.)
- **label**: Slugified from text content, aria-label, title, placeholder, or name
- **context**: Optional ancestor context (nearest id, data-testid, aria-label, or landmark tag) for disambiguation
- **index**: Optional numeric suffix when siblings of the same type exist

## Leverage Existing Test IDs

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
  testId?: string; // data-testid value
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

1. Test ID: `[data-testid="my-element"]`
2. Element ID: `#my-element`
3. Ancestor with ID + path: `#container > div > button`
4. nth-child for uniqueness: `div:nth-child(2) > button`

### XPath Generation

The generated XPath uses:

1. Element ID: `//*[@id="my-element"]`
2. Data attributes: `//button[@data-testid="submit"]`
3. Positional path: `/html/body/div[2]/form/button[1]`

## Finding Elements

### By String Identifier

```python
# UI Bridge tries all strategies automatically
client.click('submit-btn')  # Tries data-testid, id, then CSS/XPath
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

1. Add a `data-testid` for explicit identification
2. Use a more specific CSS selector
3. Use XPath with position: `(//button[@class="btn"])[1]`

### Dynamic Elements

For dynamically rendered elements:

```python
# Wait for element to appear
client.click('dynamic-btn', wait_visible=True, timeout=5000)
```
