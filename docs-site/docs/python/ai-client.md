---
sidebar_position: 4
---

# AI Client

The AI client (`client.ai`) provides a natural language interface for AI agents to interact with UIs without knowing exact element IDs.

## Overview

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient('http://localhost:9876')

# Natural language interaction
client.ai.execute("click the Submit button")
client.ai.assert_that("error message", "hidden")
element = client.ai.find("email input")
```

## Natural Language Actions

### Execute

Execute actions using natural language instructions:

```python
# Click actions
client.ai.execute("click the Submit button")
client.ai.execute("click on 'Sign In'")

# Type actions
client.ai.execute("type 'hello@example.com' in the email field")
client.ai.execute("enter 'secret123' into the password input")

# Select actions
client.ai.execute("select 'United States' from the country dropdown")
client.ai.execute("choose 'Express Shipping' in the delivery options")

# With context for disambiguation
client.ai.execute(
    "click Submit",
    context="the login form, not the registration form"
)

# With timeout
client.ai.execute("click the loading button", timeout=10000)

# With confidence threshold
client.ai.execute("click Submit", confidence_threshold=0.8)
```

### Convenience Methods

```python
# Click by description
client.ai.click("Submit button")
client.ai.click("the blue login button")

# Type into element
client.ai.type_text("email field", "user@example.com")
client.ai.type_text("search box", "product name")

# Select option
client.ai.select_option("country dropdown", "United States")
client.ai.select_option("size selector", "Large")
```

### Response

```python
result = client.ai.execute("click Submit")

print(result.success)           # True/False
print(result.executed_action)   # "click"
print(result.element_used.id)   # "ui-form-submit-button"
print(result.confidence)        # 0.95
print(result.duration_ms)       # 42.5

# On failure
if not result.success:
    print(result.error)         # "Element not found"
    print(result.suggestions)   # ["Did you mean 'Submit Order'?"]
    print(result.alternatives)  # Similar elements found
```

## Element Search

### Find

Find the best matching element:

```python
# By description
element = client.ai.find("Submit button")
element = client.ai.find("email input field")
element = client.ai.find("main navigation menu")

if element:
    print(f"ID: {element.id}")
    print(f"Type: {element.type}")
    print(f"Description: {element.description}")
    print(f"Aliases: {element.aliases}")

# Disable fuzzy matching for exact matches
element = client.ai.find("Submit", fuzzy=False)
```

### Search

Search with multiple criteria:

```python
# By text
results = client.ai.search(text="Submit")

# By partial text
results = client.ai.search(text_contains="Submit")

# By ARIA role
results = client.ai.search(role="button")

# By element type
results = client.ai.search(element_type="input")

# Combined criteria
results = client.ai.search(
    role="button",
    text_contains="Submit",
    near="email-input"  # Spatially near this element
)

# Within a container
results = client.ai.search(
    role="button",
    within="login-form"  # Only search inside this element
)

# Access results
for result in results:
    print(f"Element: {result.element.id}")
    print(f"Confidence: {result.confidence}")
    print(f"Match reasons: {result.match_reasons}")
```

### Find by Role

Find elements by ARIA role:

```python
# All buttons
buttons = client.ai.find_by_role("button")

# Buttons with specific name
submit_buttons = client.ai.find_by_role("button", name="Submit")

# Other roles
textboxes = client.ai.find_by_role("textbox")
links = client.ai.find_by_role("link")
checkboxes = client.ai.find_by_role("checkbox")
```

## Assertions

### Basic Assertions

```python
# Visibility
client.ai.assert_that("Submit button", "visible")
client.ai.assert_that("loading spinner", "hidden")

# Enabled state
client.ai.assert_that("email input", "enabled")
client.ai.assert_that("submit button", "disabled")

# Text content
client.ai.assert_that("welcome message", "hasText", "Hello, User!")
client.ai.assert_that("status", "containsText", "Success")

# Input value
client.ai.assert_that("email input", "hasValue", "user@example.com")

# Existence
client.ai.assert_that("error message", "exists")
client.ai.assert_that("modal", "notExists")

# Checkbox state
client.ai.assert_that("terms checkbox", "checked")
client.ai.assert_that("newsletter", "unchecked")
```

### Convenience Methods

```python
client.ai.assert_visible("Submit button")
client.ai.assert_hidden("error message")
client.ai.assert_enabled("email input")
client.ai.assert_disabled("submit button")
client.ai.assert_has_text("title", "Welcome")
client.ai.assert_contains_text("body", "success")
client.ai.assert_has_value("input", "test")
client.ai.assert_exists("form")
client.ai.assert_not_exists("error")
client.ai.assert_checked("checkbox")
client.ai.assert_unchecked("checkbox")
```

### With Timeout

```python
# Wait for element to become visible
result = client.ai.assert_that("Submit button", "visible", timeout=5000)

# Wait helpers
client.ai.wait_for_visible("confirmation dialog", timeout=10000)
client.ai.wait_for_hidden("loading spinner", timeout=5000)
client.ai.wait_for_enabled("submit button", timeout=3000)
```

### Batch Assertions

```python
# All must pass
result = client.ai.assert_batch([
    ("Submit button", "visible"),
    ("error message", "hidden"),
    ("email input", "enabled"),
])

print(result.passed)         # True if all passed
print(result.passed_count)   # Number that passed
print(result.failed_count)   # Number that failed

