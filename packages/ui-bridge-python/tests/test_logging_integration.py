"""Integration tests for logging with the async client.

Verifies that UIBridgeLogger produces correct JSONL output when
driven through AsyncUIBridgeClient operations (traces, actions, snapshots).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from ui_bridge.async_client import AsyncUIBridgeClient
from ui_bridge.logging import EventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_httpx_response(
    data: dict[str, Any],
    status_code: int = 200,
) -> httpx.Response:
    """Build a real ``httpx.Response`` wrapping *data* as ``{"success": True, "data": ...}``."""
    payload = {"success": True, "data": data}
    return httpx.Response(
        status_code=status_code,
        json=payload,
        request=httpx.Request("POST", "http://localhost:9876/ui-bridge/fake"),
    )


def _action_response_data() -> dict[str, Any]:
    """Minimal successful action response payload."""
    return {
        "success": True,
        "durationMs": 42.0,
        "timestamp": 1700000000,
    }


def _snapshot_response_data() -> dict[str, Any]:
    """Minimal successful snapshot response payload."""
    return {
        "timestamp": 1700000000,
        "elements": [],
        "components": [],
        "workflows": [],
        "activeRuns": [],
    }


def _read_log_entries(path: Any) -> list[dict[str, Any]]:
    """Read all JSONL entries from *path* and return as dicts."""
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    return [json.loads(line) for line in text.splitlines()]


# ---------------------------------------------------------------------------
# Success-path integration test
# ---------------------------------------------------------------------------


class TestLoggingIntegrationSuccess:
    """Full trace through click, type, get_snapshot with logging enabled."""

    @pytest.mark.asyncio
    async def test_full_trace_produces_correct_log_entries(self, tmp_path, monkeypatch):
        log_file = tmp_path / "ui-bridge.jsonl"

        client = AsyncUIBridgeClient(base_url="http://localhost:9876")
        client.enable_logging(file_path=str(log_file), level="debug")

        # -- stub the httpx client's request method so _request runs fully --
        async def _fake_httpx_request(
            method: str,
            url: str,  # noqa: ARG001
            **kwargs: Any,
        ) -> httpx.Response:
            if "/snapshot" in url:
                return _make_httpx_response(_snapshot_response_data())
            return _make_httpx_response(_action_response_data())

        monkeypatch.setattr(client._client, "request", _fake_httpx_request)

        # -- run operations -----------------------------------------------
        trace = client.start_trace()
        await client.click("submit-btn")
        await client.type("email-input", "user@example.com")
        await client.get_snapshot()
        client.end_trace()

        # -- read & parse log file ----------------------------------------
        entries = _read_log_entries(log_file)

        # -- verify entry count -------------------------------------------
        # Expected entries (at debug level):
        #   1  TRACE_START
        #   2  ACTION_START   (click)
        #   3  REQUEST_START  (click HTTP call)
        #   4  REQUEST_COMPLETE
        #   5  ACTION_COMPLETE
        #   6  ACTION_START   (type)
        #   7  REQUEST_START  (type HTTP call)
        #   8  REQUEST_COMPLETE
        #   9  ACTION_COMPLETE
        #  10  REQUEST_START  (get_snapshot)
        #  11  REQUEST_COMPLETE
        #  12  TRACE_END
        assert len(entries) == 12, f"Expected 12 log entries, got {len(entries)}:\n" + "\n".join(
            e["event_type"] for e in entries
        )

        # -- verify TRACE_START / TRACE_END present -----------------------
        event_types = [e["event_type"] for e in entries]
        assert event_types[0] == EventType.TRACE_START.value
        assert event_types[-1] == EventType.TRACE_END.value

        # -- verify REQUEST_START / REQUEST_COMPLETE pairs ----------------
        request_starts = [e for e in entries if e["event_type"] == EventType.REQUEST_START.value]
        request_completes = [
            e for e in entries if e["event_type"] == EventType.REQUEST_COMPLETE.value
        ]
        assert len(request_starts) == 3  # click, type, get_snapshot
        assert len(request_completes) == 3

        # -- verify ACTION_START / ACTION_COMPLETE pairs ------------------
        action_starts = [e for e in entries if e["event_type"] == EventType.ACTION_START.value]
        action_completes = [
            e for e in entries if e["event_type"] == EventType.ACTION_COMPLETE.value
        ]
        assert len(action_starts) == 2  # click, type (get_snapshot has no action log)
        assert len(action_completes) == 2

        # -- all entries share the same trace_id --------------------------
        trace_id = trace.trace_id
        for entry in entries:
            assert entry.get("trace_id") == trace_id, (
                f"Entry {entry['event_type']} has trace_id={entry.get('trace_id')!r}, "
                f"expected {trace_id!r}"
            )

        # -- timestamps are monotonically non-decreasing ------------------
        timestamps = [e["timestamp"] for e in entries]
        for i in range(1, len(timestamps)):
            assert timestamps[i] >= timestamps[i - 1], (
                f"Timestamp went backwards at index {i}: " f"{timestamps[i]} < {timestamps[i - 1]}"
            )

        # -- duration_ms present on completion entries --------------------
        for entry in request_completes + action_completes:
            assert entry["data"] is not None
            assert (
                "duration_ms" in entry["data"]
            ), f"Missing duration_ms in {entry['event_type']} data"
            assert isinstance(entry["data"]["duration_ms"], int | float)

        await client.close()


# ---------------------------------------------------------------------------
# Error-path integration tests
# ---------------------------------------------------------------------------


class TestLoggingIntegrationError:
    """Verify ACTION_FAIL and REQUEST_FAIL entries on exceptions."""

    @pytest.mark.asyncio
    async def test_failed_action_logs_fail_entries(self, tmp_path, monkeypatch):
        """Monkeypatch _request so only _execute_action logging fires.

        This simulates a low-level network failure that _request itself would
        raise, verifying that _execute_action logs ACTION_START + ACTION_FAIL.
        """
        log_file = tmp_path / "ui-bridge-errors.jsonl"

        client = AsyncUIBridgeClient(base_url="http://localhost:9876")
        client.enable_logging(file_path=str(log_file), level="debug")

        # Replace _request entirely so no REQUEST_* logs are emitted
        async def _failing_request(
            method: str,
            path: str,
            *,
            json: dict[str, Any] | None = None,
            params: dict[str, Any] | None = None,
        ) -> Any:
            raise ConnectionError("Connection refused")

        monkeypatch.setattr(client, "_request", _failing_request)

        trace = client.start_trace()

        with pytest.raises(ConnectionError, match="Connection refused"):
            await client.click("submit-btn")

        client.end_trace()

        entries = _read_log_entries(log_file)
        event_types = [e["event_type"] for e in entries]

        # Expected:
        #   1  TRACE_START
        #   2  ACTION_START   (click)
        #   3  ACTION_FAIL    (_execute_action catches the generic Exception)
        #   4  TRACE_END
        assert EventType.TRACE_START.value in event_types
        assert EventType.TRACE_END.value in event_types
        assert EventType.ACTION_START.value in event_types
        assert EventType.ACTION_FAIL.value in event_types

        # The fail entry should contain error details
        fail_entries = [e for e in entries if e["event_type"] == EventType.ACTION_FAIL.value]
        assert len(fail_entries) == 1

        fail_data = fail_entries[0]["data"]
        assert fail_data is not None
        assert "duration_ms" in fail_data
        assert "error_message" in fail_data
        assert "Connection refused" in fail_data["error_message"]
        assert fail_data["error_code"] == "NETWORK_ERROR"

        # All entries share the same trace_id
        trace_id = trace.trace_id
        for entry in entries:
            assert entry.get("trace_id") == trace_id

        await client.close()

    @pytest.mark.asyncio
    async def test_failed_request_logs_request_and_action_fail(self, tmp_path, monkeypatch):
        """When the HTTP layer raises, both REQUEST_FAIL and ACTION_FAIL appear.

        Monkeypatches the underlying httpx client so that _request's own
        logging (REQUEST_START, REQUEST_FAIL) fires in addition to
        _execute_action's logging (ACTION_START, ACTION_FAIL).
        """
        log_file = tmp_path / "ui-bridge-req-errors.jsonl"

        client = AsyncUIBridgeClient(base_url="http://localhost:9876")
        client.enable_logging(file_path=str(log_file), level="debug")

        async def _httpx_fail(*args: Any, **kwargs: Any) -> Any:
            raise ConnectionError("Connection refused")

        monkeypatch.setattr(client._client, "request", _httpx_fail)

        client.start_trace()

        with pytest.raises(ConnectionError, match="Connection refused"):
            await client.click("submit-btn")

        client.end_trace()

        entries = _read_log_entries(log_file)
        event_types = [e["event_type"] for e in entries]

        # Expected:
        #   1  TRACE_START
        #   2  ACTION_START
        #   3  REQUEST_START
        #   4  REQUEST_FAIL   (from _request's except Exception handler)
        #   5  ACTION_FAIL    (from _execute_action's except Exception handler)
        #   6  TRACE_END
        assert EventType.TRACE_START.value in event_types
        assert EventType.REQUEST_START.value in event_types
        assert EventType.REQUEST_FAIL.value in event_types
        assert EventType.ACTION_FAIL.value in event_types
        assert EventType.TRACE_END.value in event_types

        # REQUEST_FAIL has duration_ms and error
        req_fail = [e for e in entries if e["event_type"] == EventType.REQUEST_FAIL.value]
        assert len(req_fail) == 1
        assert "duration_ms" in req_fail[0]["data"]
        assert "Connection refused" in req_fail[0]["data"]["error"]

        # ACTION_FAIL has duration_ms, error_message, and error_code
        act_fail = [e for e in entries if e["event_type"] == EventType.ACTION_FAIL.value]
        assert len(act_fail) == 1
        assert "duration_ms" in act_fail[0]["data"]
        assert act_fail[0]["data"]["error_code"] == "NETWORK_ERROR"

        await client.close()
