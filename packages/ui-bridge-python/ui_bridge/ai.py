"""
AI Client

AI-native UI Bridge client providing natural language interaction,
semantic snapshots, and assertion capabilities.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .client import UIBridgeClient
    from .recovery_types import ExecuteWithRecoveryResult

from .ai_types import (
    AIDiscoveredElement,
    AssertionRequest,
    AssertionResult,
    AssertionType,
    BatchAssertionRequest,
    BatchAssertionResult,
    Intent,
    IntentExecutionResult,
    IntentSearchResponse,
    NLActionRequest,
    NLActionResponse,
    SearchCriteria,
    SearchResponse,
    SearchResult,
    SemanticDiff,
    SemanticSearchCriteria,
    SemanticSearchResponse,
    SemanticSearchResult,
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

    def __init__(self, http_client: UIBridgeClient):
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
            text_contains=text_contains,
            accessible_name=accessible_name,
            role=role,
            type=element_type,
            near=near,
            within=within,
            fuzzy=fuzzy,
            fuzzy_threshold=fuzzy_threshold,
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

    def find_by_role(self, role: str, name: str | None = None) -> list[SearchResult]:
        """
        Find elements by ARIA role.

        Args:
            role: ARIA role (e.g., "button", "textbox")
            name: Optional accessible name to filter by

        Returns:
            List of matching elements
        """
        criteria = SearchCriteria(role=role, accessible_name=name)
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
    # Semantic Search (Embedding-based)
    # =========================================================================

    def semantic_search(
        self,
        query: str,
        *,
        threshold: float | None = None,
        limit: int | None = None,
        element_type: str | None = None,
        role: str | None = None,
        combine_with_text: bool | None = None,
    ) -> list[SemanticSearchResult]:
        """
        Search for elements using semantic similarity.

        This method uses embeddings to find elements by meaning rather than
        exact text matching. It's useful for finding elements when you know
        what you want but don't know the exact text.

        Args:
            query: Natural language description of what you're looking for
            threshold: Minimum similarity score (0-1, default: 0.5)
            limit: Maximum number of results to return
            element_type: Filter by element type
            role: Filter by ARIA role
            combine_with_text: Combine with text-based search

        Returns:
            List of SemanticSearchResult objects sorted by similarity

        Example:
            >>> # Find login-related buttons
            >>> results = client.ai.semantic_search("sign in")
            >>> # Find form submission elements
            >>> results = client.ai.semantic_search("submit form", role="button")
            >>> # Find email input with high threshold
            >>> results = client.ai.semantic_search("email address", threshold=0.7)
        """
        criteria = SemanticSearchCriteria(
            query=query,
            threshold=threshold,
            limit=limit,
            type=element_type,
            role=role,
            combine_with_text=combine_with_text,
        )
        response = self._semantic_search(criteria)
        return response.results

    def semantic_find(
        self,
        query: str,
        *,
        threshold: float | None = None,
    ) -> AIDiscoveredElement | None:
        """
        Find the best matching element using semantic similarity.

        Args:
            query: Natural language description of the element
            threshold: Minimum similarity score (0-1)

        Returns:
            The best matching element, or None if not found

        Example:
            >>> element = client.ai.semantic_find("login button")
            >>> element = client.ai.semantic_find("search input field")
        """
        response = self._semantic_search(
            SemanticSearchCriteria(query=query, threshold=threshold, limit=1)
        )
        if response.best_match:
            return response.best_match.element
        return None

    def _semantic_search(self, criteria: SemanticSearchCriteria) -> SemanticSearchResponse:
        """Execute semantic search request."""
        data = self._client._request(
            "POST",
            "/ai/semantic-search",
            json=criteria.model_dump(by_alias=True, exclude_none=True),
        )
        return SemanticSearchResponse.model_validate(data)

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
            confidence_threshold=confidence_threshold,
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
            stop_on_failure=stop_on_failure,
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
        result: str = self._client._request("GET", "/ai/summary")
        return result

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
        assertions: list[tuple[str, str, Any] | tuple[str, str]] = list(checks)
        result = self.assert_batch(assertions, mode="all")
        return result.passed

    # =========================================================================
    # Intent-Based Actions
    # =========================================================================

    def execute_intent(
        self,
        intent: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """
        Execute an intent by name with parameters.

        Intents are high-level actions that resolve to sequences of UI actions.
        Built-in intents include: login, logout, submit-form, navigate-to, search-for.

        Args:
            intent: The intent ID (e.g., "login", "navigate-to")
            params: Parameters for the intent (e.g., {"username": "admin", "password": "secret"})
            timeout: Timeout for each action step in milliseconds

        Returns:
            IntentExecutionResult with step-by-step status

        Example:
            >>> # Login with credentials
            >>> result = client.ai.execute_intent("login", {
            ...     "username": "admin@example.com",
            ...     "password": "secret123"
            ... })
            >>> if result.success:
            ...     print("Logged in successfully!")
            >>> else:
            ...     print(f"Failed at step {result.failed_step_index + 1}: {result.error}")
            >>>
            >>> # Navigate to a page
            >>> result = client.ai.execute_intent("navigate-to", {"destination": "settings"})
            >>>
            >>> # Search for something
            >>> result = client.ai.execute_intent("search-for", {"query": "products"})
        """
        request_data: dict[str, Any] = {
            "intentId": intent,
            "params": params or {},
        }
        if timeout is not None:
            request_data["timeout"] = timeout

        data = self._client._request(
            "POST",
            "/ai/intents/execute",
            json=request_data,
        )
        return IntentExecutionResult.model_validate(data)

    def find_intent(
        self,
        query: str,
        *,
        threshold: float | None = None,
    ) -> IntentSearchResponse:
        """
        Find matching intents for a natural language query.

        This method uses semantic matching to find intents that match
        the user's natural language description.

        Args:
            query: Natural language query (e.g., "log me in", "go to settings")
            threshold: Minimum confidence threshold (0-1, default: 0.6)

        Returns:
            IntentSearchResponse with matching intents and confidence scores

        Example:
            >>> # Find intent for "log me in"
            >>> response = client.ai.find_intent("log me in")
            >>> if response.best_match:
            ...     print(f"Best match: {response.best_match.intent.id}")
            ...     print(f"Confidence: {response.best_match.confidence:.0%}")
            ...     print(f"Required params: {[p.name for p in response.best_match.intent.parameters if p.required]}")
        """
        request_data: dict[str, Any] = {"query": query}
        if threshold is not None:
            request_data["threshold"] = threshold

        data = self._client._request(
            "POST",
            "/ai/intents/find",
            json=request_data,
        )
        return IntentSearchResponse.model_validate(data)

    def list_intents(self, *, tag: str | None = None) -> list[Intent]:
        """
        List available intents.

        Args:
            tag: Optional tag to filter by (e.g., "auth", "form", "navigation")

        Returns:
            List of available Intent objects

        Example:
            >>> # List all intents
            >>> intents = client.ai.list_intents()
            >>> for intent in intents:
            ...     print(f"{intent.id}: {intent.description}")
            >>>
            >>> # List only auth-related intents
            >>> auth_intents = client.ai.list_intents(tag="auth")
        """
        params = {"tag": tag} if tag else None
        data = self._client._request("GET", "/ai/intents", params=params)
        return [Intent.model_validate(item) for item in data]

    def register_intent(self, intent: Intent) -> None:
        """
        Register a custom intent.

        Custom intents allow you to define high-level actions specific to
        your application that can be executed by AI.

        Args:
            intent: The Intent object to register

        Example:
            >>> from ui_bridge.ai_types import Intent, IntentParameter
            >>>
            >>> # Define a custom checkout intent
            >>> checkout_intent = Intent(
            ...     id="checkout",
            ...     description="Complete the checkout process",
            ...     examples=["checkout", "complete purchase", "buy now"],
            ...     parameters=[
            ...         IntentParameter(
            ...             name="shipping_method",
            ...             description="Shipping method to use",
            ...             type="string",
            ...             required=False,
            ...             default_value="standard"
            ...         )
            ...     ],
            ...     actions=[
            ...         'click the checkout button',
            ...         'select "{shipping_method}" from the shipping dropdown',
            ...         'click the place order button'
            ...     ],
            ...     tags=["checkout", "purchase"]
            ... )
            >>>
            >>> client.ai.register_intent(checkout_intent)
            >>> result = client.ai.execute_intent("checkout")
        """
        self._client._request(
            "POST",
            "/ai/intents/register",
            json=intent.model_dump(by_alias=True, exclude_none=True),
        )

    def execute_intent_from_query(
        self,
        query: str,
        additional_params: dict[str, Any] | None = None,
        *,
        timeout: int | None = None,
        threshold: float | None = None,
    ) -> IntentExecutionResult:
        """
        Find and execute an intent from natural language.

        This is a convenience method that combines find_intent and execute_intent.
        It extracts parameters from the query when possible.

        Args:
            query: Natural language instruction (e.g., "log in with admin and secret123")
            additional_params: Additional parameters to merge with extracted ones
            timeout: Timeout for each action step in milliseconds
            threshold: Minimum confidence threshold for intent matching

        Returns:
            IntentExecutionResult with step-by-step status

        Example:
            >>> # Execute from natural language with embedded credentials
            >>> result = client.ai.execute_intent_from_query(
            ...     "log in with admin@example.com and mypassword"
            ... )
            >>>
            >>> # Navigate using natural language
            >>> result = client.ai.execute_intent_from_query("go to the settings page")
            >>>
            >>> # Search with extracted query
            >>> result = client.ai.execute_intent_from_query("search for blue widgets")
        """
        request_data: dict[str, Any] = {
            "query": query,
            "additionalParams": additional_params or {},
        }
        if timeout is not None:
            request_data["timeout"] = timeout
        if threshold is not None:
            request_data["threshold"] = threshold

        data = self._client._request(
            "POST",
            "/ai/intents/execute-from-query",
            json=request_data,
        )
        return IntentExecutionResult.model_validate(data)

    # Convenience methods for common intents

    def login(
        self,
        username: str,
        password: str,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """
        Execute the login intent.

        Args:
            username: Username or email
            password: Password
            timeout: Timeout for each step in milliseconds

        Returns:
            IntentExecutionResult

        Example:
            >>> result = client.ai.login("admin@example.com", "secret123")
            >>> if not result.success:
            ...     print(f"Login failed: {result.error}")
        """
        return self.execute_intent(
            "login",
            {"username": username, "password": password},
            timeout=timeout,
        )

    def logout(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """
        Execute the logout intent.

        Args:
            timeout: Timeout for the action in milliseconds

        Returns:
            IntentExecutionResult
        """
        return self.execute_intent("logout", timeout=timeout)

    def navigate_to(
        self,
        destination: str,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """
        Navigate to a page or section.

        Args:
            destination: The page or section to navigate to
            timeout: Timeout for the action in milliseconds

        Returns:
            IntentExecutionResult

        Example:
            >>> client.ai.navigate_to("settings")
            >>> client.ai.navigate_to("dashboard")
        """
        return self.execute_intent(
            "navigate-to",
            {"destination": destination},
            timeout=timeout,
        )

    def search_for(
        self,
        query: str,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """
        Execute the search intent.

        Args:
            query: The search query
            timeout: Timeout for each step in milliseconds

        Returns:
            IntentExecutionResult

        Example:
            >>> client.ai.search_for("blue widgets")
        """
        return self.execute_intent(
            "search-for",
            {"query": query},
            timeout=timeout,
        )

    def submit_form(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """
        Submit the current form.

        Args:
            timeout: Timeout for the action in milliseconds

        Returns:
            IntentExecutionResult
        """
        return self.execute_intent("submit-form", timeout=timeout)

    def close_modal(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """
        Close the current modal or dialog.

        Args:
            timeout: Timeout for the action in milliseconds

        Returns:
            IntentExecutionResult
        """
        return self.execute_intent("close-modal", timeout=timeout)

    def confirm_action(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """
        Confirm an action in a confirmation dialog.

        Args:
            timeout: Timeout for the action in milliseconds

        Returns:
            IntentExecutionResult
        """
        return self.execute_intent("confirm-action", timeout=timeout)

    def cancel_action(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """
        Cancel an action in a confirmation dialog.

        Args:
            timeout: Timeout for the action in milliseconds

        Returns:
            IntentExecutionResult
        """
        return self.execute_intent("cancel-action", timeout=timeout)

    # =========================================================================
    # Recovery-Enabled Execution
    # =========================================================================

    def execute_with_recovery(
        self,
        instruction: str,
        *,
        context: str | None = None,
        timeout: int | None = None,
        confidence_threshold: float | None = None,
        max_retries: int = 3,
        recovery_enabled: bool = True,
    ) -> ExecuteWithRecoveryResult:
        """
        Execute a natural language instruction with automatic recovery.

        This method attempts to execute an instruction and automatically
        recovers from failures using appropriate strategies based on the
        error type.

        Recovery strategies include:
        - Retry with exponential backoff (for timeouts, network errors)
        - Wait for element visibility/enabled state
        - Scroll element into view
        - Dismiss overlays/modals blocking the element
        - Try alternative elements from partial matches
        - Refresh the page as a last resort

        Args:
            instruction: Natural language instruction (e.g., "click the Submit button")
            context: Optional context to help disambiguate
            timeout: Action timeout in milliseconds
            confidence_threshold: Minimum confidence for element matching (0-1)
            max_retries: Maximum number of recovery attempts (default: 3)
            recovery_enabled: Whether to attempt recovery on failure (default: True)

        Returns:
            ExecuteWithRecoveryResult with execution and recovery history

        Example:
            >>> # Execute with automatic recovery
            >>> result = client.ai.execute_with_recovery("click the Submit button")
            >>> if result.success:
            ...     print(f"Succeeded after {result.total_attempts} attempts")
            ... else:
            ...     print(f"Failed: {result.error}")
            ...     if result.recovery_result:
            ...         for sr in result.recovery_result.strategy_results:
            ...             print(f"  - {sr.strategy_name}: {sr.message}")
            >>>
            >>> # Execute without recovery
            >>> result = client.ai.execute_with_recovery(
            ...     "click the Submit button",
            ...     recovery_enabled=False
            ... )
        """
        import time

        from .recovery_types import ExecuteWithRecoveryResult, RecoveryExecutorResult

        start_time = time.time()
        total_attempts = 0
        recovery_result: RecoveryExecutorResult | None = None
        last_response: NLActionResponse | None = None
        current_instruction = instruction

        while total_attempts < max_retries:
            total_attempts += 1

            # Execute the instruction
            response = self.execute(
                current_instruction,
                context=context,
                timeout=timeout,
                confidence_threshold=confidence_threshold,
            )
            last_response = response

            # If successful, return immediately
            if response.success:
                total_duration_ms = (time.time() - start_time) * 1000
                return ExecuteWithRecoveryResult(
                    success=True,
                    executed_action=response.executed_action,
                    element_used=response.element_used,
                    confidence=response.confidence,
                    element_state=response.element_state,
                    duration_ms=response.duration_ms,
                    timestamp=response.timestamp,
                    recovery_attempted=total_attempts > 1,
                    recovery_result=recovery_result,
                    total_attempts=total_attempts,
                    total_duration_ms=total_duration_ms,
                )

            # Check if recovery is enabled and retry is recommended
            if not recovery_enabled:
                break

            failure_info = response.failure_info
            if not failure_info or not failure_info.retry_recommended:
                break

            # Attempt recovery via the server
            try:
                recovery_data = self._client._request(
                    "POST",
                    "/ai/recovery/attempt",
                    json={
                        "failure": failure_info.model_dump(by_alias=True),
                        "instruction": instruction,
                        "elementId": response.element_used.id if response.element_used else None,
                        "maxRetries": max_retries - total_attempts,
                    },
                )
                recovery_result = RecoveryExecutorResult.model_validate(recovery_data)

                # If recovery failed or shouldn't retry, break
                if not recovery_result.success or not recovery_result.should_retry:
                    break

                # If we have an alternative element, try using it
                if recovery_result.alternative_element:
                    # Update instruction to target the alternative element
                    alt_desc = recovery_result.alternative_element.description
                    # Try to extract action type from original instruction
                    action_type = "click"  # default
                    lower_instruction = instruction.lower()
                    if "type" in lower_instruction or "enter" in lower_instruction:
                        action_type = "type"
                    elif "select" in lower_instruction:
                        action_type = "select"
                    current_instruction = f'{action_type} "{alt_desc}"'

            except Exception:
                # If recovery request fails, just break the loop
                break

        # Recovery failed or not attempted
        total_duration_ms = (time.time() - start_time) * 1000
        return ExecuteWithRecoveryResult(
            success=False,
            executed_action=last_response.executed_action if last_response else instruction,
            element_used=last_response.element_used if last_response else None,
            confidence=last_response.confidence if last_response else 0.0,
            element_state=last_response.element_state if last_response else None,
            duration_ms=last_response.duration_ms if last_response else 0.0,
            timestamp=last_response.timestamp if last_response else int(time.time() * 1000),
            error=last_response.error if last_response else "Unknown error",
            error_code=last_response.error_code if last_response else None,
            recovery_attempted=recovery_result is not None,
            recovery_result=recovery_result,
            total_attempts=total_attempts,
            total_duration_ms=total_duration_ms,
        )

    def click_with_recovery(
        self,
        target: str,
        *,
        max_retries: int = 3,
    ) -> ExecuteWithRecoveryResult:
        """
        Click an element with automatic recovery.

        Args:
            target: Natural language description of the element
            max_retries: Maximum recovery attempts

        Returns:
            ExecuteWithRecoveryResult
        """
        return self.execute_with_recovery(f'click "{target}"', max_retries=max_retries)

    def type_text_with_recovery(
        self,
        target: str,
        text: str,
        *,
        max_retries: int = 3,
    ) -> ExecuteWithRecoveryResult:
        """
        Type text into an element with automatic recovery.

        Args:
            target: Natural language description of the element
            text: Text to type
            max_retries: Maximum recovery attempts

        Returns:
            ExecuteWithRecoveryResult
        """
        return self.execute_with_recovery(
            f"type '{text}' into {target}",
            max_retries=max_retries,
        )
