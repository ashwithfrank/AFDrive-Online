"""
Filesystem helpers for AFDrive.

Everything that touches the filesystem based on user-supplied input goes
through safe_join_storage() / safe_resolve() so a malicious path can never
escape Config.STORAGE_PATH. This is the single most important module in
the app from a security standpoint — keep all path logic here so it's
reviewed in one place.
"""

import os
import re
import shutil
import unicodedata

from config import Config


class UnsafePathError(Exception):
    """Raised whenever a resolved path would fall outside STORAGE_PATH."""


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------

def _normalize_relative(rel_path):
    """
    Turn a user-supplied relative path (from a URL or form field) into a
    clean, forward-slash relative path with no leading slash, no '..'
    segments, and no null bytes / backslashes.
    """
    if rel_path is None:
        rel_path = ""

    # Reject null bytes outright.
    if "\x00" in rel_path:
        raise UnsafePathError("Null byte in path")

    # Normalize backslashes (Windows-style separators) to forward slashes.
    rel_path = rel_path.replace("\\", "/")

    # Strip leading slashes so os.path.join can't treat it as absolute.
    rel_path = rel_path.lstrip("/")

    parts = []
    for segment in rel_path.split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            raise UnsafePathError("Path traversal segment '..' is not allowed")
        parts.append(segment)

    return "/".join(parts)


def safe_join_storage(rel_path):
    """
    Resolve a user-supplied relative path against Config.STORAGE_PATH and
    guarantee (via realpath containment check) that the result cannot
    escape the storage root — covering symlink tricks as well as '../'.
    Returns an absolute filesystem path. Raises UnsafePathError if unsafe.
    """
    cleaned = _normalize_relative(rel_path)
    candidate = os.path.join(Config.STORAGE_PATH, cleaned)
    resolved = os.path.realpath(candidate)
    storage_root = os.path.realpath(Config.STORAGE_PATH)

    if resolved != storage_root and not resolved.startswith(storage_root + os.sep):
        raise UnsafePathError(f"Resolved path escapes storage root: {rel_path!r}")

    return resolved


def to_rel_path(abs_path):
    """Convert an absolute path back into a storage-relative posix path."""
    storage_root = os.path.realpath(Config.STORAGE_PATH)
    abs_path = os.path.realpath(abs_path)
    rel = os.path.relpath(abs_path, storage_root)
    if rel == ".":
        return ""
    return rel.replace(os.sep, "/")


# ---------------------------------------------------------------------------
# Filenames
# ---------------------------------------------------------------------------

# Characters we refuse to allow in a filename/foldername component, even
# after normalization. This is deliberately conservative.
_UNSAFE_CHARS = re.compile(r'[\/\\\x00-\x1f<>:"|?*]')
_RESERVED_NAMES = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


def sanitize_name(name, fallback="untitled"):
    """
    Sanitize a single file/folder name component (not a path). Strips
    directory separators and control characters, normalizes unicode,
    trims whitespace/dots (Windows/FAT footguns), and falls back to a
    safe default if nothing usable remains.
    """
    if not name:
        return fallback

    name = unicodedata.normalize("NFC", name).strip()
    name = _UNSAFE_CHARS.sub("_", name)
    name = name.strip(" .")

    if not name:
        return fallback

    if name.lower() in _RESERVED_NAMES:
        name = f"_{name}"

    # Keep names to a sane length for old filesystems.
    if len(name) > 200:
        base, ext = os.path.splitext(name)
        name = base[:200 - len(ext)] + ext

    return name


def unique_destination(dir_abs_path, desired_name):
    """
    Given a target directory and a desired filename, return a filename
    that does not already exist in that directory, appending ' (1)',
    ' (2)', etc. before the extension as needed. Never overwrites silently.
    """
    candidate = desired_name
    target = os.path.join(dir_abs_path, candidate)
    if not os.path.exists(target):
        return candidate

    base, ext = os.path.splitext(desired_name)
    counter = 1
    while True:
        candidate = f"{base} ({counter}){ext}"
        target = os.path.join(dir_abs_path, candidate)
        if not os.path.exists(target):
            return candidate
        counter += 1


# ---------------------------------------------------------------------------
# Listing / metadata
# ---------------------------------------------------------------------------

