---
sidebar_position: 1
---

# Element Identification

UI Bridge uses multiple strategies to uniquely identify DOM elements. The AutoRegisterProvider automatically discovers interactive elements and assigns stable semantic IDs — no manual attributes needed.

## Identification Priority

When finding elements, UI Bridge tries these strategies in order:

1. **`data-ui-bridge-test-id`** - Author-pinned id (see [Pinning a discovered id](#pinning-a-discovered-id))
2. **`data-testid`** - Testing library convention
3. **`id`** - HTML id attribute (skips React auto-generated IDs like `:r1a:`)
4. **Semantic ID** - Generated from element type + label/content
5. **CSS Selector** - Generated selector
6. **XPath** - Generated XPath (last resort)

:::note data-ui-bridge-id is an output, not an input

`data-ui-bridge-id` is written **by** the SDK onto elements it has registered,
so an out-of-process runner can find a registered element without holding the
React ref. It is not read as an identification input on the discovery path, and
stamping it by hand does not pin the id an unregistered element is discovered
under. Use `data-ui-bridge-test-id` for that.

The one place the attribute is read as an input is `useAutoRegister`'s element
selector: a node carrying `data-ui-bridge-id` is always registered, even if it
would not otherwise match the interactive-element filter.

:::

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

## Pinning a discovered id

A semantic id is deterministic but not permanent: the `[-{index}]` suffix is
assigned in DOM-walk order, so two same-slug siblings swap suffixes when the DOM
reorders, and the slug itself moves when the label copy changes. When a caller
needs an id that never moves, stamp `data-ui-bridge-test-id`. It is taken
verbatim and outranks every other strategy, on both the registered and the
unregistered path:

```tsx
<button data-ui-bridge-test-id="checkout-submit">Place order</button>
```

Because the value is used verbatim there is no collision counter behind it —
two elements carrying the same `data-ui-bridge-test-id` produce the same id, and
which one a call resolves to is undefined. Keep the value unique per element.

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
