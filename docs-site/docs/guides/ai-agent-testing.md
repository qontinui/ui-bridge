---
sidebar_position: 4
---

# AI Agent Testing

This guide shows how AI agents can write and execute UI tests without knowing exact element IDs.

## The Problem

Traditional UI testing requires knowing exact element IDs or selectors:

```python
# Brittle: requires knowing exact IDs
client.click("btn-submit-form-v2")
client.type("input-email-field-123", "user@example.com")
```

If IDs change, tests break. AI agents can't write these tests without documentation.

## The Solution

UI Bridge's AI interface enables natural language interaction:

```python
# Robust: uses natural language
client.ai.click("Submit button")
client.ai.type_text("email input", "user@example.com")
```

## How It Works

1. **Babel Plugin** instruments JSX elements with semantic IDs and aliases at build time
2. **AI Client** uses fuzzy matching to find elements by description
3. **Aliases** provide multiple ways to reference each element

### Build-Time Instrumentation

```jsx
// Your code
<button onClick={handleSubmit}>Sign In</button>

// After Babel transformation
<button
  onClick={handleSubmit}
  data-ui-id="ui-loginform-sign-in-button"
  data-ui-aliases="sign in,signin,login,log in"
  data-ui-type="button"
>
  Sign In
</button>
```

### Runtime Matching

```python
# All of these find the same button
client.ai.click("Sign In")
client.ai.click("signin")
client.ai.click("login button")
client.ai.click("the login button")
```

## Writing Tests as an AI Agent

### Step 1: Discover the Page

```python
# Get page summary
summary = client.ai.summary()
print(summary)
# "Login page with email input, password input, and Sign In button"

# Or get detailed snapshot
snapshot = client.ai.snapshot()
for elem in snapshot.elements:
    print(f"- {elem.description}")
```

### Step 2: Write Natural Language Test

```python
def test_login_flow():
    client = UIBridgeClient()

    # Navigate to login
    client.ai.click("Sign In link")

    # Fill form
    client.ai.type_text("email input", "user@example.com")
    client.ai.type_text("password input", "secret123")

    # Submit
    client.ai.click("Sign In button")

    # Verify
    client.ai.assert_visible("welcome message")
    client.ai.assert_hidden("login form")
```

### Step 3: Handle Variations

```python
def test_login_with_recovery():
    client = UIBridgeClient()

    # Try to click login - might be "Sign In" or "Log In"
    result = client.ai.execute("click login button")

    if not result.success:
        # Check suggestions
        print(f"Suggestions: {result.suggestions}")
        # Maybe try alternative
        client.ai.click(result.suggestions[0])

    # Continue with test
    client.ai.type_text("email", "user@example.com")
```

## Test Patterns

### Page Verification

```python
def verify_login_page():
    """Verify all expected elements are present."""
    return client.ai.verify_page_state([
        ("email input", "visible"),
        ("password input", "visible"),
        ("sign in button", "enabled"),
        ("forgot password link", "visible"),
    ])
```

### Form Submission

```python
def test_form_submission():
    # Fill form
    client.ai.type_text("name field", "John Doe")
    client.ai.type_text("email field", "john@example.com")
    client.ai.select_option("country", "United States")
    client.ai.check("terms checkbox")

    # Submit
    client.ai.click("submit button")

    # Verify
    client.ai.wait_for_visible("success message", timeout=5000)
    client.ai.assert_contains_text("success message", "submitted")
```

### Error Handling

```python
def test_validation_errors():
    # Submit empty form
    client.ai.click("submit button")

    # Check for errors
    client.ai.assert_visible("email error")
    client.ai.assert_contains_text("email error", "required")

    # Fix and retry
    client.ai.type_text("email input", "valid@example.com")
    client.ai.click("submit button")

    # Verify error cleared
    client.ai.assert_hidden("email error")
```

### Modal Interactions

```python
def test_modal_flow():
    # Open modal
    client.ai.click("open settings button")
    client.ai.wait_for_visible("settings modal")

    # Interact with modal
    client.ai.type_text("username input", "newusername")
    client.ai.click("save button")

    # Verify modal closed
    client.ai.wait_for_hidden("settings modal")
    client.ai.assert_visible("settings saved notification")
```

### Navigation

```python
def test_navigation():
    # Click nav items
    client.ai.click("Products link")
    client.ai.wait_for_visible("products page")

    # Use breadcrumbs
    client.ai.click("Home breadcrumb")
    client.ai.wait_for_visible("home page")
```

## Fuzzy Matching Examples

The AI client uses fuzzy matching to find elements even with imprecise descriptions:

```python
# Exact match
client.ai.click("Submit")  # matches data-ui-aliases="submit"

# Partial match
client.ai.click("Submit button")  # adds "button" context

# Synonym match
client.ai.click("Login")  # matches alias "login" on Sign In button

# Case insensitive
client.ai.click("SUBMIT")  # matches "submit"

# With typos (if fuzzy threshold allows)
client.ai.click("Submti")  # might match "Submit" with lower confidence

# Descriptive
client.ai.click("the blue submit button at the bottom")
```

### Controlling Fuzzy Matching

```python
# Strict matching (exact only)
element = client.ai.find("Submit", fuzzy=False)

# With confidence threshold
result = client.ai.execute("click Submit", confidence_threshold=0.9)

# Search with fuzzy threshold
results = client.ai.search(text="Submit", fuzzy_threshold=0.8)
```

## Best Practices

### 1. Use Descriptive Text

```python
# Good: specific description
client.ai.click("Submit Order button")

# Less good: too generic
client.ai.click("button")
```

### 2. Verify Before Acting

```python
# Verify element exists before complex interactions
client.ai.assert_visible("checkout form")
client.ai.type_text("card number", "4111111111111111")
```

### 3. Use Timeouts for Dynamic Content

```python
# Wait for element after async operation
client.ai.click("load more button")
client.ai.wait_for_visible("additional items", timeout=5000)
```

### 4. Handle Failures Gracefully

```python
result = client.ai.execute("click the thing")
if not result.success:
    # Log context
    print(f"Failed: {result.error}")
    print(f"Alternatives: {result.alternatives}")

    # Try recovery
    snapshot = client.ai.snapshot()
    print(f"Page state: {snapshot.summary}")
```

### 5. Use Batch Assertions

```python
# More efficient than individual assertions
result = client.ai.assert_batch([
    ("form", "visible"),
    ("email", "enabled"),
    ("password", "enabled"),
    ("submit", "enabled"),
], stop_on_failure=True)

if not result.passed:
    for r in result.results:
        if not r.passed:
            print(f"Failed: {r.target_description}")
```

## Integration with Test Frameworks

### pytest

```python
import pytest
from ui_bridge import UIBridgeClient

@pytest.fixture
def client():
    return UIBridgeClient('http://localhost:9876')

def test_login(client):
    client.ai.type_text("email", "test@example.com")
    client.ai.type_text("password", "secret")
    client.ai.click("sign in")
    assert client.ai.assert_visible("dashboard").passed
```

### unittest

```python
import unittest
from ui_bridge import UIBridgeClient

class LoginTests(unittest.TestCase):
    def setUp(self):
        self.client = UIBridgeClient('http://localhost:9876')

    def test_valid_login(self):
        self.client.ai.type_text("email", "test@example.com")
        self.client.ai.type_text("password", "secret")
        self.client.ai.click("sign in")
        result = self.client.ai.assert_visible("dashboard")
        self.assertTrue(result.passed)
```
