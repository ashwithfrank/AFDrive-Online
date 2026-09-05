"""
Tests for fs_utils.py — the single most important module from a security
standpoint. These matter even more now that this code is reachable from
the public internet via the tunnel, not just the LAN.

Run with:  pytest tests/test_fs_utils.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

os.environ.setdefault("AFDRIVE_STORAGE_PATH", "/tmp/afdrive_pytest_storage")
os.environ.setdefault("AFDRIVE_DATABASE_PATH", "/tmp/afdrive_pytest.db")

import fs_utils  # noqa: E402
from config import Config  # noqa: E402


def test_safe_join_storage_allows_normal_paths():
    abs_path = fs_utils.safe_join_storage("docs/notes.txt")
    assert abs_path.startswith(os.path.realpath(Config.STORAGE_PATH))


def test_safe_join_storage_blocks_dot_dot():
    with pytest.raises(fs_utils.UnsafePathError):
        fs_utils.safe_join_storage("../../etc/passwd")


def test_safe_join_storage_blocks_absolute_like_segments():
    with pytest.raises(fs_utils.UnsafePathError):
        fs_utils.safe_join_storage("a/../../b")


def test_safe_join_storage_blocks_null_byte():
    with pytest.raises(fs_utils.UnsafePathError):
        fs_utils.safe_join_storage("notes.txt\x00.jpg")


def test_safe_join_storage_normalizes_backslashes():
    # Windows-style separators should not create a bypass.
    with pytest.raises(fs_utils.UnsafePathError):
        fs_utils.safe_join_storage("..\\..\\etc\\passwd")


def test_sanitize_name_strips_dangerous_characters():
    assert fs_utils.sanitize_name("weird<>:name?.txt") == "weird___name_.txt"


def test_sanitize_name_rejects_reserved_windows_names():
    assert fs_utils.sanitize_name("con") == "_con"


def test_unique_destination_avoids_overwrite(tmp_path):
    (tmp_path / "notes.pdf").write_text("x")
    result = fs_utils.unique_destination(str(tmp_path), "notes.pdf")
    assert result == "notes (1).pdf"


def test_symlink_escape_is_not_listed(tmp_path):
    # Simulate a symlink planted inside storage pointing outside it.
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("nope")

    storage = tmp_path / "storage"
    storage.mkdir()
    link = storage / "escape"
    try:
        os.symlink(outside, link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not supported in this environment")

    folders, files = fs_utils.list_dir(str(storage))
    names = [f["name"] for f in folders] + [f["name"] for f in files]
    assert "escape" not in names
