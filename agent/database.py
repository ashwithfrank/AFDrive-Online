"""
AFDrive database layer.

Only account metadata lives in SQLite. Actual uploaded files always stay
on the filesystem under Config.STORAGE_PATH — file/folder listings are
derived live from the filesystem, not mirrored into the database, so the
two can never drift out of sync.
"""

import sqlite3
from contextlib import contextmanager

from werkzeug.security import check_password_hash, generate_password_hash

from config import Config


def _connect():
    conn = sqlite3.connect(Config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create tables on first run and seed the initial account if needed."""
    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        row = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()
        if row["c"] == 0:
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (Config.USERNAME, generate_password_hash(Config.PASSWORD)),
            )


def verify_user(username, password):
    """Return True if username/password match a stored account."""
    if not username or not password:
        return False
    with get_db() as db:
        row = db.execute(
            "SELECT password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
    if row is None:
        # Still run a hash check against a dummy value to avoid leaking
        # via response-time whether the username exists.
        check_password_hash(generate_password_hash("dummy"), password)
        return False
    return check_password_hash(row["password_hash"], password)


def change_password(username, new_password):
    with get_db() as db:
        db.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (generate_password_hash(new_password), username),
        )
