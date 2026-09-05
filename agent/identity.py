"""
Agent device identity.

Handles the one-time registration of this Agent with AFDrive Online and
persists the resulting device_id/device_secret locally so the Agent can
reconnect on future runs without needing the pairing code again.

Design notes (see docs/security.md for the full threat model):

* The pairing code is single-use and short-lived. It is created by the
  owner from the Online dashboard and only ever proves "I am the person
  who owns this dashboard account, right now" — it is exchanged for a
  long-lived device_secret exactly once.
* The device_secret is a bearer credential that authenticates the
  *connection*, not a specific request. It is stored only on disk here
  (0o600) and in hashed form on the relay side — never logged, never
  sent anywhere except during the WSS handshake to RELAY_URL.
* Rotation/revocation is handled entirely from the Online dashboard side
  (it just marks the stored hash invalid); the Agent has no special
  "revoke" API of its own beyond forgetting the local file.
"""

import json
import os
import platform
import socket
import uuid

import requests

from config import Config


class RegistrationError(Exception):
    pass


def _machine_hint():
    """A non-sensitive, best-effort label for "what kind of device is this",
    shown in the owner dashboard purely for the human's benefit."""
    try:
        return f"{platform.system()} · {socket.gethostname()}"
    except OSError:
        return platform.system() or "unknown-device"


def load_identity():
    """Return {"device_id": ..., "device_secret": ...} or None if not yet registered."""
    if not os.path.exists(Config.DEVICE_IDENTITY_PATH):
        return None
    try:
        with open(Config.DEVICE_IDENTITY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "device_id" in data and "device_secret" in data:
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return None


def _save_identity(device_id, device_secret):
    fd = os.open(Config.DEVICE_IDENTITY_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"device_id": device_id, "device_secret": device_secret}, f)


def register_with_relay(pairing_code):
    """
    Exchange a one-time pairing code (from the Online dashboard) for a
    permanent device_id + device_secret, and persist them locally.

    This is a plain HTTPS POST, not a socket — registration happens once,
    before the persistent tunnel connection is ever opened.
    """
    if not pairing_code:
        raise RegistrationError("No pairing code provided.")

    url = Config.RELAY_URL.rstrip("/") + "/api/agent/register"
    payload = {
        "pairing_code": pairing_code,
        "display_name": Config.SERVER_DISPLAY_NAME,
        "device_hint": _machine_hint(),
        "client_nonce": uuid.uuid4().hex,
    }

    try:
        resp = requests.post(url, json=payload, timeout=15)
    except requests.RequestException as exc:
        raise RegistrationError(f"Could not reach AFDrive Online: {exc}") from exc

    if resp.status_code != 200:
        try:
            detail = resp.json().get("error", resp.text)
        except ValueError:
            detail = resp.text
        raise RegistrationError(f"Registration rejected: {detail}")

    data = resp.json()
    device_id = data.get("device_id")
    device_secret = data.get("device_secret")
    if not device_id or not device_secret:
        raise RegistrationError("Relay response was missing device credentials.")

    _save_identity(device_id, device_secret)
    return device_id, device_secret


def ensure_identity():
    """
    Return a valid (device_id, device_secret) pair, registering with the
    relay first if this Agent has never been paired before. Raises
    RegistrationError if online mode is requested but no identity exists
    and no pairing code was supplied.
    """
    identity = load_identity()
    if identity:
        return identity["device_id"], identity["device_secret"]

    if not Config.PAIRING_CODE:
        raise RegistrationError(
            "This Agent is not yet registered with AFDrive Online. "
            "Run `python setup_cli.py pair` with a pairing code from your "
            "Online dashboard, or set AFDRIVE_PAIRING_CODE for the first run."
        )

    return register_with_relay(Config.PAIRING_CODE)
