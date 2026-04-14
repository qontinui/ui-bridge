"""
Capture-Host Driver

Client-side driver for the capture-host UI Bridge pattern. Pairs with
``@qontinui/ui-bridge/react``'s ``<CaptureHostFrame>`` component to let an
external Python process drive a React host page through thousands of
iframe-rendered "samples" without the UI Bridge SDK dropping its
connection mid-loop.

Why the pattern exists
----------------------
Some pages (position:fixed backdrops, unusual Suspense chains, etc.) unmount
the UI Bridge provider tree when navigated to directly. Once the provider
tree unmounts, every subsequent UI Bridge command fails because the server
has no SSE listener. A stable "host" page keeps the provider tree alive
for the whole run and cycles an inner iframe through the unstable URLs;
the iframe posts measurement data back to the host via
``window.postMessage``, and the host mirrors it into a hidden
echo-input the driver reads from ``/control/snapshot``.

Typical usage
-------------
.. code-block:: python

    from ui_bridge import UIBridgeClient
    from ui_bridge.capture_host import CaptureHostDriver

    client = UIBridgeClient(base_url="http://localhost:3001/api/ui-bridge")
    driver = CaptureHostDriver(
        client,
        host_url="http://localhost:3001/dev/my-capture-host",
    )
    driver.ensure_connected()

    for i, sample in enumerate(samples):
        echo = driver.advance(sample_url(sample), sample_index=i)
        if echo is not None:
            print("bbox:", echo)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .client import UIBridgeClient

logger = logging.getLogger(__name__)

# Defaults — must match DEFAULT_CAPTURE_HOST_IDS in the React component.
DEFAULT_URL_INPUT_ID = "capture-next-url"
DEFAULT_ADVANCE_ID = "capture-advance"
DEFAULT_ECHO_ID = "capture-last-echo"


@dataclass(frozen=True)
class CaptureHostIds:
    """Stable element IDs the driver writes to / reads from.

    Must match the ids prop passed to ``<CaptureHostFrame>`` on the host
    page. Defaults line up with ``DEFAULT_CAPTURE_HOST_IDS`` in the React
    export.
    """

    url_input: str = DEFAULT_URL_INPUT_ID
    advance: str = DEFAULT_ADVANCE_ID
    echo: str = DEFAULT_ECHO_ID


class CaptureHostDriver:
    """Automation driver for ``<CaptureHostFrame>``-based capture loops.

    Parameters
    ----------
    client:
        A connected :class:`ui_bridge.UIBridgeClient`.
    host_url:
        The full URL the host page lives at (used for bootstrap via
        ``webbrowser.open`` when no tab is connected). If ``None`` the
        driver will only try UI Bridge navigation; it won't open new tabs.
    host_path:
        The path portion of *host_url* used for in-tab redirects when an
        existing (different) tab is connected. Defaults to the path of
        *host_url* if provided.
    ids:
        Override the default element IDs if you've customised the host.
    advance_timeout_s:
        How long ``advance()`` waits for a matching echo before returning
        ``None``.
    """

    def __init__(
        self,
        client: "UIBridgeClient",
        *,
        host_url: str | None = None,
        host_path: str | None = None,
        ids: CaptureHostIds | None = None,
        advance_timeout_s: float = 6.0,
    ) -> None:
        self.client = client
        self.host_url = host_url
        if host_path is None and host_url is not None:
            from urllib.parse import urlparse

            host_path = urlparse(host_url).path or "/"
        self.host_path = host_path
        self.ids = ids or CaptureHostIds()
        self.advance_timeout_s = advance_timeout_s

    # ------------------------------------------------------------------
    # Bootstrap
    # ------------------------------------------------------------------

    def is_host_connected(self) -> bool:
        """Return True iff the connected tab is the capture host.

        Detected by looking for the registered url_input and advance
        element IDs in the current snapshot.
        """
        try:
            snap = self.client.get_snapshot()
        except Exception:
            return False
        seen = {el.id for el in snap.elements}
        return self.ids.url_input in seen and self.ids.advance in seen

    def wait_host_connected(self, timeout_s: float = 15.0) -> bool:
        """Poll until :meth:`is_host_connected` returns True or time runs out."""
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.is_host_connected():
                return True
            time.sleep(0.3)
        return False

    def ensure_connected(
        self,
        *,
        open_browser: bool = True,
        max_attempts: int = 3,
        per_attempt_timeout_s: float = 20.0,
    ) -> None:
        """Guarantee the host page is open and its SDK is connected.

        Strategy:
            1. If the host is already connected, return immediately.
            2. If any tab is connected, hard-navigate it to ``host_path``.
            3. If no tab is connected and ``open_browser`` is True (and
               ``host_url`` was supplied), call
               ``webbrowser.open(host_url, new=2)``.
            4. Poll for host connection up to ``max_attempts`` times.

        Raises:
            CaptureHostBootstrapError if all attempts fail.
        """
        if self.is_host_connected():
            logger.info("CaptureHost already connected")
            return

        for attempt in range(1, max_attempts + 1):
            tab_connected = self._any_tab_connected()

            if tab_connected and self.host_path:
                logger.info(
                    "Redirecting existing tab to %s (attempt %d)",
                    self.host_path,
                    attempt,
                )
                try:
                    self.client.page_navigate(self.host_path, hard=True)
                    if self.wait_host_connected(per_attempt_timeout_s):
                        logger.info("CaptureHost connected")
                        return
                except Exception as exc:  # pragma: no cover - transport errors
                    logger.warning("UI Bridge navigate failed: %s", exc)

            if open_browser and self.host_url:
                logger.info(
                    "Opening capture host in default browser: %s (attempt %d)",
                    self.host_url,
                    attempt,
                )
                try:
                    import webbrowser

                    webbrowser.open(self.host_url, new=2)
                except Exception as exc:  # pragma: no cover
                    logger.warning("webbrowser.open failed: %s", exc)

            if self.wait_host_connected(per_attempt_timeout_s):
                logger.info("CaptureHost connected")
                return

        raise CaptureHostBootstrapError(
            "Failed to bootstrap capture host after "
            f"{max_attempts} attempts (host_url={self.host_url!r}, "
            f"host_path={self.host_path!r})"
        )

    def _any_tab_connected(self) -> bool:
        try:
            health = self.client.health().get("data", {})
        except Exception:
            return False
        return bool(health.get("connectedTabs"))

    # ------------------------------------------------------------------
    # Capture loop
    # ------------------------------------------------------------------

    def advance(
        self,
        url: str,
        *,
        sample_index: int | None = None,
        timeout_s: float | None = None,
        settle_delay_s: float = 0.0,
    ) -> dict[str, Any] | None:
        """Load *url* into the host's iframe and wait for the echo.

        Args:
            url: URL for the iframe to load.
            sample_index: If provided, the driver waits for an echo whose
                ``sampleIndex`` field matches before returning. Stale
                echoes (from prior samples) are ignored. Recommended:
                pass the iframe URL with a ``sampleIndex`` query param so
                the iframe can echo it back.
            timeout_s: Override for ``self.advance_timeout_s``.
            settle_delay_s: Wait this many seconds after receiving the
                echo before returning (gives the iframe a chance to
                finish painting before the caller takes a screenshot).

        Returns:
            The echo payload (as a dict) on success, or ``None`` if no
            matching echo arrived within the timeout.
        """
        deadline_budget = timeout_s if timeout_s is not None else self.advance_timeout_s

        self.client.set_value(self.ids.url_input, url)
        # Small delay so React processes the controlled-input change before
        # the click handler reads it via state.
        time.sleep(0.05)
        self.client.click(self.ids.advance)

        deadline = time.time() + deadline_budget
        while time.time() < deadline:
            echo = self._read_echo()
            if echo is not None and _matches_sample_index(echo, sample_index):
                if settle_delay_s > 0:
                    time.sleep(settle_delay_s)
                return echo
            time.sleep(0.1)
        return None

    def _read_echo(self) -> dict[str, Any] | None:
        """Return the current parsed echo value, or ``None`` if unavailable."""
        try:
            snap = self.client.get_snapshot()
        except Exception:
            return None
        for el in snap.elements:
            if el.id != self.ids.echo:
                continue
            raw: Any = None
            state = getattr(el, "state", None)
            if state is not None:
                raw = getattr(state, "value", None)
                if raw is None and isinstance(state, dict):
                    raw = state.get("value")
            if raw is None:
                raw = getattr(el, "value", None)
            if not raw:
                return None
            if isinstance(raw, dict):
                return raw
            try:
                import json as _json

                parsed = _json.loads(raw)
            except Exception:
                return None
            return parsed if isinstance(parsed, dict) else None
        return None


class CaptureHostBootstrapError(RuntimeError):
    """Raised when :meth:`CaptureHostDriver.ensure_connected` gives up."""


def _matches_sample_index(echo: dict[str, Any], expected: int | None) -> bool:
    if expected is None:
        return True
    try:
        return int(echo.get("sampleIndex", -1)) == int(expected)
    except (TypeError, ValueError):
        return False


__all__ = [
    "CaptureHostDriver",
    "CaptureHostIds",
    "CaptureHostBootstrapError",
    "DEFAULT_URL_INPUT_ID",
    "DEFAULT_ADVANCE_ID",
    "DEFAULT_ECHO_ID",
]