ICON_MAP = {
    "folder": "folder",
    ".pdf": "pdf",
    ".txt": "text", ".md": "text", ".log": "text", ".csv": "text",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
    ".webp": "image", ".svg": "image", ".bmp": "image",
    ".mp3": "audio", ".wav": "audio", ".flac": "audio", ".m4a": "audio", ".ogg": "audio",
    ".mp4": "video", ".mkv": "video", ".mov": "video", ".avi": "video", ".webm": "video",
    ".zip": "archive", ".rar": "archive", ".7z": "archive", ".tar": "archive", ".gz": "archive",
    ".py": "code", ".js": "code", ".html": "code", ".css": "code", ".json": "code",
    ".java": "code", ".c": "code", ".cpp": "code", ".sh": "code", ".xml": "code",
}

PREVIEWABLE_IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
PREVIEWABLE_TEXT = {".txt", ".md", ".log", ".csv", ".json", ".py", ".js", ".html", ".css", ".xml"}
PREVIEWABLE_PDF = {".pdf"}


def get_icon(name, is_dir):
    if is_dir:
        return ICON_MAP["folder"]
    ext = os.path.splitext(name)[1].lower()
    return ICON_MAP.get(ext, "file")


def preview_kind(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in PREVIEWABLE_IMAGE:
        return "image"
    if ext in PREVIEWABLE_PDF:
        return "pdf"
    if ext in PREVIEWABLE_TEXT:
        return "text"
    return None


def human_size(num_bytes):
    """Format a byte count as a human-readable string."""
    if num_bytes is None:
        return "—"
    step = 1024.0
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if num_bytes < step:
            return f"{num_bytes:.0f} {unit}" if unit == "B" else f"{num_bytes:.1f} {unit}"
        num_bytes /= step
    return f"{num_bytes:.1f} PB"


def list_dir(abs_dir):
    """
    Return (folders, files) for a directory, each a list of dicts with
    display metadata. Non-recursive, single os.scandir pass for speed —
    important since this runs on a phone.
    """
    folders, files = [], []
    with os.scandir(abs_dir) as it:
        for entry in it:
            try:
                stat = entry.stat(follow_symlinks=False)
            except OSError:
                continue

            # Skip symlinks entirely — they're a common vector for escaping
            # the storage root and add complexity we don't need for a
            # personal file server.
            if entry.is_symlink():
                continue

            rel = to_rel_path(entry.path)
            if entry.is_dir():
                folders.append({
                    "name": entry.name,
                    "rel_path": rel,
                    "is_dir": True,
                    "icon": get_icon(entry.name, True),
                    "modified": stat.st_mtime,
                    "size": None,
                })
            else:
                files.append({
                    "name": entry.name,
                    "rel_path": rel,
                    "is_dir": False,
                    "icon": get_icon(entry.name, False),
                    "modified": stat.st_mtime,
                    "size": stat.st_size,
                    "preview": preview_kind(entry.name),
                })
    return folders, files


def compute_totals(root_abs):
    """
    Walk the storage tree once to compute total size, file count, and
    folder count. Called for dashboard stats — kept as a single pass and
    only invoked on-demand (dashboard load / after a mutating action),
    never per-listing, to avoid repeatedly scanning the whole tree.
    """
    total_size = 0
    file_count = 0
    folder_count = 0
    for dirpath, dirnames, filenames in os.walk(root_abs, followlinks=False):
        folder_count += len(dirnames)
        for fname in filenames:
            fpath = os.path.join(dirpath, fname)
            try:
                total_size += os.path.getsize(fpath)
                file_count += 1
            except OSError:
                continue
    return {"total_size": total_size, "file_count": file_count, "folder_count": folder_count}


def disk_free_space(path):
    """Available filesystem space at `path`, using the standard library only."""
    usage = shutil.disk_usage(path)
    return {"total": usage.total, "used": usage.used, "free": usage.free}


def search_recursive(root_abs, query, limit=200):
    """Case-insensitive recursive filename search under root_abs."""
    query = query.strip().lower()
    if not query:
        return []

    results = []
    for dirpath, dirnames, filenames in os.walk(root_abs, followlinks=False):
        for dname in dirnames:
            if query in dname.lower():
                full = os.path.join(dirpath, dname)
                results.append({
                    "name": dname,
                    "rel_path": to_rel_path(full),
                    "is_dir": True,
                    "icon": get_icon(dname, True),
                })
                if len(results) >= limit:
                    return results
        for fname in filenames:
            if query in fname.lower():
                full = os.path.join(dirpath, fname)
                try:
                    size = os.path.getsize(full)
                except OSError:
                    size = None
                results.append({
                    "name": fname,
                    "rel_path": to_rel_path(full),
                    "is_dir": False,
                    "icon": get_icon(fname, False),
                    "size": size,
                })
                if len(results) >= limit:
                    return results
    return results
