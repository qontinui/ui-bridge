"""
AI Client

AI-native UI Bridge client providing natural language interaction,
semantic snapshots, and assertion capabilities.
"""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .client import UIBridgeClient

from .ai_types import (
    AIDiscoveredElement,
    AssertionRequest,
    AssertionResult,
    AssertionType,
    BatchAssertionRequest,
    BatchAssertionResult,
    NLActionRequest,
    NLActionResponse,
    SearchCriteria,
    SearchResponse,
    SearchResult,
    SemanticDiff,
    SemanticSnapshot,
)


class AIClient:
    """
    AI-native UI Bridge client.

    Provides natural language interaction with UI elements.

    Example:
        >>> client = UIBridgeClient()
        >>> result = client.ai.execute("click the Submit button")
        >>> client.ai.assert_that("error message", "hidden")
        >>> snapshot = client.ai.snapshot()
    """

    def __init__(self, http_client: "UIBridgeClient"):
        """
        Initialize the AI client.

        Args:
            http_client: The parent UIBridgeClient instance
        """
        self._client = http_client

    # =========================================================================
    # Search Methods
    # =========================================================================

    def search(
        self,
        text: str | None = None,
        *,
        text_contains: str | None = None,
        accessible_name: str | None = None,
        role: str | None = None,
        element_type: str | None = None,
        near: str | None = None,
        within: str | None = None,
        fuzzy: bool = True,
        fuzzy_threshold: float | None = None,
    ) -> list[SearchResult]:
        """
        Search for elements using multiple criteria.

        Args:
            text: Exact visible text to match
            text_contains: Partial text to match
            accessible_name: ARIA accessible name to match
            role: ARIA role to match
            element_type: Element type to match
            near: Element ID to search near
            within: Element ID to search within
            fuzzy: Enable fuzzy matching (default: True)
            fuzzy_threshold: Fuzzy match threshold (0-1)

        Returns:
            List of matching SearchResult objects sorted by confidence

        Example:
            >>> results = client.ai.search(text="Submit")
            >>> results = client.ai.search(role="button", text_contains="Login")
        """
        criteria = SearchCriteria(
            text=text,
            textContains=text_contains,
            accessibleName=accessible_name,
            role=role,
            type=element_type,
            near=near,
            within=within,
            fuzzy=fuzzy,
            fuzzyThreshold=fuzzy_threshold,
        )
        response = self._search(criteria)
        return response.results

    def find(self, description: str, *, fuzzy: bool = True) -> AIDiscoveredElement | None:
        """
        Find an element by natural language description.

        Args:
            description: Natural language description of the element
            fuzzy: Enable fuzzy matching (default: True)

        Returns:
            The best matching element, or None if not found

        Example:
            >>> element = client.ai.find("Submit button")
            >>> element = client.ai.find("email input field")
        """
        response = self._search(SearchCriteria(text=description, fuzzy=fuzzy))
        if response.best_match:
            return response.best_match.element
        return None

    def find_by_text(self, text: str, *, fuzzy: bool = True) -> AIDiscoveredElement | None:
        """
        Find an element by its visible text.

        Args:
            text: Text content to search for
            fuzzy: Enable fuzzy matching

        Returns:
            The best matching element, or None if not found
        """
        return self.find(text, fuzzy=fuzzy)

    def find_by_role(
        self, role: str, name: str | None = None
    ) -> list[SearchResult]:
        """
        Find elements by ARIA role.

        Args:
            role: ARIA role (e.g., "button", "textbox")
            name: Optional accessible name to filter by

        Returns:
            List of matching elements
        """
        criteria = SearchCriteria(role=role, accessibleName=name)
        response = self._search(criteria)
        return response.results

    def _search(self, criteria: SearchCriteria) -> SearchResponse:
        """Execute search request."""
        data = self._client._request(
            "POST",
            "/ai/search",
            json=criteria.model_dump(by_alias=True, exclude_none=True),
        )
        return SearchResponse.model_validate(data)

    # =========================================================================
    # Natural Language Execution
    # =========================================================================

    def execute(
        self,
        instruction: str,
        *,
        context: str | None = None,
        timeout: int | None = None,
        confidence_threshold: float | None = None,
    ) -> NLActionResponse:
        """
        Execute a natural language instruction.

        Args:
            instruction: Natural language instruction (e.g., "click the Submit button")
            context: Optional context to help disambiguate
            timeout: Action timeout in milliseconds
            confidence_threshold: Minimum confidence for element matching (0-1)

        Returns:
            NLActionResponse with execution result

        Example:
            >>> client.ai.execute("click the Submit button")
            >>> client.ai.execute("type 'hello' in the search box")
            >>> client.ai.execute("select 'Option 2' from the dropdown")
        """
        request = NLActionRequest(
            instruction=instruction,
            context=context,
            timeout=timeout,
            confidenceThreshold=confidence_threshold,
        )
        data = self._client._request(
            "POST",
            "/ai/execute",
            json=request.model_dump(by_alias=True, exclude_none=True),
        )
        return NLActionResponse.model_validate(data)

    def click(self, target: str) -> NLActionResponse:
        """
        Click an element by description.

        Args:
            target: Natural language description of the element

        Returns:
            NLActionResponse with execution result
        """
        return self.execute(f'click "{target}"')

    def type_text(self, target: str, text: str) -> NLActionResponse:
        """
        Type text into an element.

        Args:
            target: Natural language description of the element
            text: Text to type

        Returns:
            NLActionResponse with execution result
        """
        return self.execute(f"type '{text}' into {target}")

    def select_option(self, target: str, option: str) -> NLActionResponse:
        """
        Select an option from a dropdown.

        Args:
            target: Natural language description of the dropdown
            option: Option to select

        Returns:
            NLActionResponse with execution result
        """
        return self.execute(f"select '{option}' from {target}")

    # =========================================================================
    # Assertions
    # =========================================================================

    def assert_that(
        self,
        target: str,
        assertion: str | AssertionType,
        expected: Any = None,
        *,
        timeout: int | None = None,
        message: str | None = None,
    ) -> AssertionResult:
        """
        Make an assertion about an element.

        Args:
            target: Element ID or natural language description
            assertion: Assertion type (e.g., "visible", "hidden", "enabled")
            expected: Expected value (for hasText, hasValue, count, etc.)
            timeout: Wait timeout in milliseconds
            message: Custom failure message

        Returns:
            AssertionResult with pass/fail status

        Example:
            >>> client.ai.assert_that("Submit button", "visible")
            >>> client.ai.assert_that("error message", "hidden")
            >>> client.ai.assert_that("email input", "hasValue", "test@example.com")
        """
        if isinstance(assertion, str):
            assertion_type = AssertionType(assertion)
        else:
            assertion_type = assertion

        request = AssertionRequest(
            target=target,
            type=assertion_type,
            expected=expected,
            timeout=timeout,
            message=message,
        )
        data = self._client._request(
            "POST",
            "/ai/assert",
            json=request.model_dump(by_alias=True, exclude_none=True),
        )
        return AssertionResult.model_validate(data)

    def assert_visible(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is visible."""
        return self.assert_that(target, AssertionType.VISIBLE, timeout=timeout)

    def assert_hidden(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is hidden."""
        return self.assert_that(target, AssertionType.HIDDEN, timeout=timeout)

    def assert_enabled(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is enabled."""
        return self.assert_that(target, AssertionType.ENABLED, timeout=timeout)

    def assert_disabled(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is disabled."""
        return self.assert_that(target, AssertionType.DISABLED, timeout=timeout)

    def assert_has_text(
        self, target: str, text: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert element has exact text."""
        return self.assert_that(target, AssertionType.HAS_TEXT, text, timeout=timeout)

    def assert_contains_text(
        self, target: str, text: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert element contains text."""
        return self.assert_that(target, AssertionType.CONTAINS_TEXT, text, timeout=timeout)

    def assert_has_value(
        self, target: str, value: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert input element has value."""
        return self.assert_that(target, AssertionType.HAS_VALUE, value, timeout=timeout)

    def assert_exists(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element exists."""
        return self.assert_that(target, AssertionType.EXISTS, timeout=timeout)

    def assert_not_exists(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element does not exist."""
        return self.assert_that(target, AssertionType.NOT_EXISTS, timeout=timeout)

    def assert_checked(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert checkbox is checked."""
        return self.assert_that(target, AssertionType.CHECKED, timeout=timeout)

    def assert_unchecked(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert checkbox is unchecked."""
        return self.assert_that(target, AssertionType.UNCHECKED, timeout=timeout)

    def assert_batch(
        self,
        assertions: list[tuple[str, str, Any] | tuple[str, str]],
        *,
        mode: str = "all",
        stop_on_failure: bool = False,
    ) -> BatchAssertionResult:
        """
        Execute multiple assertions.

        Args:
            assertions: List of (target, assertion_type) or (target, assertion_type, expected) tuples
            mode: "all" requires all to pass, "any" requires at least one
            stop_on_failure: Stop on first failure

        Returns:
            BatchAssertionResult with all results
        """
        requests = []
        for item in assertions:
            if len(item) == 2:
                target, assertion_type = item
                expected = None
            else:
                target, assertion_type, expected = item

            requests.append(
                AssertionRequest(
                    target=target,
                    type=AssertionType(assertion_type),
                    expected=expected,
                )
            )

        batch_request = BatchAssertionRequest(
            assertions=requests,
            mode=mode,
            stopOnFailure=stop_on_failure,
        )
        data = self._client._request(
            "POST",
            "/ai/assert/batch",
            json=batch_request.model_dump(by_alias=True, exclude_none=True),
        )
        return BatchAssertionResult.model_validate(data)

    # =========================================================================
    # Semantic Snapshots
    # =========================================================================

    def snapshot(self) -> SemanticSnapshot:
        """
        Get a semantic snapshot of the current page.

        Returns:
            SemanticSnapshot with AI-enhanced element data
        """
        data = self._client._request("GET", "/ai/snapshot")
        return SemanticSnapshot.model_validate(data)

    def diff(self, since: int | None = None) -> SemanticDiff | None:
        """
        Get changes since a previous snapshot.

        Args:
            since: Timestamp of the previous snapshot (optional)

        Returns:
            SemanticDiff describing changes, or None if no previous snapshot
        """
        params = {"since": since} if since else None
        data = self._client._request("GET", "/ai/diff", params=params)
        if data is None:
            return None
        return SemanticDiff.model_validate(data)

    def summary(self) -> str:
        """
        Get a plain text summary of the current page.

        Returns:
            LLM-friendly text summary of the page state
        """
        return self._client._request("GET", "/ai/summary")

    # =========================================================================
    # Convenience Methods
    # =========================================================================

    def wait_for_visible(self, target: str, *, timeout: int = 5000) -> AssertionResult:
        """Wait for an element to become visible."""
        return self.assert_visible(target, timeout=timeout)

    def wait_for_hidden(self, target: str, *, timeout: int = 5000) -> AssertionResult:
        """Wait for an element to become hidden."""
        return self.assert_hidden(target, timeout=timeout)

    def wait_for_enabled(self, target: str, *, timeout: int = 5000) -> AssertionResult:
        """Wait for an element to become enabled."""
        return self.assert_enabled(target, timeout=timeout)

    def verify_page_state(
        self,
        checks: list[tuple[str, str]],
    ) -> bool:
        """
        Verify multiple page state conditions.

        Args:
            checks: List of (target, assertion_type) tuples

        Returns:
            True if all checks pass, False otherwise
        """
        result = self.assert_batch(checks, mode="all")
        return result.passed
