"""
Async AI Client

Async AI-native UI Bridge client providing natural language interaction,
semantic snapshots, and assertion capabilities.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .async_client import AsyncUIBridgeClient
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


class AsyncAIClient:
    """
    Async AI-native UI Bridge client.

    Provides async natural language interaction with UI elements.

    Example:
        >>> async with AsyncUIBridgeClient() as client:
        ...     result = await client.ai.execute("click the Submit button")
        ...     await client.ai.assert_that("error message", "hidden")
        ...     snapshot = await client.ai.snapshot()
    """

    def __init__(self, http_client: AsyncUIBridgeClient):
        """
        Initialize the async AI client.

        Args:
            http_client: The parent AsyncUIBridgeClient instance
        """
        self._client = http_client

    # =========================================================================
    # Search Methods
    # =========================================================================

    async def search(
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
        response = await self._search(criteria)
        return response.results

    async def find(self, description: str, *, fuzzy: bool = True) -> AIDiscoveredElement | None:
        """
        Find an element by natural language description.

        Args:
            description: Natural language description of the element
            fuzzy: Enable fuzzy matching (default: True)

        Returns:
            The best matching element, or None if not found
        """
        response = await self._search(SearchCriteria(text=description, fuzzy=fuzzy))
        if response.best_match:
            return response.best_match.element
        return None

    async def find_by_text(self, text: str, *, fuzzy: bool = True) -> AIDiscoveredElement | None:
        """Find an element by its visible text."""
        return await self.find(text, fuzzy=fuzzy)

    async def find_by_role(self, role: str, name: str | None = None) -> list[SearchResult]:
        """Find elements by ARIA role."""
        criteria = SearchCriteria(role=role, accessible_name=name)
        response = await self._search(criteria)
        return response.results

    async def _search(self, criteria: SearchCriteria) -> SearchResponse:
        """Execute search request."""
        data = await self._client._request(
            "POST",
            "/ai/search",
            json=criteria.model_dump(by_alias=True, exclude_none=True),
        )
        return SearchResponse.model_validate(data)

    # =========================================================================
    # Semantic Search (Embedding-based)
    # =========================================================================

    async def semantic_search(
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

        Args:
            query: Natural language description of what you're looking for
            threshold: Minimum similarity score (0-1, default: 0.5)
            limit: Maximum number of results to return
            element_type: Filter by element type
            role: Filter by ARIA role
            combine_with_text: Combine with text-based search

        Returns:
            List of SemanticSearchResult objects sorted by similarity
        """
        criteria = SemanticSearchCriteria(
            query=query,
            threshold=threshold,
            limit=limit,
            type=element_type,
            role=role,
            combine_with_text=combine_with_text,
        )
        response = await self._semantic_search(criteria)
        return response.results

    async def semantic_find(
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
        """
        response = await self._semantic_search(
            SemanticSearchCriteria(query=query, threshold=threshold, limit=1)
        )
        if response.best_match:
            return response.best_match.element
        return None

    async def _semantic_search(self, criteria: SemanticSearchCriteria) -> SemanticSearchResponse:
        """Execute semantic search request."""
        data = await self._client._request(
            "POST",
            "/ai/semantic-search",
            json=criteria.model_dump(by_alias=True, exclude_none=True),
        )
        return SemanticSearchResponse.model_validate(data)

    # =========================================================================
    # Natural Language Execution
    # =========================================================================

    async def execute(
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
        """
        request = NLActionRequest(
            instruction=instruction,
            context=context,
            timeout=timeout,
            confidence_threshold=confidence_threshold,
        )
        data = await self._client._request(
            "POST",
            "/ai/execute",
            json=request.model_dump(by_alias=True, exclude_none=True),
        )
        return NLActionResponse.model_validate(data)

    async def click(self, target: str) -> NLActionResponse:
        """Click an element by description."""
        return await self.execute(f'click "{target}"')

    async def type_text(self, target: str, text: str) -> NLActionResponse:
        """Type text into an element."""
        return await self.execute(f"type '{text}' into {target}")

    async def select_option(self, target: str, option: str) -> NLActionResponse:
        """Select an option from a dropdown."""
        return await self.execute(f"select '{option}' from {target}")

    # =========================================================================
    # Assertions
    # =========================================================================

    async def assert_that(
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
        data = await self._client._request(
            "POST",
            "/ai/assert",
            json=request.model_dump(by_alias=True, exclude_none=True),
        )
        return AssertionResult.model_validate(data)

    async def assert_visible(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is visible."""
        return await self.assert_that(target, AssertionType.VISIBLE, timeout=timeout)

    async def assert_hidden(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is hidden."""
        return await self.assert_that(target, AssertionType.HIDDEN, timeout=timeout)

    async def assert_enabled(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is enabled."""
        return await self.assert_that(target, AssertionType.ENABLED, timeout=timeout)

    async def assert_disabled(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element is disabled."""
        return await self.assert_that(target, AssertionType.DISABLED, timeout=timeout)

    async def assert_has_text(
        self, target: str, text: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert element has exact text."""
        return await self.assert_that(target, AssertionType.HAS_TEXT, text, timeout=timeout)

    async def assert_contains_text(
        self, target: str, text: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert element contains text."""
        return await self.assert_that(target, AssertionType.CONTAINS_TEXT, text, timeout=timeout)

    async def assert_has_value(
        self, target: str, value: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert input element has value."""
        return await self.assert_that(target, AssertionType.HAS_VALUE, value, timeout=timeout)

    async def assert_exists(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert element exists."""
        return await self.assert_that(target, AssertionType.EXISTS, timeout=timeout)

    async def assert_not_exists(
        self, target: str, *, timeout: int | None = None
    ) -> AssertionResult:
        """Assert element does not exist."""
        return await self.assert_that(target, AssertionType.NOT_EXISTS, timeout=timeout)

    async def assert_checked(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert checkbox is checked."""
        return await self.assert_that(target, AssertionType.CHECKED, timeout=timeout)

    async def assert_unchecked(self, target: str, *, timeout: int | None = None) -> AssertionResult:
        """Assert checkbox is unchecked."""
        return await self.assert_that(target, AssertionType.UNCHECKED, timeout=timeout)

    async def assert_batch(
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
        data = await self._client._request(
            "POST",
            "/ai/assert/batch",
            json=batch_request.model_dump(by_alias=True, exclude_none=True),
        )
        return BatchAssertionResult.model_validate(data)

    # =========================================================================
    # Semantic Snapshots
    # =========================================================================

    async def snapshot(self) -> SemanticSnapshot:
        """Get a semantic snapshot of the current page."""
        data = await self._client._request("GET", "/ai/snapshot")
        return SemanticSnapshot.model_validate(data)

    async def diff(self, since: int | None = None) -> SemanticDiff | None:
        """
        Get changes since a previous snapshot.

        Args:
            since: Timestamp of the previous snapshot (optional)

        Returns:
            SemanticDiff describing changes, or None if no previous snapshot
        """
        params = {"since": since} if since else None
        data = await self._client._request("GET", "/ai/diff", params=params)
        if data is None:
            return None
        return SemanticDiff.model_validate(data)

    async def summary(self) -> str:
        """Get a plain text summary of the current page."""
        result: str = await self._client._request("GET", "/ai/summary")
        return result

    # =========================================================================
    # Convenience Methods
    # =========================================================================

    async def wait_for_visible(self, target: str, *, timeout: int = 5000) -> AssertionResult:
        """Wait for an element to become visible."""
        return await self.assert_visible(target, timeout=timeout)

    async def wait_for_hidden(self, target: str, *, timeout: int = 5000) -> AssertionResult:
        """Wait for an element to become hidden."""
        return await self.assert_hidden(target, timeout=timeout)

    async def wait_for_enabled(self, target: str, *, timeout: int = 5000) -> AssertionResult:
        """Wait for an element to become enabled."""
        return await self.assert_enabled(target, timeout=timeout)

    async def verify_page_state(
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
        result = await self.assert_batch(assertions, mode="all")
        return result.passed

    # =========================================================================
    # Intent-Based Actions
    # =========================================================================

    async def execute_intent(
        self,
        intent: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """
        Execute an intent by name with parameters.

        Args:
            intent: The intent ID (e.g., "login", "navigate-to")
            params: Parameters for the intent
            timeout: Timeout for each action step in milliseconds

        Returns:
            IntentExecutionResult with step-by-step status
        """
        request_data: dict[str, Any] = {
            "intentId": intent,
            "params": params or {},
        }
        if timeout is not None:
            request_data["timeout"] = timeout

        data = await self._client._request(
            "POST",
            "/ai/intents/execute",
            json=request_data,
        )
        return IntentExecutionResult.model_validate(data)

    async def find_intent(
        self,
        query: str,
        *,
        threshold: float | None = None,
    ) -> IntentSearchResponse:
        """
        Find matching intents for a natural language query.

        Args:
            query: Natural language query (e.g., "log me in", "go to settings")
            threshold: Minimum confidence threshold (0-1, default: 0.6)

        Returns:
            IntentSearchResponse with matching intents and confidence scores
        """
        request_data: dict[str, Any] = {"query": query}
        if threshold is not None:
            request_data["threshold"] = threshold

        data = await self._client._request(
            "POST",
            "/ai/intents/find",
            json=request_data,
        )
        return IntentSearchResponse.model_validate(data)

    async def list_intents(self, *, tag: str | None = None) -> list[Intent]:
        """
        List available intents.

        Args:
            tag: Optional tag to filter by

        Returns:
            List of available Intent objects
        """
        params = {"tag": tag} if tag else None
        data = await self._client._request("GET", "/ai/intents", params=params)
        return [Intent.model_validate(item) for item in data]

    async def register_intent(self, intent: Intent) -> None:
        """Register a custom intent."""
        await self._client._request(
            "POST",
            "/ai/intents/register",
            json=intent.model_dump(by_alias=True, exclude_none=True),
        )

    async def execute_intent_from_query(
        self,
        query: str,
        additional_params: dict[str, Any] | None = None,
        *,
        timeout: int | None = None,
        threshold: float | None = None,
    ) -> IntentExecutionResult:
        """
        Find and execute an intent from natural language.

        Args:
            query: Natural language instruction
            additional_params: Additional parameters to merge with extracted ones
            timeout: Timeout for each action step in milliseconds
            threshold: Minimum confidence threshold for intent matching

        Returns:
            IntentExecutionResult with step-by-step status
        """
        request_data: dict[str, Any] = {
            "query": query,
            "additionalParams": additional_params or {},
        }
        if timeout is not None:
            request_data["timeout"] = timeout
        if threshold is not None:
            request_data["threshold"] = threshold

        data = await self._client._request(
            "POST",
            "/ai/intents/execute-from-query",
            json=request_data,
        )
        return IntentExecutionResult.model_validate(data)

    # Convenience methods for common intents

    async def login(
        self,
        username: str,
        password: str,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """Execute the login intent."""
        return await self.execute_intent(
            "login",
            {"username": username, "password": password},
            timeout=timeout,
        )

    async def logout(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """Execute the logout intent."""
        return await self.execute_intent("logout", timeout=timeout)

    async def navigate_to(
        self,
        destination: str,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """Navigate to a page or section."""
        return await self.execute_intent(
            "navigate-to",
            {"destination": destination},
            timeout=timeout,
        )

    async def search_for(
        self,
        query: str,
        *,
        timeout: int | None = None,
    ) -> IntentExecutionResult:
        """Execute the search intent."""
        return await self.execute_intent(
            "search-for",
            {"query": query},
            timeout=timeout,
        )

    async def submit_form(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """Submit the current form."""
        return await self.execute_intent("submit-form", timeout=timeout)

    async def close_modal(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """Close the current modal or dialog."""
        return await self.execute_intent("close-modal", timeout=timeout)

    async def confirm_action(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """Confirm an action in a confirmation dialog."""
        return await self.execute_intent("confirm-action", timeout=timeout)

    async def cancel_action(self, *, timeout: int | None = None) -> IntentExecutionResult:
        """Cancel an action in a confirmation dialog."""
        return await self.execute_intent("cancel-action", timeout=timeout)

    # =========================================================================
    # Recovery-Enabled Execution
    # =========================================================================

    async def execute_with_recovery(
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

        Args:
            instruction: Natural language instruction
            context: Optional context to help disambiguate
            timeout: Action timeout in milliseconds
            confidence_threshold: Minimum confidence for element matching (0-1)
            max_retries: Maximum number of recovery attempts (default: 3)
            recovery_enabled: Whether to attempt recovery on failure (default: True)

        Returns:
            ExecuteWithRecoveryResult with execution and recovery history
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

            response = await self.execute(
                current_instruction,
                context=context,
                timeout=timeout,
                confidence_threshold=confidence_threshold,
            )
            last_response = response

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

            if not recovery_enabled:
                break

            failure_info = response.failure_info
            if not failure_info or not failure_info.retry_recommended:
                break

            try:
                recovery_data = await self._client._request(
                    "POST",
                    "/ai/recovery/attempt",
                    json={
                        "failure": failure_info.model_dump(by_alias=True),
                        "instruction": instruction,
                        "elementId": (response.element_used.id if response.element_used else None),
                        "maxRetries": max_retries - total_attempts,
                    },
                )
                recovery_result = RecoveryExecutorResult.model_validate(recovery_data)

                if not recovery_result.success or not recovery_result.should_retry:
                    break

                if recovery_result.alternative_element:
                    alt_desc = recovery_result.alternative_element.description
                    action_type = "click"
                    lower_instruction = instruction.lower()
                    if "type" in lower_instruction or "enter" in lower_instruction:
                        action_type = "type"
                    elif "select" in lower_instruction:
                        action_type = "select"
                    current_instruction = f'{action_type} "{alt_desc}"'

            except Exception:
                break

        total_duration_ms = (time.time() - start_time) * 1000
        return ExecuteWithRecoveryResult(
            success=False,
            executed_action=last_response.executed_action if last_response else instruction,
            element_used=last_response.element_used if last_response else None,
            confidence=last_response.confidence if last_response else 0.0,
            element_state=last_response.element_state if last_response else None,
            duration_ms=last_response.duration_ms if last_response else 0.0,
            timestamp=(last_response.timestamp if last_response else int(time.time() * 1000)),
            error=last_response.error if last_response else "Unknown error",
            error_code=last_response.error_code if last_response else None,
            recovery_attempted=recovery_result is not None,
            recovery_result=recovery_result,
            total_attempts=total_attempts,
            total_duration_ms=total_duration_ms,
        )

    async def click_with_recovery(
        self,
        target: str,
        *,
        max_retries: int = 3,
    ) -> ExecuteWithRecoveryResult:
        """Click an element with automatic recovery."""
        return await self.execute_with_recovery(f'click "{target}"', max_retries=max_retries)

    async def type_text_with_recovery(
        self,
        target: str,
        text: str,
        *,
        max_retries: int = 3,
    ) -> ExecuteWithRecoveryResult:
        """Type text into an element with automatic recovery."""
        return await self.execute_with_recovery(
            f"type '{text}' into {target}",
            max_retries=max_retries,
        )
