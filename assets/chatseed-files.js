// ===== ChatSeed File Handling Module =====
// Extracted from chatseed.html v15 - handles all ScratchPad file operations,
// versioning, source management, line editing, and the evolve_self tool.

(function() {
  'use strict';

  // Global reference holders (set by the host HTML)
  var _refs = {};
  function dep(name) {
    if (!_refs[name]) {
      _refs[name] = window[name] || null;
    }
    return _refs[name];
  }

  // ===== SHARED STATE =====
  window._currentTargetFile = null;
  window.LIVE_SOURCE = null;
  window.CLEAN_SOURCE_CACHE = null;
  window.evolutionUndoStack = [];
  window.undoLastWriteFlag = false;

  // ===== UTILITY =====
  function sanitizeHTML(str) {
    if (typeof DOMPurify !== "undefined")
      return DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
  function safeRenderHTML(html, allowSafeTags) {
    try {
      if (typeof DOMPurify !== "undefined") {
        if (allowSafeTags)
          return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ["div","span","a","b","i","em","strong","code","pre","br","p","h1","h2","h3","h4","h5","h6","ul","ol","li","blockquote","table","thead","tbody","tr","th","td","hr","img","figure","figcaption","dl","dt","dd","sup","sub","kbd","s","del","ins","mark","small","details","summary","button"],
            ALLOWED_ATTR: ["href","target","rel","src","alt","class","id","title","width","height","style","data-*"],
            ALLOW_DATA_ATTR: true,
            FORBID_TAGS: ["style","script","iframe","object","embed","form","input","textarea","select","option","optgroup","svg","math","link","meta","video","audio","canvas","applet","frame","frameset","noframes","noscript"],
            FORBID_ATTR: ["onerror","onload","onclick","onmouseover","onmouseout","onkeydown","onkeyup","onchange","onsubmit","onfocus","onblur","onabort","onanimationstart","onanimationend","onauxclick","onbeforeinput","onbeforetoggle","oncancel","oncanplay","oncanplaythrough","onclose","oncontextmenu","oncopy","oncuechange","oncut","ondblclick","ondrag","ondragend","ondragenter","ondragleave","ondragover","ondragstart","ondrop","ondurationchange","onemptied","onended","onerror","onformdata","ongotpointercapture","oninput","oninvalid","onlostpointercapture","onpaste","onpause","onplay","onplaying","onpointercancel","onpointerenter","onpointerleave","onpointermove","onpointerout","onpointerover","onpointerrawupdate","onpointerup","onprogress","onratechange","onreset","onresize","onscroll","onsecuritypolicyviolation","onseeked","onseeking","onselect","onselectionchange","onselectstart","onslotchange","onstalled","onsubmit","onsuspend","ontimeupdate","ontoggle","ontransitioncancel","ontransitionend","ontransitionrun","ontransitionstart","onvolumechange","onwaiting","onwebkitanimationend","onwebkitanimationiteration","onwebkitanimationstart","onwebkittransitionend","onwheel","style"],
            ADD_ATTR: ["target"],
            WHOLE_DOCUMENT: false
          });
        return DOMPurify.sanitize(html);
      }
      var d = document.createElement("div");
      d.textContent = html.replace(/<[^>]*>/g, "");
      return d.innerHTML;
    } catch (ex) {
      var d = document.createElement("div");
      d.textContent = html;
      return d.innerHTML;
    }
  }

  // ===== FILE STATUS CONTEXT =====
  window.fileStatusContext = function() {
    var RS = window.RightSidebar;
    if (!RS) return "";
    var files = RS._getFilesForChat(window.currentChatId);
    var count = files.length;
    var activeInfo = "";
    if (window._currentTargetFile) {
      var f = FileManager.getFileByName(window._currentTargetFile);
      if (f) {
        activeInfo = "📂 **Editing:** `" + window._currentTargetFile + "` (v" + (f.version || 1) + ", " + f.content.split("\n").length + " lines) | **" + count + " file" + (count !== 1 ? "s" : "") + "** in ScratchPad";
      } else {
        activeInfo = "⚠️ **Editing:** `" + window._currentTargetFile + "` (no longer in ScratchPad)";
      }
    } else {
      activeInfo = "📂 **Editing:** source buffer (" + window.getCurrentSource().split("\n").length + " lines) | **" + count + " file" + (count !== 1 ? "s" : "") + "** in ScratchPad";
    }
    var fileList = count > 0
      ? " Use `set_target_file` to switch, `read_file` to view, `list_files` to browse, `write_file` to save a new version."
      : " Use `write_file` or upload files to add them.";
    return activeInfo + fileList;
  };

  // ===== SOURCE CAPTURE =====
  function captureCleanSource() {
    var raw = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    raw = raw.replace(/<div id="chatHistory"[^>]*>[\s\S]*?<\/div><\/div><div class="left-sidebar-footer/,
      '<div id="chatHistory" class="flex-1 overflow-auto px-2 space-y-1"></div><div class="left-sidebar-footer');
    raw = raw.replace(/(<div id="messages"[^>]*>)[\s\S]*?(<\/div>)/, '$1$2');
    raw = raw.replace(/<style>[^<]*?--tw-border-spacing-x[^<]*?<\/style>\s*/gi, '');
    window.CLEAN_SOURCE_CACHE = raw;
    window.LIVE_SOURCE = raw;
  }

  window.stripBleedingCSS = function(html) {
    return html.replace(/<style>[^<]*?--tw-border-spacing-x[^<]*?<\/style>\s*/gi, '');
  };
  window.getCurrentSource = function() {
    if (window.LIVE_SOURCE) return window.stripBleedingCSS(window.LIVE_SOURCE);
    if (window.CLEAN_SOURCE_CACHE) return window.stripBleedingCSS(window.CLEAN_SOURCE_CACHE);
    var raw = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    raw = window.stripBleedingCSS(raw);
    window.LIVE_SOURCE = raw;
    window.CLEAN_SOURCE_CACHE = raw;
    return window.LIVE_SOURCE;
  };
  window.updateLiveSource = function(nc) {
    var c = window.stripBleedingCSS(nc);
    window.LIVE_SOURCE = c;
    window.CLEAN_SOURCE_CACHE = c;
  };

  // ===== RIGHT SIDEBAR (ScratchPad file management) =====
  window.RightSidebar = {
    _files: [],
    _order: [],
    _active: null,
    _visible: false,

    _getFilesForChat: function(cid) {
      if (!cid) return [];
      return this._files.filter(function(f) { return f.chatId === cid; });
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

    uploadFile: function() {
      document.getElementById("fileInput").click();
    },

    addCodeFile: function(code, filename, description) {
      var chatId = window.currentChatId;
      if (!chatId) return null;
      var fileId = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
      var fd = {
        id: fileId,
        chatId: chatId,
        filename: filename,
        content: code,
        type: "text/code",
        size: code.length,
        description: description || "",
        addedAt: Date.now(),
        updatedAt: Date.now(),
        version: 1
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
        } catch (ex) {}
      } else if (DB && DB._ready) {
        DB.saveChatFile(fd);
      }
      this.show();
      this.render();
      if (window.renderChatHistory) window.renderChatHistory();
      return fileId;
    },

    removeFile: function(fileId) {
      var idx = -1;
      for (var i = 0; i < this._files.length; i++) {
        if (this._files[i].id === fileId && this._files[i].chatId === window.currentChatId) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return;
      this._files.splice(idx, 1);
      var oidx = this._order.indexOf(fileId);
      if (oidx !== -1) this._order.splice(oidx, 1);
      if (this._active === fileId) {
        this._active = this._order.length > 0 ? this._order[this._order.length - 1] : null;
      }
      var storageMode = window.storageMode || "localStorage";
      var DB = window.DB;
      if (storageMode === 'localStorage') {
        try {
          var key = "chatpad_files_" + window.currentChatId;
          var ex = [];
          try { var s = localStorage.getItem(key); if (s) ex = JSON.parse(s); } catch (ex) {}
          ex = ex.filter(function(f) { return f.id !== fileId; });
          localStorage.setItem(key, JSON.stringify(ex));
        } catch (ex) {}
      }
      if (DB && DB._ready && fileId) DB.deleteFile(fileId);
      this.render();
      if (window.renderChatHistory) window.renderChatHistory();
      if (window.showToast) window.showToast("Removed");
    },

    removeFileByName: function(filename) {
      if (!window.currentChatId) return;
      var files = this._getFilesForChat(window.currentChatId);
      for (var i = files.length - 1; i >= 0; i--) {
        if (files[i].filename === filename) { this.removeFile(files[i].id); return; }
      }
    },

    clearAll: function() {
      var files = this._getFilesForChat(window.currentChatId);
      if (files.length === 0) {
        if (window.showToast) window.showToast("No files to clear");
        return;
      }
      var showConfirm = window.showConfirmDialog;
      if (showConfirm) {
        showConfirm("Remove all files from this chat's scratchpad?", function(confirmed) {
          if (!confirmed) return;
          var ids = [];
          for (var i = 0; i < files.length; i++) ids.push(files[i].id);
          for (var i = 0; i < ids.length; i++) window.RightSidebar.removeFile(ids[i]);
          if (window.showToast) window.showToast("Cleared " + ids.length + " files");
        });
      }
    },

    setActive: function(fileId) {
      if (this._getFileById(fileId)) { this._active = fileId; this.render(); }
    },

    toggle: function() {
      if (this._visible) this.hide();
      else this.show();
    },

    show: function() {
      this._visible = true;
      var el = document.getElementById("rightSidebar");
      var t = document.getElementById("rightSidebarToggle");
      if (window.innerWidth < 1024) {
        el.classList.remove("collapsed");
        el.classList.add("open");
        var backdrop = document.getElementById("rsBackdrop");
        if (backdrop) backdrop.classList.add("show");
      } else {
        el.classList.remove("collapsed");
      }
      if (t) t.classList.add("open");
    },

    hide: function() {
      this._visible = false;
      var el = document.getElementById("rightSidebar");
      var t = document.getElementById("rightSidebarToggle");
      if (window.innerWidth < 1024) {
        el.classList.remove("open");
        el.classList.add("collapsed");
        var backdrop = document.getElementById("rsBackdrop");
        if (backdrop) backdrop.classList.remove("show");
      } else {
        el.classList.add("collapsed");
      }
      if (t) t.classList.remove("open");
    },

    downloadFile: function(fid) {
      var f = this._getFileById(fid);
      if (!f) return;
      var blob = new Blob([f.content], { type: (f.type || "text/plain") + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = f.filename;
      a.click();
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    },

    copyFile: function(fid) {
      var f = this._getFileById(fid);
      if (!f) return;
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
      var versions = this._getFilesForChat(window.currentChatId).filter(function(f) {
        return f.filename === fn || f.filename.match(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\./g, '\\.') + '\\.v\\d+' + ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
      });
      if (versions.length <= 1) {
        if (window.showToast) window.showToast("Only one version of this file");
        return;
      }
      var dd = document.createElement("div");
      dd.id = dropdownId;
      dd.className = "rs-version-dropdown show";
      dd.style.position = "absolute";
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
      self._order = self._order.filter(function(id) {
        return self._files.some(function(f) { return f.id === id; });
      });
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
              if (!ex) {
                self._files.push(pf);
                if (self._order.indexOf(pf.id) === -1) self._order.push(pf.id);
              }
            });
          }
        } catch (ex) {}
      }
      if (DB && DB._ready) {
        DB.getChatFiles(chatId).then(function(dbFiles) {
          if (window.currentChatId !== chatId || self._loadGen[chatId] !== gen) return;
          dbFiles.forEach(function(df) {
            if (typeof df.id === "number" || (df.id && String(df.id).match(/^\d+$/))) {
              df.id = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            }
            if (df.version === undefined) df.version = 1;
            var ex = self._files.some(function(f) { return f.id === df.id || (f.filename === df.filename && f.addedAt === df.addedAt); });
            if (!ex) {
              if (!df.id) df.id = "cp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
              df.chatId = chatId;
              self._files.push(df);
              if (self._order.indexOf(df.id) === -1) self._order.push(df.id);
            }
          });
          self.render();
        }).catch(function() {
          if (window.currentChatId === chatId && self._loadGen[chatId] === gen) self.render();
        });
      } else {
        self.render();
      }
    },

    render: function() {
      var tabBar = document.getElementById("rsTabBar");
      var body = document.getElementById("rsBody");
      var empty = document.getElementById("rsEmpty");
      var preview = document.getElementById("rsPreview");
      var countLabel = document.getElementById("rsToggleCount");
      if (!tabBar || !body) return;
      var chatFiles = this._getFilesForChat(window.currentChatId);
      var orderIds = this._order.filter(function(id) {
        return chatFiles.some(function(f) { return f.id === id; });
      });
      if (countLabel) {
        var fc = chatFiles.length;
        countLabel.textContent = fc > 0 ? String(fc) : "0";
        var toggleBtn = document.getElementById("rightSidebarToggle");
        if (fc > 0) {
          countLabel.style.color = "#6ee7b7";
          if (toggleBtn) toggleBtn.style.color = "#6ee7b7";
        } else {
          countLabel.style.color = "#9ca3af";
          if (toggleBtn) toggleBtn.style.color = "#9ca3af";
        }
      }
      if (orderIds.length === 0) {
        if (empty) empty.style.display = "flex";
        if (preview) preview.classList.remove("active");
        if (preview) preview.style.display = "none";
        tabBar.innerHTML = '';
        return;
      }
      if (empty) empty.style.display = "none";
      // Tabs
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
          '<span class="rs-tab-ver" onclick="event.stopPropagation();window.RightSidebar.showVersionDropdown(\'' + escapedFnAttr + '\',this)" title="Versions">v' + (f.version || 1) + '</span>' +
          '<span class="rs-tab-close" onclick="event.stopPropagation();window.RightSidebar.removeFile(\'' + fid + '\')">✕</span></div>';
      }
      tabBar.innerHTML = tabHtml;
      // Preview
      var activeFile = this._getFileById(this._active);
      if (!activeFile || activeFile.chatId !== window.currentChatId) {
        if (chatFiles.length > 0) {
          this._active = chatFiles[chatFiles.length - 1].id;
          activeFile = chatFiles[chatFiles.length - 1];
        } else {
          if (preview) preview.style.display = "none";
          return;
        }
      }
      if (preview) {
        preview.style.display = "flex";
        preview.classList.add("active");
      }
      var content = activeFile.content || "";
      var lines = content.split("\n");
      var maxLines = Math.min(lines.length, 500);
      var ln = "";
      for (var i = 0; i < maxLines; i++) ln += "<span>" + (i + 1) + "</span>";
      var dc = content.substring(0, 30000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      var cl = dc.split("\n");
      var ch = "";
      for (var i = 0; i < cl.length && i < maxLines; i++) ch += "<span>" + cl[i] + "\n</span>";
      if (lines.length > maxLines)
        ch += '<span style="color:#4b5563;display:block;padding:4px 0">... ' + (lines.length - maxLines) + ' more lines</span>';
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
          '<button onclick="window.RightSidebar.copyFile(\'' + activeFile.id + '\')" title="Copy"><i class="fas fa-copy"></i></button>' +
          '<button class="rs-del" onclick="window.RightSidebar.removeFile(\'' + activeFile.id + '\')" title="Remove"><i class="fas fa-times"></i></button></div></div>' +
          '<div class="rs-preview-body"><pre><span class="rs-line-nums">' + ln + '</span><span class="rs-code-content">' + ch + '</span></pre></div>';
      }
    }
  };

  // ===== FILE MANAGER (versioned writes) =====
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
        if (fn === filename) maxVer = Math.max(maxVer, 1);
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
        var vfn;
        if (extMatch) {
          vfn = filename.replace(/(\.[^.]+)$/, '.v' + nextVer + '$1');
        } else {
          vfn = filename + '.v' + nextVer;
        }
        existing.filename = vfn;
        existing.version = existing.version || 1;
        var oidx = window.RightSidebar._order.indexOf(existing.id);
        if (oidx !== -1) window.RightSidebar._order.splice(oidx, 1);
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

  // ===== UNDO SYSTEM =====
  window.pushUndo = function(fn, sc, desc, isFileWrite) {
    window.evolutionUndoStack.push({
      filename: (window.FileManager.getVersionedBasename ? window.FileManager.getVersionedBasename(fn) : fn),
      code: sc,
      description: desc || "Evolution",
      timestamp: Date.now(),
      isFileWrite: !!isFileWrite
    });
    if (window.evolutionUndoStack.length > 50) window.evolutionUndoStack.shift();
    var b = document.getElementById("undoBtn");
    if (b) { b.style.color = "#6ee7b7"; b.title = "Undo: " + (desc || "Last evolution"); }
  };

  window.undoLastWrite = function() {
    if (window.undoLastWriteFlag) return;
    window.undoLastWriteFlag = true;
    try {
      if (window.evolutionUndoStack.length === 0) {
        var b = document.getElementById("undoBtn");
        if (b) { b.style.color = "#6b7280"; b.title = "Nothing to undo"; }
        return;
      }
      var e = window.evolutionUndoStack.pop();
      if (e.isFileWrite) {
        if (window.currentChatId) {
          window.RightSidebar.removeFileByName(e.filename);
          var files = window.RightSidebar._getFilesForChat(window.currentChatId);
          var extMatch = e.filename.match(/(\.[^.]+)$/);
          var ext = extMatch ? extMatch[0] : '';
          var escapedBase = e.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\./g, '\\.');
          var backupRegex;
          if (ext) {
            backupRegex = new RegExp('^' + escapedBase + '\\.v\\d+' + ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
          } else {
            backupRegex = new RegExp('^' + escapedBase + '\\.v\\d+$');
          }
          var backupFiles = files.filter(function(f) { return f.filename.match(backupRegex); });
          if (backupFiles.length > 0) {
            backupFiles.sort(function(a, b) { return (b.version || 1) - (a.version || 1); });
            var best = backupFiles[0];
            best.filename = e.filename;
            if (window.RightSidebar._order.indexOf(best.id) === -1) window.RightSidebar._order.push(best.id);
            if (window.showToast) window.showToast("Restored backup: " + e.filename);
          }
        }
        var b = document.getElementById("undoBtn");
        if (b) {
          if (window.evolutionUndoStack.length === 0) { b.style.color = "#6b7280"; b.title = "Undo last evolution write"; }
          else { b.title = "Undo: " + window.evolutionUndoStack[window.evolutionUndoStack.length - 1].description; }
        }
        if (window.showToast) window.showToast("Undid: " + e.description);
        window.RightSidebar.render();
        return;
      }
      window.updateLiveSource(e.code);
      var b = document.getElementById("undoBtn");
      if (b) {
        if (window.evolutionUndoStack.length === 0) { b.style.color = "#6b7280"; b.title = "Undo last evolution write"; }
        else { b.title = "Undo: " + window.evolutionUndoStack[window.evolutionUndoStack.length - 1].description; }
      }
      if (window.showToast) window.showToast("Undid: " + e.description);
      window.RightSidebar.render();
    } finally {
      window.undoLastWriteFlag = false;
    }
  };

  // ===== LINE EDITOR =====
  window.LineEditor = {
    _batchBase: [],
    _startBatch: function() {
      if (this._batchBase.length === 0) {
        this._batchBase = window.getCurrentSource().split("\n");
      }
    },
    read: function(s, e, c) {
      var src = window.getCurrentSource();
      var lines = src.split("\n");
      var total = lines.length;
      var start = (s !== undefined && s !== null) ? Math.max(1, parseInt(s)) : 1;
      var end = (e !== undefined && e !== null) ? Math.min(total, parseInt(e)) : total;
      if (start && !end) end = start;
      var sel = lines.slice(start - 1, end);
      var r = [];
      r.push(c ? "Source (" + total + " lines)" : "Lines " + start + "-" + end + " of " + total);
      if (c && start > 1) r.push("  ... (lines 1-" + (start - 1) + " hidden)");
      for (var i = 0; i < sel.length; i++)
        r.push((c ? "" : (start + i).toString().padStart(4, " ") + " | ") + sel[i]);
      if (c && end < total) r.push("  ... (lines " + (end + 1) + "-" + total + " hidden)");
      return r.join("\n");
    },
    edit: function(s, e, c) {
      this._startBatch();
      var lines = this._batchBase.slice();
      var start = Math.max(1, parseInt(s));
      var end = Math.min(lines.length, parseInt(e));
      if (start > end) return null;
      var nc = lines.slice(0, start - 1).concat(c.split("\n")).concat(lines.slice(end)).join("\n");
      window.updateLiveSource(nc);
      return { newCode: nc };
    },
    insert: function(n, c) {
      this._startBatch();
      var lines = this._batchBase.slice();
      var ln = Math.min(Math.max(1, parseInt(n)), lines.length + 1);
      var nc = lines.slice(0, ln - 1).concat(c.split("\n")).concat(lines.slice(ln - 1)).join("\n");
      window.updateLiveSource(nc);
      return { newCode: nc };
    },
    del: function(s, e) {
      this._startBatch();
      var lines = this._batchBase.slice();
      var total = lines.length;
      var start = Math.max(1, parseInt(s));
      var end = Math.min(total, parseInt(e));
      if (start > end) return null;
      var nc = lines.slice(0, start - 1).concat(lines.slice(end)).join("\n");
      window.updateLiveSource(nc);
      return { newCode: nc };
    },
    append: function(c) {
      var lines = window.getCurrentSource().split("\n");
      var nc = lines.concat(c.split("\n")).join("\n");
      window.updateLiveSource(nc);
      return { newCode: nc };
    },
    search: function(p, r) {
      var lines = window.getCurrentSource().split("\n");
      var res = [];
      try {
        var re = r ? new RegExp(p) : new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        for (var i = 0; i < lines.length; i++)
          if (re.test(lines[i])) res.push({ line: i + 1, text: lines[i] });
      } catch (ex) { return null; }
      return res;
    }
  };

  // ===== EVOLVE SELF LINE ACTIONS =====
  window.handleEvolveSelfLineAction = function(args) {
    var a = args.action;

    // --- set_target_file ---
    if (a === "set_target_file") {
      var fn = args.target_filename;
      if (!fn) return "Missing target_filename parameter.\n\n" + window.fileStatusContext();
      var content = window.FileManager.readFile(fn);
      if (content === null)
        return "File not found: `" + fn + "`. Use `list_files` to see available files.\n\n" + window.fileStatusContext();
      if (window._currentTargetFile) {
        var storedContent = window.FileManager.readFile(window._currentTargetFile);
        if (storedContent !== null && storedContent !== window.getCurrentSource()) {
          window.FileManager.writeFile(window._currentTargetFile, window.getCurrentSource(), "Auto-saved before switching to " + fn);
        }
      }
      window.updateLiveSource(content);
      window._currentTargetFile = fn;
      return "**Target set:** `" + fn + "` (" + content.split("\n").length + " lines). Line edits will now modify this file.\n\n" + window.fileStatusContext();
    }

    // --- list_files ---
    if (a === "list_files") {
      var names = window.FileManager.getAllFilenames();
      if (names.length === 0)
        return "## File List\n\nNo files in the current chat. Use `write_file` or upload files to add them.\n\n" + window.fileStatusContext();
      var msg = "## File List (" + names.length + " total)\n\n| # | Filename |\n|---|----------|\n";
      for (var i = 0; i < names.length; i++) {
        var marker = "";
        if (names[i] === window._currentTargetFile) marker = " ⬜️ (active target)";
        msg += "| " + (i + 1) + " | `" + names[i] + "`" + marker + " |\n";
      }
      msg += "\nUse `read_file` to view a file, `write_file` to create a new versioned copy, or `set_target_file` to make it the active target for line edits.\n\n" + window.fileStatusContext();
      return msg;
    }

    // --- read_file ---
    if (a === "read_file") {
      var fn = args.target_filename;
      if (!fn) return "Missing target_filename parameter.\n\n" + window.fileStatusContext();
      var content = window.FileManager.readFile(fn);
      if (content === null)
        return "File not found: `" + fn + "`. Use `list_files` to see available files.\n\n" + window.fileStatusContext();
      var lines = content.split("\n");
      var total = lines.length;
      var inScratchPad = window.RightSidebar._getFilesForChat(window.currentChatId).some(function(f) { return f.filename === fn; });
      if (inScratchPad)
        return "**📄 `" + fn + "`** — **" + total + " lines** (already in ScratchPad panel). Use `read_lines` with `start_line`/`end_line` to inspect specific ranges.\n\n" + window.fileStatusContext();
      window.RightSidebar.addCodeFile(content, fn, "Read: " + fn);
      var preview = lines.slice(0, 10).join("\n");
      return "**📄 Spawned:** `" + fn + "` — **" + total + " lines** (added to ScratchPad). Preview (first 10 lines):\n\n```\n" + preview + (total > 10 ? "\n... (" + (total - 10) + " more lines in panel)" : "") + "\n```\n\n" + window.fileStatusContext();
    }

    // --- read (source) ---
    if (a === "read") {
      var src = window.getCurrentSource();
      var lines = src.split("\n");
      var total = lines.length;
      var desc = args.description || "Read source code";
      var fn = "chatseed.html";
      var existing = window.RightSidebar._getFilesForChat(window.currentChatId).some(function(f) { return f.filename === fn; });
      if (existing) window.RightSidebar.removeFileByName(fn);
      window.RightSidebar.addCodeFile(src, fn, desc);
      return "**📄 Spawned:** `" + fn + "` (" + total + " lines) added to ScratchPad (right sidebar). Use `read_file` → `" + fn + "` to inspect, `read_lines` to target specific ranges, or `set_target_file` → `" + fn + "` to start editing.\n\n" + window.fileStatusContext();
    }

    // --- diff ---
    if (a === "diff") {
      var src = window.getCurrentSource();
      var lines = src.split("\n");
      var total = lines.length;
      var pattern = args.content || args.pattern || "";
      var out = ["## Diff View", "**Source:** " + total + " lines"];
      if (pattern) {
        var ctx = 3;
        var found = false;
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf(pattern) !== -1 || (args.is_regex && new RegExp(pattern, "i").test(lines[i]))) {
            var start = Math.max(0, i - ctx);
            var end = Math.min(lines.length, i + ctx + 1);
            out.push("**Line " + (i + 1) + ":**");
            for (var j = start; j < end; j++) {
              var p = j === i ? "→ " : "  ";
              out.push(p + ("" + (j + 1)).padStart(4, " ") + " | " + lines[j]);
            }
            found = true;
          }
        }
        if (!found) out.push("No matches found.");
      } else {
        for (var i = 0; i < Math.min(lines.length, 30); i++)
          out.push(("" + (i + 1)).padStart(4, " ") + " | " + lines[i]);
        if (lines.length > 30) out.push("... (" + (lines.length - 30) + " more lines)");
      }
      return out.join("\n") + "\n\n" + window.fileStatusContext();
    }

    // --- analyze ---
    if (a === "analyze") {
      var src = window.getCurrentSource();
      var lines = src.split("\n");
      var total = lines.length;
      var chars = src.length;
      var empty = 0, html = 0, js = 0, css = 0, comments = 0;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l) empty++;
        else if (l.indexOf("//") === 0 || l.indexOf("/*") === 0 || l.indexOf("*") === 0) comments++;
        else if (l.indexOf("<") !== -1 || l.indexOf(">") !== -1) html++;
        else if (l.indexOf("function") !== -1 || l.indexOf("var ") === 0 || l.indexOf("let ") === 0 || l.indexOf("const ") === 0 || l.indexOf("if") !== -1 || l.indexOf("}") !== -1 || l.indexOf("{") !== -1) js++;
        else if (l.indexOf("color") !== -1 || l.indexOf("margin") !== -1 || l.indexOf("padding") !== -1 || l.indexOf("display") !== -1 || l.indexOf("flex") !== -1 || l.indexOf("border") !== -1 || l.indexOf("background") !== -1) css++;
      }
      var out = ["## Source Analysis", "**File:** " + (window._currentTargetFile || "current source buffer"), "**Lines:** " + total + " | **Chars:** " + chars, "", "**Breakdown:**", "- Empty: " + empty + " (" + Math.round(empty / total * 100) + "%)", "- HTML: " + html + " lines", "- JS: " + js + " lines", "- CSS: " + css + " lines", "- Comments: " + comments + " lines"];
      if (args.content === "deep") {
        out.push("", "**Functions:**");
        for (var i = 0; i < lines.length; i++) {
          var m = lines[i].match(/function\s+(\w+)/);
          if (m) out.push("- `" + m[1] + "()` at line " + (i + 1));
        }
      }
      return out.join("\n") + "\n\n" + window.fileStatusContext();
    }

    // --- write_file / write / refactor ---
    if ((a === "write_file" || a === "write" || a === "refactor") && (args.new_code || args.content)) {
      var code = args.new_code || args.content;
      var fn = args.target_filename || args.new_filename || "unnamed.txt";
      var desc = args.description || (a === "refactor" ? "Refactor" : a === "write" ? "Write" : "Write file");
      var wfResult = window.FileManager.writeFile(fn, code, desc);
      if (wfResult) window.pushUndo(fn, window.getCurrentSource(), desc, true);
      window.updateLiveSource(code);
      window._currentTargetFile = fn;
      var verInfo = wfResult ? " — v" + wfResult.version + (wfResult.isUpdate ? " (previous version auto-saved as backup)" : "") + " and opened in right sidebar ScratchPad" : "";
      return "**" + (a === "refactor" ? "Refactored" : "Written") + ":** `" + fn + "`" + verInfo + " (now the active target for editing)\n\n" + window.fileStatusContext();
    }

    // --- read_lines ---
    if (a === "read_lines") {
      var linesOut = window.LineEditor.read(args.start_line, args.end_line, true);
      return "```\n" + linesOut + "\n```\n\n" + window.fileStatusContext();
    }

    // --- edit_lines ---
    if (a === "edit_lines") {
      var r = window.LineEditor.edit(args.start_line, args.end_line, args.content);
      var fn = args.new_filename || "chatseed-edited.html";
      window.pushUndo(fn, window.getCurrentSource(), args.description || "Edit", false);
      window.RightSidebar.addCodeFile(r.newCode, fn, args.description || "Edit");
      return "**Edited:** Lines " + args.start_line + "-" + args.end_line + " on " + (window._currentTargetFile || "source") + ".\n\n" + window.fileStatusContext();
    }

    // --- insert_lines ---
    if (a === "insert_lines") {
      var r = window.LineEditor.insert(args.line_number, args.content);
      if (!r) return "Invalid line\n\n" + window.fileStatusContext();
      var fn = args.new_filename || "chatseed-edited.html";
      window.pushUndo(fn, window.getCurrentSource(), args.description || "Insert", false);
      window.RightSidebar.addCodeFile(r.newCode, fn, args.description || "Insert line " + args.line_number);
      return "**Inserted:** Line " + args.line_number + " on " + (window._currentTargetFile || "source") + ".\n\n" + window.fileStatusContext();
    }

    // --- delete_lines ---
    if (a === "delete_lines") {
      var r = window.LineEditor.del(args.start_line, args.end_line);
      if (!r) return "Invalid range\n\n" + window.fileStatusContext();
      var fn = args.new_filename || "chatseed-edited.html";
      window.pushUndo(fn, window.getCurrentSource(), args.description || "Delete", false);
      window.RightSidebar.addCodeFile(r.newCode, fn, args.description || "Deleted lines " + args.start_line + "-" + args.end_line);
      return "**Deleted:** Lines " + args.start_line + "-" + args.end_line + " on " + (window._currentTargetFile || "source") + ".\n\n" + window.fileStatusContext();
    }

    // --- append_lines ---
    if (a === "append_lines") {
      var r = window.LineEditor.append(args.content);
      var fn = args.new_filename || "chatseed-edited.html";
      window.pushUndo(fn, window.getCurrentSource(), args.description || "Append", false);
      window.RightSidebar.addCodeFile(r.newCode, fn, args.description || "Appended content");
      return "**Appended:** Content added to " + (window._currentTargetFile || "source") + ".\n\n" + window.fileStatusContext();
    }

    // --- search_code ---
    if (a === "search_code") {
      var res = window.LineEditor.search(args.pattern, args.is_regex);
      if (res === null) return "Invalid pattern\n\n" + window.fileStatusContext();
      if (!res.length) return "No matches\n\n" + window.fileStatusContext();
      var msg = "**Search results for:** `" + args.pattern + "`\n\nFound " + res.length + " match" + (res.length !== 1 ? "es" : "") + ":\n";
      for (var i = 0; i < res.length; i++)
        msg += "`" + ("" + res[i].line).padStart(4, " ") + "` | " + res[i].text.replace(/\t/g, "  ") + "\n";
      return msg + "\n" + window.fileStatusContext();
    }

    // --- write_source ---
    if (a === "write_source" && (args.new_code || args.content)) {
      var code = args.new_code || args.content;
      if (code.length < 100)
        return "**Rejected:** write_source content too short (" + code.length + " chars, minimum 100). Use write_file for small snippets.\n\n" + window.fileStatusContext();
      var fn = args.new_filename || "chatseed-source.html";
      window.pushUndo(fn, window.getCurrentSource(), args.description || "Write source", false);
      window.RightSidebar.addCodeFile(code, fn, args.description || "Write source");
      window.updateLiveSource(code);
      window._currentTargetFile = null;
      return "**Source Updated:** `" + fn + "`\n\n" + window.fileStatusContext();
    }

    return "Unknown action: " + (a || "?") + "\n\n" + window.fileStatusContext();
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
      for (var fi2 = 0; fi2 < files.length; fi2++) {
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
            self._files.push(fd);
            self._order.push(fileId);
            self._active = fileId;
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
            } else if (DB && DB._ready) {
              DB.saveChatFile(fd);
            }
            self.show();
            self.render();
            if (window.renderChatHistory) window.renderChatHistory();
            if (window.showToast) window.showToast("Attached: " + f.name);
          };
          reader.readAsText(f);
        })(files[fi2]);
      }
      e.target.value = "";
    });
  });

  // ===== CAPTURE SOURCE AFTER DOM READY =====
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", captureCleanSource);
  } else {
    captureCleanSource();
  }

})();