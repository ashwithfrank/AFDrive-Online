"""
AFDrive Agent configuration.

All configurable values are read from environment variables (or a local
.env file, loaded via python-dotenv). Nothing sensitive is hardcoded.

This file keeps every original LAN-mode setting untouched and only adds
the fields needed to optionally connect this Agent to AFDrive Online.
Online mode is entirely opt-in: if AFDRIVE_ONLINE_ENABLED is not set,
none of this is used and the Agent behaves exactly like the original
LAN-only AFDrive.
"""

import os
import secrets

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
os.makedirs(INSTANCE_DIR, exist_ok=True)


def _get_or_create_secret_key():
    """
    Return AFDRIVE_SECRET_KEY from the environment if set. Otherwise,
    generate a random key once and persist it to instance/secret_key.txt
    so Flask sessions survive server restarts even if the operator never
    set a secret key manually.
    """
    env_key = os.environ.get("AFDRIVE_SECRET_KEY")
    if env_key:
        return env_key

    key_file = os.path.join(INSTANCE_DIR, "secret_key.txt")
    if os.path.exists(key_file):
        with open(key_file, "r", encoding="utf-8") as f:
            existing = f.read().strip()
            if existing:
                return existing

    new_key = secrets.token_hex(32)
    fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(new_key)
    return new_key


class Config:
    # -- Original LAN-mode settings (unchanged) -----------------------------
    STORAGE_PATH = os.path.abspath(
        os.environ.get("AFDRIVE_STORAGE_PATH", os.path.join(BASE_DIR, "storage", "user_files"))
    )
    DATABASE_PATH = os.path.abspath(
        os.environ.get("AFDRIVE_DATABASE_PATH", os.path.join(BASE_DIR, "database.db"))
    )
    MAX_UPLOAD_SIZE = int(os.environ.get("AFDRIVE_MAX_UPLOAD_SIZE", 2 * 1024 * 1024 * 1024))
    USERNAME = os.environ.get("AFDRIVE_USERNAME", "admin")
    PASSWORD = os.environ.get("AFDRIVE_PASSWORD", "changeme123")
    SECRET_KEY = _get_or_create_secret_key()
    HOST = os.environ.get("AFDRIVE_HOST", "0.0.0.0")
    PORT = int(os.environ.get("AFDRIVE_PORT", 5000))
    DEBUG = os.environ.get("AFDRIVE_DEBUG", "false").strip().lower() in ("1", "true", "yes")

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("AFDRIVE_FORCE_HTTPS", "false").strip().lower() in ("1", "true", "yes")
    PERMANENT_SESSION_LIFETIME_DAYS = int(os.environ.get("AFDRIVE_SESSION_DAYS", 7))

    # -- Online-mode settings (new, all opt-in) ------------------------------

    # Master switch. When false, tunnel_client is never started and the
    # Agent behaves exactly like the original LAN-only AFDrive.
    ONLINE_ENABLED = os.environ.get("AFDRIVE_ONLINE_ENABLED", "false").strip().lower() in ("1", "true", "yes")

    # Base URL of the AFDrive Online relay, e.g. https://relay.afdrive.example
    RELAY_URL = os.environ.get("AFDRIVE_RELAY_URL", "https://relay.afdrive.example")

    # Human-readable name shown in the public directory / owner dashboard.
    SERVER_DISPLAY_NAME = os.environ.get("AFDRIVE_SERVER_NAME", "My AFDrive")

    # Whether this storage should be listed in the public discovery page.
    # Defaults to private — an operator has to explicitly opt in.
    PUBLIC_DISCOVERABLE = os.environ.get("AFDRIVE_PUBLIC", "false").strip().lower() in ("1", "true", "yes")

    # One-time pairing code, obtained from the Online dashboard, used only
    # to register this Agent for the first time. Not needed on later runs
    # once instance/device_identity.json exists.
    PAIRING_CODE = os.environ.get("AFDRIVE_PAIRING_CODE", "")

    # Where the Agent persists its device identity (device_id + hashed
    # local copy of the secret) once registered. Never commit this file.
    DEVICE_IDENTITY_PATH = os.path.join(INSTANCE_DIR, "device_identity.json")

    # How long to wait between reconnect attempts to the relay (seconds).
    RECONNECT_BASE_DELAY = 2
    RECONNECT_MAX_DELAY = 60

    # Local base URL the tunnel client proxies requests to. Always loopback
    # — the tunnel client never talks to this app over the LAN interface.
    LOCAL_BASE_URL = f"http://127.0.0.1:{PORT}"


os.makedirs(Config.STORAGE_PATH, exist_ok=True)
