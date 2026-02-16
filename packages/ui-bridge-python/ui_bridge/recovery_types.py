"""
Recovery Types

Type definitions for recovery-enabled execution in UI Bridge.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from .ai_types import AIDiscoveredElement
from .types import ElementState


class StrategyStatus(str, Enum):
    """Status of a recovery strategy execution."""

    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    PARTIAL = "partial"


class RecoveryStrategyResult(BaseModel):
    """Result from executing a single recovery strategy."""

    strategy_name: str = Field(alias="strategyName")
    status: StrategyStatus
    message: str
    duration_ms: float = Field(alias="durationMs")

    model_config = {"populate_by_name": True}


class RecoveryContext(BaseModel):
    """Context for recovery execution."""

    error_code: str = Field(alias="errorCode")
    instruction: str
    element_id: str | None = Field(default=None, alias="elementId")
    max_retries: int = Field(alias="maxRetries")

    model_config = {"populate_by_name": True}


class RecoveryExecutorConfig(BaseModel):
    """Configuration for the recovery executor."""

    max_retries: int = Field(default=3, alias="maxRetries")
    retry_delay_ms: int = Field(default=500, alias="retryDelayMs")
    exponential_backoff: bool = Field(default=True, alias="exponentialBackoff")
    strategies: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class RecoveryExecutorResult(BaseModel):
    """Result from the recovery executor."""

    success: bool
    strategy_results: list[RecoveryStrategyResult] = Field(
        default_factory=list, alias="strategyResults"
    )
    should_retry: bool = Field(default=False, alias="shouldRetry")
    alternative_element: AIDiscoveredElement | None = Field(
        default=None, alias="alternativeElement"
    )
    message: str | None = None

    model_config = {"populate_by_name": True}


class ExecuteWithRecoveryResult(BaseModel):
    """Result from executing an action with automatic recovery."""

    success: bool
    executed_action: str = Field(alias="executedAction")
    element_used: AIDiscoveredElement | None = Field(default=None, alias="elementUsed")
    confidence: float
    element_state: ElementState | None = Field(default=None, alias="elementState")
    duration_ms: float = Field(alias="durationMs")
    timestamp: int
    error: str | None = None
    error_code: str | None = Field(default=None, alias="errorCode")
    recovery_attempted: bool = Field(default=False, alias="recoveryAttempted")
    recovery_result: RecoveryExecutorResult | None = Field(default=None, alias="recoveryResult")
    total_attempts: int = Field(default=1, alias="totalAttempts")
    total_duration_ms: float = Field(default=0.0, alias="totalDurationMs")

    model_config = {"populate_by_name": True}


# Default recovery configuration
DEFAULT_RECOVERY_CONFIG = RecoveryExecutorConfig(
    max_retries=3,
    retry_delay_ms=500,
    exponential_backoff=True,
    strategies=[
        "retry",
        "wait_visible",
        "wait_enabled",
        "scroll_into_view",
        "dismiss_overlay",
        "alternative_element",
        "refresh",
    ],
)

# Mapping of error codes to recommended recovery strategies
ERROR_CODE_STRATEGIES: dict[str, list[str]] = {
    "ELEMENT_NOT_FOUND": ["wait_visible", "scroll_into_view", "alternative_element", "refresh"],
    "ELEMENT_NOT_VISIBLE": ["wait_visible", "scroll_into_view", "dismiss_overlay"],
    "ELEMENT_NOT_ENABLED": ["wait_enabled", "dismiss_overlay"],
    "ELEMENT_DISABLED": ["wait_enabled"],
    "ACTION_TIMEOUT": ["retry", "wait_visible", "wait_enabled"],
    "LOW_CONFIDENCE": ["alternative_element"],
    "OVERLAY_BLOCKING": ["dismiss_overlay"],
}
