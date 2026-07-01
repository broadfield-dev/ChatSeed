// chatseed-files.js — BOOT-TIME CLEAN CACHE: captures clean DOM before chat data populates
// Key improvements:
// - Automatic boot-time capture of clean source (before chat history/messages fill the DOM)
// - window._cleanSourceCache stores the snapshot; load_source serves cached copy
// - Falls back to on-demand captureSource() if boot cache missed
// - No risk of loading chat-populated DOM into the ScratchPad
// - No undo system: version history eliminates the need (every write auto-preserves old versions)
// - Archive mode: files are NEVER deleted, just archived (archived=true)
(function() {
  'use strict';

  var _refs = {};
  function dep(name) { if (!_refs[name]) { _refs[name] = window[name] || null; } return _refs[name]; }

// ===== STATE =====
  window._editTarget = null;    // filename being edited
  window._editContent = null;   // string content being edited
  window._cleanSourceCache = null;    // boot-time snapshot of clean DOM (no chat data populated)

  // ===== HTML ENTITY DECODER =====
  // outerHTML naturally encodes <, >, &, ", ' as &lt;, &gt;, &amp;, &quot;, &#x27;
  // We need to decode these back so the AI model sees REAL source code chars.
  function decodeHTMLEntities(str) {
    var el = document.createElement('textarea');
    // Decode common entities that outerHTML produces
    str = str.replace(/&#x27;/g, "'");
    str = str.replace(/&#39;/g, "'");
    str = str.replace(/&amp;/g, '&');
    str = str.replace(/&lt;/g, '<');
    str = str.replace(/&gt;/g, '>');
    str = str.replace(/&quot;/g, '"');
    str = str.replace(/&apos;/g, "'");
    str = str.replace(/&#(\d+);/g, function(m, code) { return String.fromCharCode(code); });
    // Use the browser's native decoder for any remaining entities
    el.innerHTML = str;
    return el.value;
  }

  // ===== SOURCE CAPTURE — DOM-based =====
  function captureSource() {
    var clone = document.documentElement.cloneNode(true);
    var chatHistory = clone.querySelector('#chatHistory');
    if (chatHistory) { chatHistory.innerHTML = ''; }
    var messages = clone.querySelector('#messages');
    if (messages) { messages.innerHTML = ''; }
    var raw = '<!DOCTYPE html>\n' + clone.outerHTML;
    raw = window.stripBleedingCSS(raw);
    // Decode HTML entities so the source has real chars, not browser-encoded ones
    raw = decodeHTMLEntities(raw);
    return raw;
  }

  window.stripBleedingCSS = function(html) {
    return html.replace(/<style>[^<]*?--tw-border-spacing-x[^<]*?<\/style>\s*/gi, '');
  };

  // ===== UTILITY =====
  window.sourceContentSafe = function(text) {
    if (!text) return text;
    // Only escape triple backticks to prevent breaking out of markdown code blocks.
    // Do NOT HTML-encode (< > & " ') — the content is inside ``` code blocks,
    // so HTML encoding corrupts the data the AI model receives via tool results.
    var safe = text.replace(/\`\`\`/g, '\\`\\`\\`');
    return safe;
  };

  window.codeBlockSafe = function(content, lang) {
    var langAttr = lang ? lang : '';
    var safe = window.sourceContentSafe(content);
    return '```' + langAttr + '\n' + safe + '\n```';
  };

  window.lineNumberedSafe = function(lines, startNum) {
    startNum = startNum || 1;
    var result = [];
    for (var i = 0; i < lines.length; i++) {
      var lineNum = String(startNum + i).padStart(4, ' ');
      var safeLine = window.sourceContentSafe(lines[i]);
      result.push(lineNum + ' | ' + safeLine);
    }
    return result;
  };

  // ===== FILE STATUS CONTEXT =====
  window.fileStatusContext = function() {
    var RS = window.RightSidebar;
    if (!RS) return "";
    var files = RS._getFilesForChat(window.currentChatId);
    var count = files.length;

    if (window._editTarget) {
      var f = window.FileManager.getFileByName(window._editTarget);
      if (f) {
        var lines = f.content.split("\n").length;
        return "📂 **Editing:** `" + window._editTarget + "` (v" + (f.version || 1) + ", " + lines + " lines) | **" + count + " file" + (count !== 1 ? "s" : "") + "** in ScratchPad" +
          " | Use `set_target_file` to switch, `read_file` to view, `write_file` to save a new version.";
      } else {
        window._editTarget = null;
        window._editContent = null;
      }
    }
    if (count > 0)
      return "📂 **Editing:** nothing loaded | **" + count + " file" + (count !== 1 ? "s" : "") + "** in ScratchPad | Use `set_target_file <filename>` to start editing, `list_files` to browse, `load_source` to load the source.";
    return "📂 **Editing:** nothing loaded | **0 files** in ScratchPad | Use `load_source` to load the source, `write_file` to create a file, or upload files.";
  };

  // ===== RIGHT SIDEBAR (ScratchPad file management) =====
  window.RightSidebar = {
    _files: [],
    _order: [],
    _active: null,
    _visible: false,

    _getFilesForChat: function(cid, includeArchived) {
      if (!cid) return [];
      var files = this._files.filter(function(f) { return f.chatId === cid; });
      if (!includeArchived) files = files.filter(function(f) { return !f.archived; });
      return files;
    },
    _getFileCountForChat: function(cid) {
      return this._getFilesForChat(cid).length;
    },
    _getFileById: function(fid) {
      for (var i = 0; i < this._files.length; i++) {
        if (this._files[i].id === fid) return this._files[i];
      }
      return null;
    },
    _getFilesForChatByFilename: function(cid, fn) {
      if (!cid || !fn) return [];
      return this._files.filter(function(f) { return f.chatId === cid && f.filename === fn; });
    },

    uploadFile: function() { document.getElementById("fileInput").click(); },

    addCodeFile: function(code, filename, description) {
      var chatId = window.currentChatId;
      if (!chatId) return null;
      var fileId = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
      var fd = {
        id: fileId, chatId: chatId, filename: filename,
        content: code, type: "text/code", size: code.length,
        description: description || "", addedAt: Date.now(),
        updatedAt: Date.now(), version: 1
      };
      this._files.push(fd);
      this._order.push(fileId);
      this._active = fileId;
      var storageMode = window.storageMode || "localStorage";
      var DB = window.DB;
      if (storageMode === 'localStorage') {
        try {
          var key = "chatpad_files_" + chatId;
          var ex = [];
          try { var s = localStorage.getItem(key); if (s) ex = JSON.parse(s); } catch (ex) {}
          ex.push(fd);
          if (ex.length > 50) ex = ex.slice(-50);
          localStorage.setItem(key, JSON.stringify(ex));
        } catch (ex) {}
      } else if (DB && DB._ready) { DB.saveChatFile(fd); }
      this.show();
      this.render();
      if (window.renderChatHistory) window.renderChatHistory();
      return fileId;
    },

    // Archive mode: files are NEVER deleted, just marked archived
    removeFile: function(fileId) {
      var f = this._getFileById(fileId);
      if (!f) { if (window.showToast) window.showToast("File not found"); return; }
      f.archived = true;
      if (this._active === fileId) {
        var remaining = this._getFilesForChat(window.currentChatId);
        this._active = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      if (window._editTarget === f.filename) { window._editTarget = null; window._editContent = null; }
      this.render();
      if (window.showToast) window.showToast("Archived: " + f.filename + " (still in version history)");
    },

    removeFileByName: function(filename) {
      var chatId = window.currentChatId;
      if (!chatId) return;
      var files = this._getFilesForChat(chatId, true).filter(function(f) { return f.filename === filename; });
      var self = this;
      files.forEach(function(f) {
        f.archived = true;
        if (self._active === f.id) {
          var remaining = self._getFilesForChat(chatId);
          self._active = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        }
      });
      self.render();
    },

    clearAll: function() {
      var files = this._getFilesForChat(window.currentChatId);
      if (files.length === 0) { if (window.showToast) window.showToast("No files in ScratchPad"); return; }
      window._editTarget = null; window._editContent = null;
      var self = this;
      files.forEach(function(f) { f.archived = true; });
      self._active = null;
      self.render();
      if (window.showToast) window.showToast("Archived " + files.length + " files (all in version history)");
    },

    setActive: function(fileId) {
      if (this._getFileById(fileId)) { this._active = fileId; this.render(); }
    },

    toggle: function() {
      if (this._visible) this.hide(); else this.show();
    },
    show: function() {
      this._visible = true;
      var el = document.getElementById("rightSidebar");
      var t = document.getElementById("rightSidebarToggle");
      if (window.innerWidth < 1024) {
        el.classList.remove("collapsed"); el.classList.add("open");
        var backdrop = document.getElementById("rsBackdrop");
        if (backdrop) backdrop.classList.add("show");
      } else { el.classList.remove("collapsed"); }
      if (t) t.classList.add("open");
    },
    hide: function() {
      this._visible = false;
      var el = document.getElementById("rightSidebar");
      var t = document.getElementById("rightSidebarToggle");
      if (window.innerWidth < 1024) {
        el.classList.remove("open"); el.classList.add("collapsed");
        var backdrop = document.getElementById("rsBackdrop");
        if (backdrop) backdrop.classList.remove("show");
      } else { el.classList.add("collapsed"); }
      if (t) t.classList.remove("open");
    },

    downloadFile: function(fid) {
      var f = this._getFileById(fid); if (!f) return;
      var blob = new Blob([f.content], { type: (f.type || "text/plain") + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = f.filename; a.click();
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    },
    copyFile: function(fid) {
      var f = this._getFileById(fid); if (!f) return;
      navigator.clipboard.writeText(f.content).then(function() {
        if (window.showToast) window.showToast("Copied: " + f.filename);
      });
    },

    _versionDropdownOpen: null,
    showVersionDropdown: function(fn, btnEl) {
      var self = this;
      if (self._versionDropdownOpen) {
        var old = document.getElementById(self._versionDropdownOpen);
        if (old) old.style.display = "none";
        self._versionDropdownOpen = null;
      }
      var dropdownId = "ver_dd_" + fn.replace(/[^a-zA-Z0-9]/g, "_");
      var existing = document.getElementById(dropdownId);
      if (existing) {
        existing.style.display = existing.style.display === "block" ? "none" : "block";
        if (existing.style.display === "block") self._versionDropdownOpen = dropdownId;
        else self._versionDropdownOpen = null;
        return;
      }
      var base = fn.replace(/(\.[^.]+)$/, '');
      var ext = fn.indexOf('.') !== -1 ? fn.match(/\.[^.]+$/)[0] : '';
      var versionFilter = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\./g, '\\.') + '\\.v\\d+' + ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
      // Include archived files when listing versions (old versions might be archived)
      var versions = this._getFilesForChat(window.currentChatId, true).filter(function(f) {
        return f.filename === fn || f.filename.match(versionFilter);
      });
      if (versions.length <= 1) { if (window.showToast) window.showToast("Only one version"); return; }
      var dd = document.createElement("div");
      dd.id = dropdownId; dd.className = "rs-version-dropdown show"; dd.style.position = "absolute";
      versions.sort(function(a, b) { return (b.version || 1) - (a.version || 1); });
      for (var i = 0; i < versions.length; i++) {
        (function(v) {
          var item = document.createElement("div");
          item.className = "rs-version-item";
          var fmt = window.formatBytes ? window.formatBytes(v.size) : v.size + " B";
          item.textContent = "v" + (v.version || 1) + " - " + fmt + " - " + (v.description || "");
          item.onclick = function() { self.switchFileToVersion(v.id); };
          dd.appendChild(item);
        })(versions[i]);
      }
      btnEl.style.position = "relative";
      btnEl.appendChild(dd);
      self._versionDropdownOpen = dropdownId;
      setTimeout(function() {
        document.addEventListener("click", function closeHandler(e) {
          if (!dd.contains(e.target) && e.target !== btnEl && !btnEl.contains(e.target)) {
            dd.style.display = "none";
            self._versionDropdownOpen = null;
            document.removeEventListener("click", closeHandler);
          }
        }, { once: true });
      }, 10);
    },
    switchFileToVersion: function(fid) {
      var f = this._getFileById(fid);
      if (!f) { if (window.showToast) window.showToast("File not found"); return; }
      this._active = fid;
      // Unarchive when switching to a version so it becomes visible again
      f.archived = false;
      if (window._editTarget === f.filename) { window._editContent = f.content; }
      this.render();
      if (window.showToast) window.showToast("Switched to " + f.filename + " v" + (f.version || 1));
      if (this._versionDropdownOpen) {
        var old = document.getElementById(this._versionDropdownOpen);
        if (old) old.style.display = "none";
        this._versionDropdownOpen = null;
      }
    },

    loadForChat: function(chatId) {
      var self = this;
      if (!self._loadGen) self._loadGen = {};
      self._loadGen[chatId] = (self._loadGen[chatId] || 0) + 1;
      var gen = self._loadGen[chatId];
      self._files = self._files.filter(function(f) { return f.chatId !== chatId; });
      self._order = self._order.filter(function(id) { return self._files.some(function(f) { return f.id === id; }); });
      if (self._active && !self._getFileById(self._active))
        self._active = self._order.length > 0 ? self._order[self._order.length - 1] : null;
      var storageMode = window.storageMode || "localStorage";
      var DB = window.DB;
      if (storageMode === 'localStorage') {
        try {
          var key = "chatpad_files_" + chatId;
          var s = localStorage.getItem(key);
          if (s) {
            var p = JSON.parse(s);
            p.forEach(function(pf) {
              pf.chatId = chatId;
              if (!pf.id) pf.id = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
              var ex = self._files.some(function(f) { return f.id === pf.id || (f.filename === pf.filename && f.addedAt === pf.addedAt); });
              if (!ex) { self._files.push(pf); if (self._order.indexOf(pf.id) === -1) self._order.push(pf.id); }
            });
          }
        } catch (ex) {}
      }
      if (DB && DB._ready) {
        DB.getChatFiles(chatId).then(function(dbFiles) {
          if (window.currentChatId !== chatId || self._loadGen[chatId] !== gen) return;
          dbFiles.forEach(function(df) {
            if (typeof df.id === "number" || (df.id && String(df.id).match(/^\d+$/))) df.id = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            if (df.version === undefined) df.version = 1;
            var ex = self._files.some(function(f) { return f.id === df.id || (f.filename === df.filename && f.addedAt === df.addedAt); });
            if (!ex) {
              if (!df.id) df.id = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
              df.chatId = chatId; self._files.push(df); if (self._order.indexOf(df.id) === -1) self._order.push(df.id);
            }
          });
          self.render();
        }).catch(function() { if (window.currentChatId === chatId && self._loadGen[chatId] === gen) self.render(); });
      } else { self.render(); }
    },

    render: function() {
      var tabBar = document.getElementById("rsTabBar");
      var body = document.getElementById("rsBody");
      var empty = document.getElementById("rsEmpty");
      var preview = document.getElementById("rsPreview");
      var countLabel = document.getElementById("rsToggleCount");
      if (!tabBar || !body) return;
      var chatFiles = this._getFilesForChat(window.currentChatId);
      var orderIds = this._order.filter(function(id) { return chatFiles.some(function(f) { return f.id === id; }); });
      if (countLabel) {
        var fc = chatFiles.length;
        countLabel.textContent = fc > 0 ? String(fc) : "0";
        var toggleBtn = document.getElementById("rightSidebarToggle");
        if (fc > 0) { countLabel.style.color = "#6ee7b7"; if (toggleBtn) toggleBtn.style.color = "#6ee7b7"; }
        else { countLabel.style.color = "#9ca3af"; if (toggleBtn) toggleBtn.style.color = "#9ca3af"; }
      }
      if (orderIds.length === 0) {
        if (empty) empty.style.display = "flex";
        if (preview) { preview.classList.remove("active"); preview.style.display = "none"; }
        tabBar.innerHTML = ''; return;
      }
      if (empty) empty.style.display = "none";
      var tabHtml = '<span class="rs-add-tab" onclick="window.RightSidebar.uploadFile()" title="Upload file"><i class="fas fa-plus"></i></span>';
      for (var i = 0; i < orderIds.length; i++) {
        var fid = orderIds[i];
        var f = this._getFileById(fid);
        if (!f || f.chatId !== window.currentChatId) continue;
        var isActive = fid === this._active;
        var ext = f.filename.indexOf(".") !== -1 ? f.filename.split(".").pop().toLowerCase() : "";
        var icon = "fa-file";
        if (ext === "html" || ext === "htm") icon = "fa-file-code";
        else if (ext === "js") icon = "fa-file-js";
        else if (ext === "css") icon = "fa-file-css";
        else if (ext === "json") icon = "fa-file-json";
        else if (ext === "md" || ext === "txt") icon = "fa-file-lines";
        else if (ext === "py") icon = "fa-file-python";
        else if (ext === "svg") icon = "fa-file-image";
        var sn = f.filename.length > 22 ? f.filename.substring(0, 19) + "..." : f.filename;
        var escapedFn = f.filename.replace(/"/g, "&quot;");
        var escapedFnAttr = f.filename.replace(/'/g, "\\'");
        tabHtml += '<div class="rs-tab' + (isActive ? ' active' : '') + '" onclick="window.RightSidebar.setActive(\'' + fid + '\')" title="' + escapedFn + '">' +
          '<i class="fas ' + icon + ' rs-tab-icon"></i>' +
          '<span class="rs-tab-name">' + sn + '</span>' +
          '<span class="rs-tab-ver" onclick="event.stopPropagation();window.RightSidebar.showVersionDropdown(\'' + escapedFnAttr + '\',this)" title="Versions">v' + (f.version || 1) + '</span></div>';
      }
      tabBar.innerHTML = tabHtml;
      var activeFile = this._getFileById(this._active);
      if (!activeFile || activeFile.chatId !== window.currentChatId) {
        if (chatFiles.length > 0) { this._active = chatFiles[chatFiles.length - 1].id; activeFile = chatFiles[chatFiles.length - 1]; }
        else { if (preview) preview.style.display = "none"; return; }
      }
      if (preview) { preview.style.display = "flex"; preview.classList.add("active"); }
      var content = activeFile.content || "";
      var lines = content.split("\n");
      var maxLines = Math.min(lines.length, 500);
      var ln = "";
      for (var i = 0; i < maxLines; i++) ln += "<span>" + (i + 1) + "</span>";
      var dc = content.substring(0, 30000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      var cl = dc.split("\n");
      var ch = "";
      for (var i = 0; i < cl.length && i < maxLines; i++) ch += "<span>" + cl[i] + "\n</span>";
      if (lines.length > maxLines) ch += '<span style="color:#4b5563;display:block;padding:4px 0">... ' + (lines.length - maxLines) + ' more lines</span>';
      var fmtSize = window.formatBytes ? window.formatBytes(activeFile.size) : activeFile.size + " B";
      var escapedFn = activeFile.filename.replace(/</g, "&lt;");
      var escapedFnAttr = activeFile.filename.replace(/'/g, "\\'");
      if (preview) {
        preview.innerHTML = '<div class="rs-preview-header">' +
          '<div class="rs-file-info">' +
          '<span style="color:#6ee7b7">' + escapedFn + ' <span class="rs-tab-ver" style="font-size:.55rem;cursor:pointer" onclick="window.RightSidebar.showVersionDropdown(\'' + escapedFnAttr + '\',this)">v' + (activeFile.version || 1) + '</span></span>' +
          '<span class="rs-line-count">' + lines.length + ' lines</span>' +
          '<span style="color:#4b5563">' + fmtSize + '</span></div>' +
          '<div class="rs-actions">' +
          '<button onclick="window.RightSidebar.downloadFile(\'' + activeFile.id + '\')" title="Download"><i class="fas fa-download"></i></button>' +
          '<button onclick="window.RightSidebar.copyFile(\'' + activeFile.id + '\')" title="Copy"><i class="fas fa-copy"></i></button></div></div>' +
          '<div class="rs-preview-body"><pre><span class="rs-line-nums">' + ln + '</span><span class="rs-code-content">' + ch + '</span></pre></div>';
      }
    }
  };

  // ===== FILE MANAGER =====
  window.FileManager = {
    getNextVersion: function(filename) {
      if (!window.currentChatId) return 1;
      var files = window.RightSidebar._getFilesForChat(window.currentChatId);
      var maxVer = 0;
      var base = filename.replace(/(\.[^.]+)$/, '');
      var ext = filename.indexOf('.') !== -1 ? filename.match(/\.[^.]+$/)[0] : '';
      var escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\./g, '\\.');
      var escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (var i = 0; i < files.length; i++) {
        var fn = files[i].filename;
        if (fn === filename) maxVer = Math.max(maxVer, files[i].version || 1);
        var m = fn.match(new RegExp('^' + escapedBase + '\\.v(\\d+)' + escapedExt + '$', 'i'));
        if (m) maxVer = Math.max(maxVer, parseInt(m[1]) || 0);
      }
      return maxVer + 1;
    },
    getFileByName: function(filename) {
      if (!window.currentChatId) return null;
      var files = window.RightSidebar._getFilesForChat(window.currentChatId);
      for (var i = 0; i < files.length; i++) {
        if (files[i].filename.toLowerCase() === filename.toLowerCase()) return files[i];
      }
      return null;
    },
    getAllFilenames: function() {
      if (!window.currentChatId) return [];
      var files = window.RightSidebar._getFilesForChat(window.currentChatId);
      var names = [];
      for (var i = 0; i < files.length; i++) {
        if (names.indexOf(files[i].filename) === -1) names.push(files[i].filename);
      }
      return names;
    },
    readFile: function(filename) {
      var f = this.getFileByName(filename);
      if (!f) return null;
      return f.content;
    },
    writeFile: function(filename, content, description) {
      if (!window.currentChatId) return null;
      var existing = this.getFileByName(filename);
      var nextVer = this.getNextVersion(filename);
      if (existing) {
        var extMatch = filename.match(/(\.[^.]+)$/);
        var ownVer = existing.version || 1;
        var vfn;
        if (extMatch) { vfn = filename.replace(/(\.[^.]+)$/, '.v' + ownVer + '$1'); }
        else { vfn = filename + '.v' + ownVer; }
        existing.filename = vfn;
        existing.description = "v" + ownVer + " (previous version of " + filename + ")";
      }
      var newId = window.RightSidebar.addCodeFile(content, filename, description);
      var newFile = window.RightSidebar._getFileById(newId);
      if (newFile) newFile.version = nextVer;
      var DB = window.DB;
      if (DB && DB._ready) DB.saveFileVersion(filename, content, description || "v" + nextVer);
      return { filename: filename, version: nextVer, isUpdate: !!existing };
    },
    getVersionedBasename: function(filename) {
      return filename.replace(/\.v\d+(?=\.[^.]+$)/, '').replace(/\.v\d+$/, '');
    }
  };

  // ===== LINE EDITOR =====
  window.LineEditor = {
    _getLines: function() {
      if (!window._editContent) return [];
      return window._editContent.split("\n");
    },
    readLines: function(start, end) {
      var lines = this._getLines();
      var total = lines.length;
      var s = (start !== undefined && start !== null) ? Math.max(1, parseInt(start)) : 1;
      var e = (end !== undefined && end !== null) ? Math.min(total, parseInt(end)) : total;
      if (s && !e) e = s;
      return { lines: window.lineNumberedSafe(lines.slice(s-1, e), s), total: total, start: s, end: e };
    },
    edit: function(start, end, contentStr) {
      var lines = this._getLines();
      var total = lines.length;
      var s = Math.max(1, parseInt(start));
      var e = Math.min(total, parseInt(end));
      if (s > e) return null;
      var newContent = (contentStr === undefined || contentStr === null) ? "" : String(contentStr);
      var newLines = newContent.split("\n");
      var result = lines.slice(0, s-1).concat(newLines).concat(lines.slice(e));
      window._editContent = result.join("\n");
      return { oldLength: (e-s+1), newLength: newLines.length, totalBefore: total, totalAfter: result.length, delta: result.length - total, newFirstLine: s, newLastLine: s + newLines.length - 1 };
    },
    insert: function(n, contentStr) {
      var lines = this._getLines();
      var total = lines.length;
      var ln = Math.min(Math.max(1, parseInt(n)), total + 1);
      var newContent = (contentStr === undefined || contentStr === null) ? "" : String(contentStr);
      var newLines = newContent.split("\n");
      var result = lines.slice(0, ln-1).concat(newLines).concat(lines.slice(ln-1));
      window._editContent = result.join("\n");
      return { inserted: newLines.length, totalBefore: total, totalAfter: result.length, insertLine: ln };
    },
    del: function(start, end) {
      var lines = this._getLines();
      var total = lines.length;
      var s = Math.max(1, parseInt(start));
      var e = Math.min(total, parseInt(end));
      if (s > e) return null;
      var result = lines.slice(0, s-1).concat(lines.slice(e));
      window._editContent = result.join("\n");
      return { deleted: (e-s+1), totalBefore: total, totalAfter: result.length, deletedFrom: s, deletedTo: e };
    },
    append: function(contentStr) {
      var lines = this._getLines();
      var total = lines.length;
      var newContent = (contentStr === undefined || contentStr === null) ? "" : String(contentStr);
      window._editContent = lines.concat(newContent.split("\n")).join("\n");
      return { appended: newContent.split("\n").length, totalBefore: total, totalAfter: window._editContent.split("\n").length };
    },
    search: function(pattern, isRegex) {
      var lines = this._getLines();
      var res = [];
      try {
        var re = isRegex ? new RegExp(pattern) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        for (var i = 0; i < lines.length; i++)
          if (re.test(lines[i])) res.push({ line: i + 1, text: lines[i] });
      } catch (ex) { return null; }
      return res;
    }
  };

  // ===== EVOLVE SELF LINE ACTIONS =====
  window.handleEvolveSelfLineAction = function(args) {
    var a = args.action;

// --- load_source: serve the clean cached source (self-contained) ---
    if (a === "load_source") {
      // On-demand capture if boot cache is empty (self-contained, no HTML dependency)
      ensureCleanSource();
      var raw = window._cleanSourceCache || window._CLEAN_SOURCE || document.documentElement.outerHTML;
      var total = raw.split("\n").length;
      var existing = window.FileManager.getFileByName("chatseed.html");
      if (existing) window.RightSidebar.removeFileByName("chatseed.html");
      window.RightSidebar.addCodeFile(raw, "chatseed.html", "Loaded source: " + total + " lines");
      window._editTarget = "chatseed.html";
      window._editContent = raw;
      return "**\uD83D\uDCE5 Source loaded:** \`chatseed.html\` — **" + total + " lines** (loaded your currently running source code from browser memory into ScratchPad).\nNow editing \`chatseed.html\`. Use \`list_files\` to browse, \`read_lines\` to inspect, \`edit_lines\` to make changes.\n\n" + window.fileStatusContext();
    }

    // --- set_target_file ---
    if (a === "set_target_file") {
      var fn = args.target_filename;
      if (!fn) return "Missing target_filename parameter.\n\n" + window.fileStatusContext();
      var content = window.FileManager.readFile(fn);
      if (content === null)
        return "File not found: `" + fn + "`. Use `list_files` to see available files.\n\n" + window.fileStatusContext();
      window._editTarget = fn;
      window._editContent = content;
      return "**Target set:** `" + fn + "` (" + content.split("\n").length + " lines). Line edits will now modify this file.\n\n" + window.fileStatusContext();
    }

    // --- list_files ---
    if (a === "list_files") {
      var names = window.FileManager.getAllFilenames();
      if (names.length === 0)
        return "## File List\n\nNo files in ScratchPad. Use `load_source` to load the source, `write_file` to create a file.\n\n" + window.fileStatusContext();
      var msg = "## File List (" + names.length + " total)\n\n| # | Filename |\n|---|----------|\n";
      for (var i = 0; i < names.length; i++) {
        var marker = "";
        if (names[i] === window._editTarget) marker = " \u2B1C\uFE0F (active target)";
        msg += "| " + (i + 1) + " | `" + names[i] + "`" + marker + " |\n";
      }
      msg += "\nUse `set_target_file <filename>` to start editing, `read_file` to view, `write_file` to save.\n\n" + window.fileStatusContext();
      return msg;
    }

    // --- read_file ---
    if (a === "read_file") {
      var fn = args.target_filename;
      if (!fn) return "Missing target_filename.\n\n" + window.fileStatusContext();
      var content = window.FileManager.readFile(fn);
      if (content === null) return "Not found: `" + fn + "`.\n\n" + window.fileStatusContext();
      var allLines = content.split("\n");
      var total = allLines.length;
      var s = (args.start_line !== undefined && args.start_line !== null) ? Math.max(1, parseInt(args.start_line)) : 1;
      var e = (args.end_line !== undefined && args.end_line !== null) ? Math.min(total, parseInt(args.end_line)) : total;
      if (args.start_line && !args.end_line) e = s;
      var sel = allLines.slice(s - 1, e);
      var safeLines = window.lineNumberedSafe(sel, s);
      var msg = "**\uD83D\uDCC4 `" + fn + "`** — **" + total + " lines** (showing " + s + "-" + e + ")\n\n\`\`\`\n" + safeLines.join("\n") + "\n\`\`\`\n\n";
      return msg + window.fileStatusContext();
    }

    // --- read (show current edit content) ---
    if (a === "read") {
      if (!window._editContent) {
        if (window.FileManager.getAllFilenames().length > 0)
          return "**Nothing loaded.** Use `set_target_file <filename>` to pick a file, or `load_source` to load the source.\n\n" + window.fileStatusContext();
        return "**Nothing loaded.** Use `load_source` to load the source, or `write_file` to create a file.\n\n" + window.fileStatusContext();
      }
      var allLines = window._editContent.split("\n");
      var total = allLines.length;
      var s = (args.start_line !== undefined && args.start_line !== null) ? Math.max(1, parseInt(args.start_line)) : 1;
      var e = (args.end_line !== undefined && args.end_line !== null) ? Math.min(total, parseInt(args.end_line)) : total;
      if (args.start_line && !args.end_line) e = s;
      if (s > e) return "Error: start > end\n\n" + window.fileStatusContext();
      var sel = allLines.slice(s - 1, e);
      var maxShow = Math.min(sel.length, 200);
      var safeLines = window.lineNumberedSafe(sel.slice(0, maxShow), s);
      var label = window._editTarget || "untitled";
      var msg = "**\uD83D\uDCC4 `" + label + "`** — **" + total + " lines** (showing " + s + "-" + Math.min(s + maxShow - 1, e) + ")\n\n\`\`\`\n" + safeLines.join("\n") + "\n\`\`\`\n";
      if (sel.length > maxShow) msg += "\n_(showing " + maxShow + " of " + sel.length + ". Use `read_lines start=N end=M` for a range.)_\n";
      msg += "\n**Lines:** " + total + " | **Chars:** " + window._editContent.length;
      return msg + "\n\n" + window.fileStatusContext();
    }

    // --- diff ---
    if (a === "diff") {
      if (!window._editContent) return "Nothing to diff.\n\n" + window.fileStatusContext();
      var lines = window._editContent.split("\n");
      var total = lines.length;
      var pattern = args.content || args.pattern || "";
      var out = ["## Diff View", "**Source:** " + total + " lines"];
      if (pattern) {
        var ctx = 3, found = false;
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf(pattern) !== -1 || (args.is_regex && new RegExp(pattern, "i").test(lines[i]))) {
            var start = Math.max(0, i - ctx), end = Math.min(lines.length, i + ctx + 1);
            out.push("**Line " + (i+1) + ":**");
            for (var j = start; j < end; j++) out.push((j === i ? "\u2192 " : "  ") + ("" + (j+1)).padStart(4," ") + " | " + window.sourceContentSafe(lines[j]));
            found = true;
          }
        }
        if (!found) out.push("No matches.");
      } else {
        for (var i = 0; i < Math.min(lines.length, 30); i++) out.push(("" + (i+1)).padStart(4," ") + " | " + window.sourceContentSafe(lines[i]));
        if (lines.length > 30) out.push("... (" + (lines.length - 30) + " more)");
      }
      return out.join("\n") + "\n\n" + window.fileStatusContext();
    }

    // --- analyze ---
    if (a === "analyze") {
      if (!window._editContent) return "Nothing to analyze.\n\n" + window.fileStatusContext();
      var lines = window._editContent.split("\n");
      var total = lines.length, chars = window._editContent.length;
      var empty = 0, htm = 0, js = 0, css = 0, comments = 0;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l) empty++;
        else if (l.indexOf("//") === 0 || l.indexOf("/*") === 0 || l.indexOf("*") === 0) comments++;
        else if (l.indexOf("<") !== -1 || l.indexOf(">") !== -1) htm++;
        else if (l.indexOf("function") !== -1 || l.indexOf("var ") === 0 || l.indexOf("let ") === 0 || l.indexOf("const ") === 0 || l.indexOf("if") !== -1 || l.indexOf("}") !== -1 || l.indexOf("{") !== -1) js++;
        else if (l.indexOf("color") !== -1 || l.indexOf("margin") !== -1 || l.indexOf("padding") !== -1 || l.indexOf("display") !== -1 || l.indexOf("flex") !== -1 || l.indexOf("border") !== -1 || l.indexOf("background") !== -1) css++;
      }
      var out = ["## Source Analysis", "**File:** `" + (window._editTarget || "untitled") + "`", "**Lines:** " + total + " | **Chars:** " + chars, "", "**Breakdown:**", "- Empty: " + empty + " (" + Math.round(empty/total*100) + "%)", "- HTML: " + htm, "- JS: " + js, "- CSS: " + css, "- Comments: " + comments];
      if (args.content === "deep") {
        out.push("", "**Functions:**");
        for (var i = 0; i < lines.length; i++) { var m = lines[i].match(/function\s+(\w+)/); if (m) out.push("- `" + m[1] + "()` at line " + (i+1)); }
      }
      return out.join("\n") + "\n\n" + window.fileStatusContext();
    }

    // --- write_file / write ---
    if ((a === "write_file" || a === "write") && (args.new_code || args.content)) {
      var code = args.new_code || args.content;
      var fn = args.target_filename || args.new_filename || "unnamed.txt";
      var desc = args.description || (a === "write" ? "Write" : "Write file");
      var wfResult = window.FileManager.writeFile(fn, code, desc);
      if (fn === window._editTarget) {
        var nf = window.FileManager.getFileByName(fn);
        if (nf) window._editContent = nf.content;
      } else if (!window._editTarget) { window._editTarget = fn; window._editContent = code; }
      var verInfo = wfResult ? " \u2014 v" + wfResult.version + (wfResult.isUpdate ? " (previous version preserved)" : "") + " (in ScratchPad)" : "";
      return "**Written:** \`" + fn + "\`" + verInfo + "\n\n" + window.fileStatusContext();
    }

    // --- read_lines ---
    if (a === "read_lines") {
      if (!window._editContent) return "Nothing loaded.\n\n" + window.fileStatusContext();
      var result = window.LineEditor.readLines(args.start_line, args.end_line);
      return "Lines " + result.start + "-" + result.end + " of " + result.total + "\n\n\`\`\`\n" + result.lines.join("\n") + "\n\`\`\`\n\n" + window.fileStatusContext();
    }

    // --- edit_lines ---
    if (a === "edit_lines") {
      if (!window._editContent) return "Nothing to edit. Use `load_source` or `set_target_file` first.\n\n" + window.fileStatusContext();
      var editContent = args.content || args.new_code;
      if (editContent === undefined || editContent === null) return "Missing content.\n\n" + window.fileStatusContext();
      var sLine = args.start_line !== undefined ? parseInt(args.start_line) : (args.line_number || 1);
      var eLine = args.end_line !== undefined ? parseInt(args.end_line) : sLine;
      if (isNaN(sLine)) sLine = 1;
      if (isNaN(eLine)) eLine = sLine;
      var r = window.LineEditor.edit(sLine, eLine, editContent);
      if (!r) return "Edit failed: start > end\n\n" + window.fileStatusContext();
      var snapFn = args.new_filename || window._editTarget || "unnamed.txt";
      var desc = args.description || "Edited lines " + sLine + "-" + eLine;
      var wfResult = window.FileManager.writeFile(snapFn, window._editContent, desc);
      return "**Edited:** Lines " + sLine + "-" + eLine + " (" + r.oldLength + "\u2192" + r.newLength + ", delta: " + (r.delta > 0 ? "+" : "") + r.delta + ")\n**File:** " + r.totalAfter + " lines. Saved as \`" + snapFn + "\` v" + (wfResult ? wfResult.version : "?") + ".\n\n" + window.fileStatusContext();
    }

    // --- insert_lines ---
    if (a === "insert_lines") {
      if (!window._editContent) return "Nothing to edit.\n\n" + window.fileStatusContext();
      var insertContent = args.content || args.new_code;
      if (!insertContent) return "Missing content.\n\n" + window.fileStatusContext();
      var insertLine = args.line_number !== undefined ? parseInt(args.line_number) : (args.start_line || 1);
      if (isNaN(insertLine)) insertLine = 1;
      var r = window.LineEditor.insert(insertLine, insertContent);
      if (!r) return "Insert failed.\n\n" + window.fileStatusContext();
      var snapFn = args.new_filename || window._editTarget || "unnamed.txt";
      var desc = args.description || "Inserted at line " + insertLine;
      var wfResult = window.FileManager.writeFile(snapFn, window._editContent, desc);
      return "**Inserted:** " + r.inserted + " lines before line " + r.insertLine + " (" + r.totalBefore + "\u2192" + r.totalAfter + ")\nSaved as \`" + snapFn + "\` v" + (wfResult ? wfResult.version : "?") + ".\n\n" + window.fileStatusContext();
    }

    // --- delete_lines ---
    if (a === "delete_lines") {
      if (!window._editContent) return "Nothing to edit.\n\n" + window.fileStatusContext();
      var dStart = args.start_line !== undefined ? parseInt(args.start_line) : 1;
      var dEnd = args.end_line !== undefined ? parseInt(args.end_line) : dStart;
      if (isNaN(dStart)) dStart = 1; if (isNaN(dEnd)) dEnd = dStart;
      var r = window.LineEditor.del(dStart, dEnd);
      if (!r) return "Delete failed: start > end\n\n" + window.fileStatusContext();
      var snapFn = args.new_filename || window._editTarget || "unnamed.txt";
      var desc = args.description || "Deleted lines " + dStart + "-" + dEnd;
      var wfResult = window.FileManager.writeFile(snapFn, window._editContent, desc);
      return "**Deleted:** Lines " + r.deletedFrom + "-" + r.deletedTo + " (" + r.deleted + " lines) (" + r.totalBefore + "\u2192" + r.totalAfter + ")\nSaved as \`" + snapFn + "\` v" + (wfResult ? wfResult.version : "?") + ".\n\n" + window.fileStatusContext();
    }

    // --- append_lines ---
    if (a === "append_lines") {
      if (!window._editContent) return "Nothing to edit.\n\n" + window.fileStatusContext();
      var appendContent = args.content || args.new_code;
      if (!appendContent) return "Missing content.\n\n" + window.fileStatusContext();
      var r = window.LineEditor.append(appendContent);
      if (!r) return "Append failed.\n\n" + window.fileStatusContext();
      var snapFn = args.new_filename || window._editTarget || "unnamed.txt";
      var desc = args.description || "Appended content";
      var wfResult = window.FileManager.writeFile(snapFn, window._editContent, desc);
      return "**Appended:** " + r.appended + " lines (" + r.totalBefore + "\u2192" + r.totalAfter + ")\nSaved as \`" + snapFn + "\` v" + (wfResult ? wfResult.version : "?") + ".\n\n" + window.fileStatusContext();
    }

    // --- search_code ---
    if (a === "search_code") {
      if (!window._editContent) return "Nothing to search.\n\n" + window.fileStatusContext();
      var res = window.LineEditor.search(args.pattern, args.is_regex);
      if (res === null) return "Invalid pattern.\n\n" + window.fileStatusContext();
      if (!res.length) return "No matches.\n\n" + window.fileStatusContext();
      var msg = "**Search for:** \`" + args.pattern + "\`\n\n" + res.length + " match" + (res.length !== 1 ? "es" : "") + ":\n";
      for (var i = 0; i < res.length; i++)
        msg += "\`" + ("" + res[i].line).padStart(4, " ") + "\` | " + window.sourceContentSafe(res[i].text.replace(/\t/g, "  ")) + "\n";
      return msg + "\n" + window.fileStatusContext();
    }

    // --- refactor ---
    if (a === "refactor") {
      if (!window._editContent) return "Nothing to refactor.\n\n" + window.fileStatusContext();
      return "**Refactor:** Editing `" + (window._editTarget || "unnamed") + "` (" + window._editContent.split("\n").length + " lines). Use `edit_lines`, `insert_lines`, etc. then `write_file`.\n\n" + window.fileStatusContext();
    }

    var knownActions = "load_source, set_target_file, list_files, read_file, read, diff, analyze, write, write_file, read_lines, edit_lines, insert_lines, delete_lines, append_lines, search_code, refactor";
    return "Unknown action: `" + (a || "?") + "`. Available: " + knownActions + "\n\n" + window.fileStatusContext();
  };

  // ===== FILE INPUT HANDLER =====
  document.addEventListener("DOMContentLoaded", function() {
    var fi = document.getElementById("fileInput");
    if (!fi) return;
    fi.addEventListener("change", function(e) {
      var files = e.target.files;
      if (!files || files.length === 0) return;
      var chatId = window.currentChatId;
      if (!chatId) { if (window.showToast) window.showToast("No active chat"); return; }
      var self = window.RightSidebar;
      for (var f2 = 0; f2 < files.length; f2++) {
        (function(f) {
          var reader = new FileReader();
          reader.onload = function(ev) {
            var content = ev.target.result;
            var fileId = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            var fd = {
              id: fileId, chatId: chatId, filename: f.name,
              content: content, type: f.type || "application/octet-stream",
              size: content.length, description: "Uploaded: " + f.name,
              addedAt: Date.now(), updatedAt: Date.now(), version: 1
            };
            self._files.push(fd); self._order.push(fileId); self._active = fileId;
            var storageMode = window.storageMode || "localStorage";
            var DB = window.DB;
            if (storageMode === 'localStorage') {
              try {
                var key = "chatpad_files_" + chatId;
                var ex = []; try { var s = localStorage.getItem(key); if (s) ex = JSON.parse(s); } catch (ex) {}
                ex.push(fd); if (ex.length > 50) ex = ex.slice(-50);
                localStorage.setItem(key, JSON.stringify(ex));
              } catch (ex) {}
            } else if (DB && DB._ready) { DB.saveChatFile(fd); }
            self.show(); self.render();
            if (window.renderChatHistory) window.renderChatHistory();
            if (window.showToast) window.showToast("Attached: " + f.name);
          };
          reader.readAsText(f);
        })(files[f2]);
      }
      e.target.value = "";
    });
  });

// On-demand fallback: called by load_source if boot cache is empty.
  function ensureCleanSource() {
    if (!window._cleanSourceCache && !window._CLEAN_SOURCE) {
      try {
        window._cleanSourceCache = captureSource();
        console.log('[chatseed-files] On-demand clean source captured: ' + window._cleanSourceCache.split('\n').length + ' lines');
      } catch(e) {
        console.warn('[chatseed-files] On-demand capture also failed:', e);
      }
    }
  }
// ===== BOOT-TIME CLEAN SOURCE CAPTURE =====
  function bootCapture() {
    try {
      window._cleanSourceCache = captureSource();
      console.log('[chatseed-files] Clean source captured: ' + window._cleanSourceCache.split('\n').length + ' lines');
    } catch(e) {
      console.warn('[chatseed-files] Boot capture failed, will capture on demand:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCapture);
  } else {
    bootCapture();
  }
})();
