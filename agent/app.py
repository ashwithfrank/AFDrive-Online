"""
AFDrive Agent — Your Personal Cloud. Your Device. Your Files.

This is the same AFDrive Flask app as the original LAN-only project:
same routes, same auth, same fs_utils path safety, same templates. The
only addition is that, when AFDRIVE_ONLINE_ENABLED=true, it also opens
an outbound tunnel to AFDrive Online (tunnel_client.py) so a separate,
public web app can reach these exact routes for authorized remote users
— without this process ever listening for inbound internet traffic.

Run with:  python app.py
"""

import datetime
import functools
import mimetypes
import os

from flask import (
    Flask, abort, jsonify, redirect, render_template, request,
    send_file, session, url_for,
)
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

import database
import fs_utils
import tunnel_client
from config import Config

app = Flask(__name__)
app.config["SECRET_KEY"] = Config.SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = Config.MAX_UPLOAD_SIZE
app.config["SESSION_COOKIE_HTTPONLY"] = Config.SESSION_COOKIE_HTTPONLY
app.config["SESSION_COOKIE_SAMESITE"] = Config.SESSION_COOKIE_SAMESITE
app.config["SESSION_COOKIE_SECURE"] = Config.SESSION_COOKIE_SECURE
app.config["PERMANENT_SESSION_LIFETIME"] = datetime.timedelta(
    days=Config.PERMANENT_SESSION_LIFETIME_DAYS
)

database.init_db()


@app.template_filter("timestamp_to_date")
def timestamp_to_date(ts):
    try:
        return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
    except (OSError, OverflowError, ValueError):
        return "—"


# ---------------------------------------------------------------------------
# Security headers (applied to every response)
# ---------------------------------------------------------------------------

@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; "
        "media-src 'self' blob:; object-src 'self'; "
        "style-src 'self' 'unsafe-inline'; script-src 'self'"
    )
    return response


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("username"):
            if request.path.startswith("/api/"):
                abort(401)
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("username"):
        return redirect(url_for("dashboard"))

    error = None
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if database.verify_user(username, password):
            session.clear()
            session["username"] = username
            session.permanent = True
            next_url = request.args.get("next") or url_for("dashboard")
            if not next_url.startswith("/"):
                next_url = url_for("dashboard")
            return redirect(next_url)

        error = "Invalid username or password."

    return render_template("login.html", error=error, app_name="AFDrive")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# Dashboard / file browser
# ---------------------------------------------------------------------------

def _breadcrumbs(rel_path):
    if not rel_path:
        return []
    parts = rel_path.split("/")
    crumbs = []
    accum = []
    for part in parts:
        accum.append(part)
        crumbs.append({"name": part, "rel_path": "/".join(accum)})
    return crumbs


@app.route("/")
@app.route("/dashboard")
@app.route("/files/")
@app.route("/files/<path:subpath>")
@login_required
def dashboard(subpath=""):
    try:
        abs_dir = fs_utils.safe_join_storage(subpath)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.isdir(abs_dir):
        abort(404)

    folders, files = fs_utils.list_dir(abs_dir)

    sort_key = request.args.get("sort", "name")
    reverse = request.args.get("order", "asc") == "desc"
    sort_fns = {
        "name": lambda e: e["name"].lower(),
        "size": lambda e: e.get("size") or 0,
        "date": lambda e: e["modified"],
    }
    sort_fn = sort_fns.get(sort_key, sort_fns["name"])
    folders.sort(key=sort_fn, reverse=reverse)
    files.sort(key=sort_fn, reverse=reverse)

    rel_path = fs_utils.to_rel_path(abs_dir)
    totals = fs_utils.compute_totals(Config.STORAGE_PATH)
    disk = fs_utils.disk_free_space(Config.STORAGE_PATH)

    recent_files = []
    if rel_path == "":
        all_entries = []
        for dirpath, _dirnames, filenames in os.walk(Config.STORAGE_PATH, followlinks=False):
            for fname in filenames:
                full = os.path.join(dirpath, fname)
                try:
                    stat = os.stat(full)
                except OSError:
                    continue
                all_entries.append({
                    "name": fname,
                    "rel_path": fs_utils.to_rel_path(full),
                    "modified": stat.st_mtime,
                    "size": stat.st_size,
                    "icon": fs_utils.get_icon(fname, False),
                })
        all_entries.sort(key=lambda e: e["modified"], reverse=True)
        recent_files = all_entries[:8]

    return render_template(
        "dashboard.html",
        app_name="AFDrive",
        username=session.get("username"),
        rel_path=rel_path,
        breadcrumbs=_breadcrumbs(rel_path),
        folders=folders,
        files=files,
        recent_files=recent_files,
        totals=totals,
        disk=disk,
        sort_key=sort_key,
        order="desc" if reverse else "asc",
        human_size=fs_utils.human_size,
    )


