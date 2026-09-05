"""
AFDrive Agent tunnel client.

Opens a single *outbound* WebSocket connection from this device to the
AFDrive Online relay (works behind NAT/CGNAT — no port forwarding, no
inbound firewall rule needed). Once connected, the relay can forward
HTTP requests from remote browsers to us over that socket; we replay
each one against our own local Flask app on loopback and stream the
response back.

This is intentionally a *generic* HTTP proxy, not a reimplementation of
AFDrive's routes: every existing Flask route (login, dashboard, every
/api/* endpoint) becomes remotely reachable through the tunnel with zero
duplicated business logic. See shared/protocol.md for the exact message
shapes used here, which must match web/lib/proxyRegistry.js on the relay.

This module never listens for inbound connections and never exposes the
storage root directly — every forwarded request still goes through the
Agent's normal Flask routing, session auth, and fs_utils path checks
exactly as if it arrived over the LAN.
"""

import logging
import queue
import random
import threading
import time

import requests
import socketio

from config import Config
import identity

log = logging.getLogger("afdrive.tunnel")

# Headers that only make sense hop-by-hop and must never be blindly
# replayed onto the loopback request or copied back onto the relay
# response.
_STRIP_INBOUND = {"host", "content-length", "connection"}
_STRIP_OUTBOUND = {"transfer-encoding", "connection", "content-encoding"}

_CHUNK_SIZE = 256 * 1024  # 256 KB per streamed chunk


