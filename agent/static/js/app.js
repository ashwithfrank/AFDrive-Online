/* AFDrive — vanilla JS, no frameworks/build step. */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Theme toggle (persisted in localStorage)
  // ---------------------------------------------------------------------

  function initTheme() {
    const saved = localStorage.getItem("afdrive-theme");
    const theme = saved || "light";
    document.documentElement.setAttribute("data-theme", theme);

    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("afdrive-theme", next);
      });
    }
  }

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------

  function toast(message, type) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast " + (type === "error" ? "toast-error" : "toast-success");
    el.textContent = (type === "error" ? "✕ " : "✓ ") + message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---------------------------------------------------------------------
  // Small fetch helpers
  // ---------------------------------------------------------------------

  async function postJSON(url, data) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    let body = {};
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok || body.ok === false) {
      throw new Error((body && body.error) || `Request failed (${res.status})`);
    }
    return body;
  }

  // ---------------------------------------------------------------------
  // Dashboard-only functionality
  // ---------------------------------------------------------------------

  function loadConfig() {
    const el = document.getElementById("afdrive-config");
    if (!el) return null; // login/error pages don't include this block
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function initDashboard() {
    const cfg = loadConfig();
    if (!cfg) return;

    const fileList = document.getElementById("fileList");
    const currentPath = cfg.currentPath || "";

    // ---- Modals ---------------------------------------------------------

    function showModal(id) { document.getElementById(id).classList.remove("hidden"); }
    function hideModal(id) { document.getElementById(id).classList.add("hidden"); }

    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", () => backdrop.closest(".modal").classList.add("hidden"));
    });
    const previewClose = document.getElementById("previewClose");
    if (previewClose) previewClose.addEventListener("click", () => hideModal("previewModal"));
    const renameClose = document.getElementById("renameClose");
    if (renameClose) renameClose.addEventListener("click", () => hideModal("renameModal"));
    const newFolderClose = document.getElementById("newFolderClose");
    if (newFolderClose) newFolderClose.addEventListener("click", () => hideModal("newFolderModal"));
    const confirmClose = document.getElementById("confirmClose");
    if (confirmClose) confirmClose.addEventListener("click", () => hideModal("confirmModal"));
    const confirmCancel = document.getElementById("confirmCancel");
    if (confirmCancel) confirmCancel.addEventListener("click", () => hideModal("confirmModal"));

    // ---- Refresh stats (used after mutating actions, no full reload) ----

    async function refreshStats() {
      try {
        const res = await fetch(cfg.endpoints.stats);
        const data = await res.json();
        if (!data.ok) return;
        const byId = (id) => document.getElementById(id);
        if (byId("statFiles")) byId("statFiles").textContent = data.files;
        if (byId("statFolders")) byId("statFolders").textContent = data.folders;
        if (byId("statUsed")) byId("statUsed").textContent = data.used_display;
        if (byId("statFree")) byId("statFree").textContent = data.disk_free_display;
      } catch (e) { /* non-fatal */ }
    }

    function reloadListing() {
      window.location.reload();
    }

    // ---- New folder -------------------------------------------------

    const newFolderBtn = document.getElementById("newFolderBtn");
    if (newFolderBtn) {
      newFolderBtn.addEventListener("click", () => {
        const input = document.getElementById("newFolderInput");
        input.value = "";
        showModal("newFolderModal");
        setTimeout(() => input.focus(), 50);
      });
    }

    const newFolderConfirm = document.getElementById("newFolderConfirm");
    if (newFolderConfirm) {
      newFolderConfirm.addEventListener("click", async () => {
        const name = document.getElementById("newFolderInput").value.trim();
        if (!name) return;
        try {
          await postJSON(cfg.endpoints.createFolder, { path: currentPath, name });
          toast("Folder created");
          hideModal("newFolderModal");
          reloadListing();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    }

    // ---- Upload -------------------------------------------------------

    const uploadBtn = document.getElementById("uploadBtn");
    const fileInput = document.getElementById("fileInput");
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) uploadFiles(fileInput.files);
        fileInput.value = "";
      });
    }

    function uploadFiles(fileListObj) {
      const formData = new FormData();
      formData.append("path", currentPath);
      for (const f of fileListObj) formData.append("files", f);

      const progressWrap = document.getElementById("uploadProgress");
      const progressFill = document.getElementById("uploadProgressFill");
      const progressLabel = document.getElementById("uploadProgressLabel");
      progressWrap.classList.remove("hidden");
      progressFill.style.width = "0%";
      progressLabel.textContent = `Uploading ${fileListObj.length} file(s)...`;

      const xhr = new XMLHttpRequest();
      xhr.open("POST", cfg.endpoints.upload);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = pct + "%";
          progressLabel.textContent = `Uploading... ${pct}%`;
        }
      });
      xhr.onload = () => {
        progressWrap.classList.add("hidden");
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
            toast("File uploaded successfully");
            reloadListing();
          } else {
            toast((data && data.error) || "Upload failed", "error");
          }
        } catch (e) {
          toast("Upload failed", "error");
        }
      };
      xhr.onerror = () => {
        progressWrap.classList.add("hidden");
        toast("Upload failed", "error");
      };
      xhr.send(formData);
    }

    // Drag & drop upload onto the file list area.
    if (fileList) {
      ["dragenter", "dragover"].forEach((evt) =>
        fileList.addEventListener(evt, (e) => { e.preventDefault(); })
      );
      fileList.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
      });
    }

    // ---- Row action menus (⋮) ------------------------------------------

    document.querySelectorAll(".action-menu-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = btn.nextElementSibling;
        const wasOpen = !menu.classList.contains("hidden");
        document.querySelectorAll(".action-menu").forEach((m) => m.classList.add("hidden"));
        if (!wasOpen) menu.classList.remove("hidden");
      });
    });
    document.addEventListener("click", () => {
      document.querySelectorAll(".action-menu").forEach((m) => m.classList.add("hidden"));
    });

    let pendingRenamePath = null;
    let pendingDeletePath = null;
    let pendingDeleteIsDir = false;

    document.querySelectorAll(".file-row").forEach((row) => {
      const path = row.dataset.path;
      const name = row.dataset.name;
      const isDir = row.dataset.isDir === "true";

      const openBtn = row.querySelector(".action-open");
      if (openBtn) {
        openBtn.addEventListener("click", () => {
          window.location.href = cfg.endpoints.browseBase + "files/" + encodeURIComponent(path);
        });
      }

      const downloadBtn = row.querySelector(".action-download");
      if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
          window.location.href = cfg.endpoints.download + encodeURI(path);
        });
      }

      const renameBtn = row.querySelector(".action-rename");
      if (renameBtn) {
        renameBtn.addEventListener("click", () => {
          pendingRenamePath = path;
          const input = document.getElementById("renameInput");
          input.value = name;
          showModal("renameModal");
          setTimeout(() => { input.focus(); input.select(); }, 50);
        });
      }

      const deleteBtn = row.querySelector(".action-delete");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
          pendingDeletePath = path;
          pendingDeleteIsDir = isDir;
          document.getElementById("confirmMessage").textContent = isDir
            ? `Delete folder "${name}" and everything inside it? This cannot be undone.`
            : `Delete "${name}"? This cannot be undone.`;
          showModal("confirmModal");
        });
      }

      // Click on a file row opens a preview; folders navigate via the <a> href.
      if (!isDir) {
        const mainLink = row.querySelector('[data-action="preview"]');
        if (mainLink) {
          mainLink.addEventListener("click", (e) => {
            e.preventDefault();
            openPreview(path, name, row.dataset.preview);
          });
        }
      }
    });

    // Recent-file cards also open previews.
    document.querySelectorAll('.recent-card[data-action="preview"]').forEach((card) => {
      card.addEventListener("click", (e) => {
        e.preventDefault();
        openPreview(card.dataset.path, card.dataset.name, null);
      });
    });

    const renameConfirm = document.getElementById("renameConfirm");
    if (renameConfirm) {
      renameConfirm.addEventListener("click", async () => {
        const newName = document.getElementById("renameInput").value.trim();
        if (!newName || !pendingRenamePath) return;
        try {
          await postJSON(cfg.endpoints.rename, { path: pendingRenamePath, new_name: newName });
          toast("File renamed");
          hideModal("renameModal");
          reloadListing();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    }

    const confirmOk = document.getElementById("confirmOk");
    if (confirmOk) {
      confirmOk.addEventListener("click", async () => {
        if (!pendingDeletePath) return;
        try {
          await postJSON(cfg.endpoints.delete, { path: pendingDeletePath });
          toast(pendingDeleteIsDir ? "Folder deleted" : "File deleted");
          hideModal("confirmModal");
          reloadListing();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    }

    // ---- Preview --------------------------------------------------------

    async function openPreview(path, name, kindHint) {
      const title = document.getElementById("previewTitle");
      const body = document.getElementById("previewBody");
      title.textContent = name;
      body.innerHTML = '<p class="muted">Loading preview...</p>';
      showModal("previewModal");

      const ext = (name.split(".").pop() || "").toLowerCase();
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
      const textExts = ["txt", "md", "log", "csv", "json", "py", "js", "html", "css", "xml"];
      const url = cfg.endpoints.preview + encodeURI(path);

      if (imageExts.includes(ext)) {
        body.innerHTML = `<img src="${url}" alt="${escapeHtml(name)}">`;
      } else if (ext === "pdf") {
        body.innerHTML = `<iframe src="${url}" style="width:100%;height:60vh;border:none;"></iframe>`;
      } else if (textExts.includes(ext)) {
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.kind === "text") {
            const suffix = data.truncated ? "\n\n… (truncated)" : "";
            body.innerHTML = `<pre>${escapeHtml(data.content)}${suffix}</pre>`;
          } else {
            body.innerHTML = previewUnavailable(path);
          }
        } catch (e) {
          body.innerHTML = previewUnavailable(path);
        }
      } else {
        body.innerHTML = previewUnavailable(path);
      }
    }

    function previewUnavailable(path) {
      const url = cfg.endpoints.download + encodeURI(path);
      return `<p>File preview unavailable</p><a class="btn btn-primary" href="${url}">Download File</a>`;
    }

    function escapeHtml(str) {
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    // ---- Search -----------------------------------------------------

    const searchInput = document.getElementById("searchInput");
    const searchResults = document.getElementById("searchResults");
    let searchTimer = null;

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        const q = searchInput.value.trim();
        if (!q) {
          searchResults.classList.add("hidden");
          searchResults.innerHTML = "";
          return;
        }
        searchTimer = setTimeout(() => runSearch(q), 250);
      });

      document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
          searchResults.classList.add("hidden");
        }
      });
    }

    async function runSearch(query) {
      try {
        const res = await fetch(cfg.endpoints.search + "?q=" + encodeURIComponent(query));
        const data = await res.json();
        if (!data.ok) return;
        renderSearchResults(data.results);
      } catch (e) { /* non-fatal */ }
    }

    function renderSearchResults(results) {
      if (!results.length) {
        searchResults.innerHTML = '<div class="search-result-item muted">No matches found</div>';
        searchResults.classList.remove("hidden");
        return;
      }
      searchResults.innerHTML = results
        .map((r) => {
          const iconClass = "icon-" + r.icon;
          const meta = r.is_dir ? "Folder" : (r.size_display || "");
          return `<div class="search-result-item" data-path="${escapeAttr(r.rel_path)}" data-is-dir="${r.is_dir}">
            <span class="file-icon ${iconClass}"></span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtmlText(r.name)}</span>
            <span class="muted small">${meta}</span>
          </div>`;
        })
        .join("");
      searchResults.classList.remove("hidden");

      searchResults.querySelectorAll(".search-result-item[data-path]").forEach((item) => {
        item.addEventListener("click", () => {
          const path = item.dataset.path;
          const isDir = item.dataset.isDir === "true";
          if (isDir) {
            window.location.href = cfg.endpoints.browseBase + "files/" + encodeURIComponent(path);
          } else {
            const name = item.querySelector("span:nth-child(2)").textContent;
            openPreview(path, name, null);
          }
        });
      });
    }

    function escapeAttr(str) { return String(str).replace(/"/g, "&quot;"); }
    function escapeHtmlText(str) {
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    // Keep header stats fresh if the tab was left open for a while.
    refreshStats();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initDashboard();
  });
})();