# ---------------------------------------------------------------------------
# API: folder creation
# ---------------------------------------------------------------------------

@app.route("/api/folder/create", methods=["POST"])
@login_required
def api_create_folder():
    data = request.get_json(silent=True) or request.form
    parent = data.get("path", "")
    name = data.get("name", "")

    try:
        parent_abs = fs_utils.safe_join_storage(parent)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.isdir(parent_abs):
        abort(404)

    clean_name = fs_utils.sanitize_name(name, fallback="New Folder")
    final_name = fs_utils.unique_destination(parent_abs, clean_name)

    try:
        os.makedirs(os.path.join(parent_abs, final_name), exist_ok=False)
    except OSError:
        return jsonify({"ok": False, "error": "Could not create folder."}), 400

    return jsonify({"ok": True, "name": final_name})


# ---------------------------------------------------------------------------
# API: upload
# ---------------------------------------------------------------------------

@app.route("/api/upload", methods=["POST"])
@login_required
def api_upload():
    target = request.form.get("path", "")
    try:
        target_abs = fs_utils.safe_join_storage(target)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.isdir(target_abs):
        abort(404)

    uploaded = request.files.getlist("files")
    saved, failed = [], []

    for f in uploaded:
        if not f or not f.filename:
            continue
        safe = fs_utils.sanitize_name(secure_filename(f.filename), fallback="file")
        final_name = fs_utils.unique_destination(target_abs, safe)
        dest_path = os.path.join(target_abs, final_name)

        try:
            f.save(dest_path)
            os.chmod(dest_path, 0o644)
            saved.append(final_name)
        except OSError:
            failed.append(f.filename)

    return jsonify({"ok": len(failed) == 0, "saved": saved, "failed": failed})


# ---------------------------------------------------------------------------
# API: download (streamed, not loaded fully into RAM)
# ---------------------------------------------------------------------------

@app.route("/api/download/<path:filepath>")
@login_required
def api_download(filepath):
    try:
        abs_path = fs_utils.safe_join_storage(filepath)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.isfile(abs_path):
        abort(404)

    mime, _ = mimetypes.guess_type(abs_path)
    return send_file(
        abs_path,
        mimetype=mime or "application/octet-stream",
        as_attachment=True,
        download_name=os.path.basename(abs_path),
        conditional=True,
        max_age=0,
    )


# ---------------------------------------------------------------------------
# API: preview (inline, not forced download)
# ---------------------------------------------------------------------------

@app.route("/api/preview/<path:filepath>")
@login_required
def api_preview(filepath):
    try:
        abs_path = fs_utils.safe_join_storage(filepath)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.isfile(abs_path):
        abort(404)

    kind = fs_utils.preview_kind(os.path.basename(abs_path))
    if kind is None:
        abort(404)

    if kind == "text":
        max_bytes = 512 * 1024
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read(max_bytes + 1)
        except OSError:
            abort(404)
        truncated = len(content) > max_bytes
        content = content[:max_bytes]
        return jsonify({"kind": "text", "content": content, "truncated": truncated})

    mime, _ = mimetypes.guess_type(abs_path)
    return send_file(
        abs_path,
        mimetype=mime or "application/octet-stream",
        as_attachment=False,
        conditional=True,
        max_age=0,
    )


# ---------------------------------------------------------------------------
# API: rename
# ---------------------------------------------------------------------------