class TunnelClient:
    def __init__(self):
        self.sio = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
        self._stop = threading.Event()
        # req_id -> queue.Queue() of body chunks (bytes), terminated by None,
        # for requests whose body arrives as a separate stream of events
        # (see shared/protocol.md, "requests with a body").
        self._body_queues = {}
        self._body_queues_lock = threading.Lock()
        self._register_handlers()

    # -- Wiring ---------------------------------------------------------

    def _register_handlers(self):
        sio = self.sio

        @sio.event
        def connect():
            log.info("Tunnel connected to relay at %s", Config.RELAY_URL)

        @sio.event
        def connect_error(data):
            log.warning("Tunnel connection rejected by relay: %s", data)

        @sio.event
        def disconnect():
            log.info("Tunnel disconnected from relay")

        @sio.on("http_request")
        def on_http_request(data):
            # Handle each forwarded request on its own thread so a slow
            # download doesn't block other concurrent requests from being
            # serviced over the same socket connection.
            if data.get("has_body"):
                self._open_body_queue(data["req_id"])
            threading.Thread(
                target=self._forward_request, args=(data,), daemon=True
            ).start()

        @sio.on("http_request_body_chunk")
        def on_body_chunk(data):
            q = self._get_body_queue(data.get("req_id"))
            if q is not None:
                q.put(data.get("data") or b"")

        @sio.on("http_request_body_end")
        def on_body_end(data):
            q = self._get_body_queue(data.get("req_id"))
            if q is not None:
                q.put(None)  # sentinel: no more body chunks

        @sio.on("agent_settings_changed")
        def on_settings_changed(data):
            # The dashboard can push a public/private toggle live without
            # requiring the Agent to restart. Actual enforcement of who
            # may reach this server still happens on the relay side, but
            # we log it so the operator can see it took effect.
            log.info("Online settings updated from dashboard: %s", data)

    # -- Request body streaming (uploads) --------------------------------

    def _open_body_queue(self, req_id):
        with self._body_queues_lock:
            self._body_queues[req_id] = queue.Queue()

    def _get_body_queue(self, req_id):
        with self._body_queues_lock:
            return self._body_queues.get(req_id)

    def _close_body_queue(self, req_id):
        with self._body_queues_lock:
            self._body_queues.pop(req_id, None)

    def _body_generator(self, req_id):
        """
        Yields byte chunks as they arrive from the relay, without ever
        holding the full upload in memory. `requests` consumes this
        generator directly as the outgoing request body.
        """
        q = self._get_body_queue(req_id)
        while True:
            chunk = q.get()
            if chunk is None:  # http_request_body_end sentinel
                break
            if chunk:
                yield chunk

    # -- Request forwarding ----------------------------------------------

    def _forward_request(self, data):
        req_id = data.get("req_id")
        method = data.get("method", "GET")
        path = data.get("path", "/")
        headers = data.get("headers") or {}
        query = data.get("query") or ""
        has_body = bool(data.get("has_body"))

        url = Config.LOCAL_BASE_URL + path
        if query:
            url += "?" + query

        fwd_headers = {k: v for k, v in headers.items() if k.lower() not in _STRIP_INBOUND}
        body = self._body_generator(req_id) if has_body else None

        try:
            resp = requests.request(
                method,
                url,
                headers=fwd_headers,
                data=body,
                allow_redirects=False,
                stream=True,
                timeout=300,
            )
        except requests.RequestException as exc:
            log.warning("Local request failed for %s %s: %s", method, path, exc)
            self._emit_error(req_id, 502, "Agent could not reach its own local AFDrive server.")
            if has_body:
                self._close_body_queue(req_id)
            return

        try:
            resp_headers = {
                k: v for k, v in resp.headers.items() if k.lower() not in _STRIP_OUTBOUND
            }
            self.sio.emit(
                "http_response_start",
                {"req_id": req_id, "status": resp.status_code, "headers": resp_headers},
            )
            for chunk in resp.iter_content(chunk_size=_CHUNK_SIZE):
                if chunk:
                    self.sio.emit("http_response_chunk", {"req_id": req_id, "data": chunk})
            self.sio.emit("http_response_end", {"req_id": req_id})
        finally:
            resp.close()
            if has_body:
                self._close_body_queue(req_id)

    def _emit_error(self, req_id, status, message):
        self.sio.emit(
            "http_response_start",
            {"req_id": req_id, "status": status, "headers": {"Content-Type": "text/plain"}},
        )
        self.sio.emit("http_response_chunk", {"req_id": req_id, "data": message.encode("utf-8")})
        self.sio.emit("http_response_end", {"req_id": req_id})

    # -- Lifecycle --------------------------------------------------------

    def run_forever(self):
        """
        Blocking call: registers/loads this Agent's identity, then keeps
        the tunnel connected with exponential backoff until stop() is
        called. Intended to be run on a background thread from app.py.
        """
        try:
            device_id, device_secret = identity.ensure_identity()
        except identity.RegistrationError as exc:
            log.error("Cannot start online mode: %s", exc)
            return

        delay = Config.RECONNECT_BASE_DELAY
        while not self._stop.is_set():
            try:
                self.sio.connect(
                    Config.RELAY_URL,
                    auth={
                        "device_id": device_id,
                        "device_secret": device_secret,
                        "public": Config.PUBLIC_DISCOVERABLE,
                        "display_name": Config.SERVER_DISPLAY_NAME,
                    },
                    transports=["websocket"],
                    wait_timeout=15,
                )
                delay = Config.RECONNECT_BASE_DELAY  # reset backoff after a clean connect
                self.sio.wait()  # blocks until disconnected
            except Exception as exc:  # noqa: BLE001 - reconnect loop must never die
                log.warning("Tunnel connection attempt failed: %s", exc)

            if self._stop.is_set():
                break
            jitter = random.uniform(0, 1)
            time.sleep(min(delay, Config.RECONNECT_MAX_DELAY) + jitter)
            delay = min(delay * 2, Config.RECONNECT_MAX_DELAY)

    def stop(self):
        self._stop.set()
        try:
            self.sio.disconnect()
        except Exception:  # noqa: BLE001
            pass


def start_background():
    """Start the tunnel client on a daemon thread if online mode is enabled."""
    if not Config.ONLINE_ENABLED:
        return None
    client = TunnelClient()
    thread = threading.Thread(target=client.run_forever, daemon=True, name="afdrive-tunnel")
    thread.start()
    return client