# Stop on first failure
result = client.ai.assert_batch(
    [("a", "visible"), ("b", "visible"), ("c", "visible")],
    stop_on_failure=True
)

# Any mode (at least one must pass)
result = client.ai.assert_batch(
    [("option-a", "checked"), ("option-b", "checked")],
    mode="any"
)
```

### Verify Page State

```python
# Returns True if all conditions pass
ready = client.ai.verify_page_state([
    ("login form", "visible"),
    ("email input", "enabled"),
    ("password input", "enabled"),
])

if ready:
    client.ai.type_text("email input", "user@example.com")
```

## Semantic Snapshots

### Get Snapshot

```python
snapshot = client.ai.snapshot()

# Page context
print(snapshot.page.url)
print(snapshot.page.title)
print(snapshot.focused_element)

# Summary (LLM-friendly)
print(snapshot.summary)
# "Login page with email and password form, Submit button enabled"

# Element counts
print(snapshot.element_counts)
# {"button": 3, "input": 2, "link": 5}

# All elements with AI metadata
for elem in snapshot.elements:
    print(f"{elem.id}: {elem.description}")
    print(f"  Type: {elem.semantic_type}")
    print(f"  Aliases: {elem.aliases}")
    print(f"  Actions: {elem.suggested_actions}")

# Forms and their state
for form in snapshot.forms:
    print(f"Form: {form.name}")
    print(f"  Valid: {form.is_valid}")
    print(f"  Dirty: {form.is_dirty}")
    for field in form.fields:
        print(f"  - {field.label}: {field.value}")
        if field.error:
            print(f"    Error: {field.error}")

# Active modals
for modal in snapshot.active_modals:
    print(f"Modal: {modal.title}")
    print(f"  Type: {modal.type}")
    print(f"  Primary action: {modal.primary_action}")
```

### Track Changes

```python
# Take first snapshot
snapshot1 = client.ai.snapshot()

# Do something
client.ai.click("Submit button")

# Get diff
diff = client.ai.diff()

if diff:
    print(diff.summary)
    # "Submit button clicked, form submitted, success message appeared"

    # Appeared elements
    for change in diff.changes.appeared:
        print(f"New: {change.description}")

    # Disappeared elements
    for change in diff.changes.disappeared:
        print(f"Gone: {change.description}")

    # Modified elements
    for mod in diff.changes.modified:
        print(f"Changed: {mod.description}")
        print(f"  {mod.property}: {mod.from_value} -> {mod.to_value}")

    # Page changes
    if diff.page_changes:
        if diff.page_changes.url_changed:
            print(f"URL: {diff.page_changes.new_url}")
        if diff.page_changes.title_changed:
            print(f"Title: {diff.page_changes.new_title}")

    # AI insights
    print(f"Trigger: {diff.probable_trigger}")
    print(f"Suggested actions: {diff.suggested_actions}")
```

### Plain Text Summary

For including in LLM context:

```python
summary = client.ai.summary()
# Returns: "Login page at /login. Contains: email input (empty),
# password input (empty), Submit button (enabled),
# 'Forgot Password' link. No errors visible."
```

## Error Handling

```python
from ui_bridge import UIBridgeClient, UIBridgeError

client = UIBridgeClient()

result = client.ai.execute("click nonexistent element")

if not result.success:
    print(f"Error: {result.error}")
    print(f"Code: {result.error_code}")

    # Suggestions for recovery
    for suggestion in result.suggestions or []:
        print(f"Suggestion: {suggestion}")

    # Alternative elements that were found
    for alt in result.alternatives or []:
        print(f"Alternative: {alt.element.description} ({alt.confidence})")
```

## Complete Example

```python
from ui_bridge import UIBridgeClient

def checkout_flow():
    client = UIBridgeClient('http://localhost:9876')

    # Verify we're on the right page
    if not client.ai.verify_page_state([
        ("product page", "visible"),
        ("add to cart button", "enabled"),
    ]):
        raise Exception("Not on product page")

    # Add to cart
    client.ai.click("add to cart button")
    client.ai.wait_for_visible("cart notification", timeout=3000)

    # Go to cart
    client.ai.click("cart icon")
    client.ai.wait_for_visible("cart page")

    # Verify cart has items
    client.ai.assert_that("cart items", "exists")

    # Proceed to checkout
    client.ai.click("checkout button")

    # Fill shipping info
    client.ai.type_text("name input", "John Doe")
    client.ai.type_text("address input", "123 Main St")
    client.ai.type_text("city input", "New York")
    client.ai.select_option("state dropdown", "New York")
    client.ai.type_text("zip input", "10001")

    # Continue to payment
    client.ai.click("continue button")
    client.ai.wait_for_visible("payment form")

    # Fill payment (using test card)
    client.ai.type_text("card number", "4111111111111111")
    client.ai.type_text("expiry", "12/25")
    client.ai.type_text("cvv", "123")

    # Place order
    client.ai.click("place order button")

    # Verify success
    client.ai.wait_for_visible("order confirmation", timeout=10000)
    client.ai.assert_contains_text("confirmation message", "Thank you")

    # Get final state
    snapshot = client.ai.snapshot()
    print(f"Order complete: {snapshot.summary}")

if __name__ == '__main__':
    checkout_flow()
```