@app.route("/api/rename", methods=["POST"])
@login_required
def api_rename():
    data = request.get_json(silent=True) or request.form
    rel_path = data.get("path", "")
    new_name = data.get("new_name", "")

    try:
        abs_path = fs_utils.safe_join_storage(rel_path)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.exists(abs_path):
        abort(404)

    parent_abs = os.path.dirname(abs_path)
    is_dir = os.path.isdir(abs_path)

    clean_name = fs_utils.sanitize_name(new_name, fallback=os.path.basename(abs_path))
    if not is_dir:
        old_ext = os.path.splitext(abs_path)[1]
        new_ext = os.path.splitext(clean_name)[1]
        if old_ext and not new_ext:
            clean_name += old_ext

    final_name = fs_utils.unique_destination(parent_abs, clean_name)
    new_abs = os.path.join(parent_abs, final_name)

    try:
        os.rename(abs_path, new_abs)
    except OSError:
        return jsonify({"ok": False, "error": "Rename failed."}), 400

    return jsonify({"ok": True, "name": final_name})


# ---------------------------------------------------------------------------
# API: delete
# ---------------------------------------------------------------------------

@app.route("/api/delete", methods=["POST"])
@login_required
def api_delete():
    data = request.get_json(silent=True) or request.form
    rel_path = data.get("path", "")

    if rel_path == "":
        abort(400)

    try:
        abs_path = fs_utils.safe_join_storage(rel_path)
    except fs_utils.UnsafePathError:
        abort(403)

    if not os.path.exists(abs_path):
        abort(404)

    try:
        if os.path.isdir(abs_path):
            import shutil as _shutil
            _shutil.rmtree(abs_path)
        else:
            os.remove(abs_path)
    except OSError:
        return jsonify({"ok": False, "error": "Delete failed."}), 400

    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# API: search
# ---------------------------------------------------------------------------

@app.route("/api/search")
@login_required
def api_search():
    query = request.args.get("q", "")
    results = fs_utils.search_recursive(Config.STORAGE_PATH, query)
    for r in results:
        if not r["is_dir"]:
            r["size_display"] = fs_utils.human_size(r.get("size"))
    return jsonify({"ok": True, "query": query, "results": results})


# ---------------------------------------------------------------------------
# API: live stats
# ---------------------------------------------------------------------------

@app.route("/api/stats")
@login_required
def api_stats():
    totals = fs_utils.compute_totals(Config.STORAGE_PATH)
    disk = fs_utils.disk_free_space(Config.STORAGE_PATH)
    return jsonify({
        "ok": True,
        "files": totals["file_count"],
        "folders": totals["folder_count"],
        "used_bytes": totals["total_size"],
        "used_display": fs_utils.human_size(totals["total_size"]),
        "disk_total_display": fs_utils.human_size(disk["total"]),
        "disk_free_display": fs_utils.human_size(disk["free"]),
    })


# ---------------------------------------------------------------------------
# API: online status (used by the Agent's own status view, and safe to
# poll locally — never exposes secrets, just whether the tunnel is up)
# ---------------------------------------------------------------------------

@app.route("/api/online-status")
@login_required
def api_online_status():
    return jsonify({
        "ok": True,
        "online_enabled": Config.ONLINE_ENABLED,
        "public": Config.PUBLIC_DISCOVERABLE,
        "server_name": Config.SERVER_DISPLAY_NAME,
        "relay_url": Config.RELAY_URL if Config.ONLINE_ENABLED else None,
    })


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(500)
def handle_error(err):
    code = err.code if isinstance(err, HTTPException) else 500
    messages = {
        400: "Bad request.",
        401: "Please log in to continue.",
        403: "You don't have permission to access that.",
        404: "That file or folder doesn't exist.",
        413: "That file is too large to upload.",
        500: "Something went wrong on the server.",
    }
    message = messages.get(code, "Something went wrong.")

    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": message}), code

    if code == 401:
        return redirect(url_for("login"))

    return render_template("error.html", code=code, message=message, app_name="AFDrive"), code


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # If online mode is enabled, open the outbound tunnel on a background
    # thread before serving. This never opens an inbound port — the Agent
    # still only listens on Config.HOST:Config.PORT for LAN traffic exactly
    # as before; remote traffic reaches it only via the outbound tunnel.
    tunnel_client.start_background()

    app.run(host=Config.HOST, port=Config.PORT, debug=Config.DEBUG)
