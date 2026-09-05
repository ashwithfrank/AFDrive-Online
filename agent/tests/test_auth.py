"""
Tests for authentication and route protection.

Run with:  pytest tests/test_auth.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["AFDRIVE_STORAGE_PATH"] = "/tmp/afdrive_pytest_auth_storage"
os.environ["AFDRIVE_DATABASE_PATH"] = "/tmp/afdrive_pytest_auth.db"
os.environ["AFDRIVE_USERNAME"] = "testadmin"
os.environ["AFDRIVE_PASSWORD"] = "testpassword123"

import pytest  # noqa: E402

# Remove any stale test database from a previous run so init_db() seeds fresh.
if os.path.exists(os.environ["AFDRIVE_DATABASE_PATH"]):
    os.remove(os.environ["AFDRIVE_DATABASE_PATH"])

import app as afdrive_app  # noqa: E402


@pytest.fixture()
def client():
    afdrive_app.app.config["TESTING"] = True
    with afdrive_app.app.test_client() as c:
        yield c


def test_dashboard_requires_login_redirects(client):
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_api_requires_login_returns_401(client):
    resp = client.get("/api/stats")
    assert resp.status_code == 401


def test_login_with_wrong_password_fails(client):
    resp = client.post("/login", data={"username": "testadmin", "password": "wrong"})
    assert resp.status_code == 200  # re-renders login page with an error
    assert b"Invalid username or password" in resp.data


def test_login_with_correct_credentials_succeeds(client):
    resp = client.post(
        "/login",
        data={"username": "testadmin", "password": "testpassword123"},
        follow_redirects=False,
    )
    assert resp.status_code == 302

    with client.session_transaction() as sess:
        assert sess.get("username") == "testadmin"


def test_error_message_does_not_reveal_which_field_was_wrong(client):
    resp_bad_user = client.post("/login", data={"username": "nosuchuser", "password": "x"})
    resp_bad_pass = client.post("/login", data={"username": "testadmin", "password": "x"})
    # Both must produce the exact same generic message.
    assert b"Invalid username or password" in resp_bad_user.data
    assert b"Invalid username or password" in resp_bad_pass.data
