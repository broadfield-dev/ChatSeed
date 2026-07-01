/**
 * ════════════════════════════════════════════════════════════════════════
 *  ChatSeed FS Bridge Module — Browser File System Integration
 * ════════════════════════════════════════════════════════════════════════
 *
 * Connects to a local FS Bridge server to read/write files, browse
 * directories, and manage project files from within the chat.
 *
 * SECURITY:
 *   🔑 API key is stored in YOUR browser's localStorage
 *   🤖 AI cannot read localStorage, cannot extract the key
 *   📂 Root directory is hard-set on the server — AI cannot change it
 */

(function() {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────────
  const BRIDGE_PORT = 8742;
  const STORAGE_KEY = 'chatseed_fs_bridge_key';
  const BRIDGE_BASE = 'http://127.0.0.1:' + BRIDGE_PORT;

  // ─── Helper functions ───────────────────────────────────────────────

  function formatSize(bytes) {
    if (bytes === undefined || bytes === null) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function bridgeUrl(path) {
    return BRIDGE_BASE + path;
  }

  function maskKey(k) {
    if (k.length > 6) {
      return k.substring(0, 4) + '...' + k.substring(k.length - 3);
    }
    return k.substring(0, 3) + '...';
  }

  // ─── Key Management (browser-only, no AI access) ────────────────────
  const keyManager = {
    get: function() {
      try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
    },
    set: function(k) {
      try { localStorage.setItem(STORAGE_KEY, k); } catch (e) { /* noop */ }
    },
    clear: function() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
    },
    has: function() { return !!this.get(); }
  };

  // ─── API Client (auto-attaches key) ─────────────────────────────────
  async function bridgeCall(endpoint, params) {
    if (params === undefined) { params = {}; }
    var key = keyManager.get();
    var queryParts = [];
    var allParams = {};
    // Copy params
    for (var pk in params) {
      if (params.hasOwnProperty(pk)) {
        allParams[pk] = params[pk];
      }
    }
    if (key) {
      allParams.key = key;
    }
    for (var pk2 in allParams) {
      if (allParams.hasOwnProperty(pk2)) {
        var v = allParams[pk2];
        if (v !== undefined && v !== null && v !== '') {
          queryParts.push(encodeURIComponent(pk2) + '=' + encodeURIComponent(String(v)));
        }
      }
    }
    var url = BRIDGE_BASE + endpoint;
    if (queryParts.length > 0) {
      url = url + '?' + queryParts.join('&');
    }
    try {
      var resp = await fetch(url);
      var data = await resp.json();
      if (resp.status === 401 && data && data.error === 'invalid_key') {
        console.warn('[FS Bridge] Key rejected by server.');
        return { success: false, error: 'Invalid API key. Use fs_bridge_set_key to re-enter.' };
      }
      return data;
    } catch (err) {
      var msg = (err && err.message) ? err.message : 'Connection refused or network error';
      return { success: false, error: 'Connection failed: ' + msg + '. Is the bridge running on port ' + BRIDGE_PORT + '?' };
    }
  }

  // ─── Tool Implementations ──────────────────────────────────────────
  var tools = {};

  // ── Status & Key Management ──────────────────────────────────────

  tools.fs_bridge_status = {
    description: 'Check whether the FS Bridge server is running and connected. Returns status, API key presence, bridge URL, and dashboard link.',
    parameters: { type: 'object', properties: {} },
    handler: async function() {
      var result = await bridgeCall('/api/status');
      var hasKey = keyManager.has();
      var lines = [
        '**FS Bridge Status**',
        '',
        '**Bridge URL:** ' + BRIDGE_BASE,
        '**Dashboard:** ' + bridgeUrl('/ui/'),
        '**API Key:** ' + (hasKey ? 'Stored' : 'Not set'),
        '**Connected:** ' + (result.success ? 'Yes' : 'No')
      ];
      if (result.success) {
        if (result.root) lines.push('**Root Directory:** `' + result.root + '`');
        if (result.version) lines.push('**Version:** ' + result.version);
      } else {
        lines.push('');
        lines.push('Make sure the FS Bridge server is running on port ' + BRIDGE_PORT + '.');
        lines.push('Start it with: `python chatseed_fs_bridge.py --api-key "your-key"`');
      }
      return lines.join('\n');
    }
  };

  tools.fs_bridge_set_key = {
    description: 'Store your FS Bridge API key in localStorage. Get the key from the FS Bridge dashboard at http://127.0.0.1:8742/ui/',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The FS Bridge API key to store' }
      },
      required: ['key']
    },
    handler: async function(args) {
      var k = (args.key || '').trim();
      if (!k) return 'Please provide a non-empty API key.';
      keyManager.set(k);
      var result = await bridgeCall('/api/status');
      var masked = maskKey(k);
      if (result.success) {
        return 'FS Bridge key stored: ' + masked + '\nBridge is connected. Root: `' + (result.root || 'unknown') + '`';
      } else {
        return 'Key stored (' + masked + '), but bridge verification failed: ' + result.error + '\nCheck the key and try again.';
      }
    }
  };

  tools.fs_bridge_clear_key = {
    description: 'Clear the stored FS Bridge API key from localStorage.',
    parameters: { type: 'object', properties: {} },
    handler: async function() {
      var hadKey = keyManager.has();
      keyManager.clear();
      if (hadKey) {
        return 'FS Bridge API key cleared from localStorage.';
      } else {
        return 'No key was stored. Nothing to clear.';
      }
    }
  };

  tools.fs_bridge_login_ui = {
    description: '🔐 Open a secure popup to enter your FS Bridge API key. The key is stored directly in your browser localStorage — it never passes through the AI model.',
    parameters: { type: 'object', properties: {} },
    handler: async function() {
      // If user is already connected, ask before replacing key
      var currentKey = keyManager.get();
      if (currentKey) {
        var keep = confirm('FS Bridge key is already set (' + maskKey(currentKey) + ').\n\nClick OK to replace it with a new key, or Cancel to keep it.');
        if (!keep) return 'Kept existing FS Bridge key.';
      }

      // Create a modal overlay for secure key entry
      var overlay = document.createElement('div');
      overlay.id = 'fs-bridge-login-overlay';
      overlay.style.cssText =
        'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
        'background:rgba(0,0,0,0.6);z-index:99999;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-family:system-ui,-apple-system,sans-serif;';

      var modal = document.createElement('div');
      modal.style.cssText =
        'background:#1e1e2e;color:#e0e0e0;border-radius:16px;' +
        'padding:32px;max-width:440px;width:90%;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.5);' +
        'border:1px solid rgba(255,255,255,0.08);';

      modal.innerHTML =
        '<div style="text-align:center;margin-bottom:20px;">' +
          '<span style="font-size:40px;">🔐</span>' +
          '<h2 style="color:#fff;margin:8px 0 4px;font-size:20px;">FS Bridge Login</h2>' +
          '<p style="color:#a0a0b0;font-size:13px;margin:0;">Enter your FS Bridge API key to connect</p>' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
          '<label style="display:block;font-size:13px;color:#a0a0b0;margin-bottom:6px;">API Key</label>' +
          '<input id="fs-bridge-key-input" type="password" placeholder="Paste your key here..."' +
          ' style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);' +
          'background:#2a2a3e;color:#e0e0e0;font-size:14px;outline:none;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:16px;font-size:12px;color:#787890;text-align:center;">' +
          '💡 Get your key from the <a href="' + bridgeUrl('/ui/') + '" target="_blank" ' +
          'style="color:#7c9bff;text-decoration:none;">FS Bridge Dashboard</a>' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
          '<button id="fs-bridge-cancel-btn" style="padding:8px 20px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);' +
          'background:transparent;color:#a0a0b0;cursor:pointer;font-size:14px;">Cancel</button>' +
          '<button id="fs-bridge-connect-btn" style="padding:8px 20px;border-radius:10px;border:none;' +
          'background:#7c9bff;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Connect</button>' +
        '</div>' +
        '<div id="fs-bridge-login-error" style="margin-top:12px;color:#ff6b6b;font-size:13px;display:none;text-align:center;"></div>';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      var input = document.getElementById('fs-bridge-key-input');
      var connectBtn = document.getElementById('fs-bridge-connect-btn');
      var cancelBtn = document.getElementById('fs-bridge-cancel-btn');
      var errorDiv = document.getElementById('fs-bridge-login-error');

      function showError(msg) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
      }

      function cleanup() {
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }

      function cancel() {
        cleanup();
      }

      function doConnect() {
        var val = input.value.trim();
        if (!val) {
          showError('Please enter an API key.');
          return;
        }
        connectBtn.disabled = true;
        connectBtn.textContent = 'Verifying...';
        errorDiv.style.display = 'none';

        // Store temporarily to verify
        keyManager.set(val);

        // Verify by calling status
        bridgeCall('/api/status').then(function(result) {
          if (result.success) {
            // Key works! Keep it stored.
            cleanup();
            return 'FS Bridge connected! Root: `' + (result.root || 'unknown') + '`';
          } else {
            // Key didn't work, remove it
            keyManager.clear();
            showError('Connection failed: ' + (result.error || 'Invalid key'));
          }
        }).catch(function(err) {
          keyManager.clear();
          showError('Error: ' + (err.message || 'Unknown error'));
        });
      }

      // Event handlers
      connectBtn.addEventListener('click', doConnect);
      cancelBtn.addEventListener('click', cancel);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) cancel();
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doConnect();
        if (e.key === 'Escape') cancel();
      });

      // Focus the input
      setTimeout(function() { input.focus(); }, 100);
    }
  };



  // ── File Listing ─────────────────────────────────────────────────

  tools.list_files = {
    description: 'List files and directories at a given path in the project. Returns file names, sizes, and modification times.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '/', description: 'Directory path to list (e.g. "." or "src/")' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var path = args.path || '.';
      var result = await bridgeCall('/api/list', { path: path });
      if (!result.success) return 'list_files error: ' + result.error;
      // 🐛 FIX: The server returns 'entries', not 'files'
      var files = result.entries || result.files || result.data || [];
      if (!files.length) return '`' + path + '` - (empty directory)';
      var lines = ['**Files in `' + path + '`:**', ''];
      var sorted = files.slice().sort(function(a, b) {
        var aDir = a.type === 'directory' ? 0 : 1;
        var bDir = b.type === 'directory' ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return (a.name || '').localeCompare(b.name || '');
      });
      for (var i = 0; i < sorted.length; i++) {
        var f = sorted[i];
        var icon = f.type === 'directory' ? '📁' : (f.type === 'symlink' ? '🔗' : '📄');
        var size = f.size !== undefined ? ' (' + formatSize(f.size) + ')' : '';
        var modified = f.modified ? ' - ' + f.modified : '';
        lines.push(icon + ' `' + f.name + '`' + size + modified);
      }
      return lines.join('\n');
    }
  };

  tools.get_directory_tree = {
    description: 'Get a tree view of the directory structure. Shows nested folders and files in an indented format.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.', description: 'Root path for the tree' },
        max_depth: { type: 'number', default: 3, description: 'Maximum depth to traverse (1-10)' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var depth = Math.min(Math.max(args.max_depth || 3, 1), 10);
      var result = await bridgeCall('/api/tree', { max_depth: depth, path: args.path || '.' });
      if (!result.success) return 'get_directory_tree error: ' + result.error;
      var tree = result.tree || result.data || '';
      return '**Directory Tree:**\n\n\`\`\`\n' + tree + '\n\`\`\`';
    }
  };

  // ── File Reading ─────────────────────────────────────────────────

  tools.read_file = {
    description: 'Read the full contents of a file from the project. Returns the text content with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file (e.g. "src/app.js" or "./README.md")' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/read', { path: args.path });
      if (!result.success) return 'read_file error: ' + result.error;
      var content = result.content || result.data || '';
      var lineCount = content.split('\n').length;
      var display = content;
      if (content.length > 8000) {
        display = content.substring(0, 8000) + '\n\n... (truncated, full length: ' + content.length + ' chars)';
      }
      return '**`' + args.path + '`** - ' + lineCount + ' lines, ' + content.length + ' chars\n\n\`\`\`\n' + display + '\n\`\`\`';
    }
  };

  tools.read_file_lines = {
    description: 'Read specific line(s) from a file. Useful for viewing small sections without loading the entire file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file (e.g. "src/app.js")' },
        start_line: { type: 'number', description: 'Starting line number (1-based)' },
        end_line: { type: 'number', description: 'Ending line number (optional, returns single line if omitted)' }
      },
      required: ['path', 'start_line']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/read_lines', {
        path: args.path,
        start_line: args.start_line,
        end_line: args.end_line
      });
      if (!result.success) return 'read_file_lines error: ' + result.error;
      var content = result.content || result.data || '';
      var start = args.start_line || 1;
      var range = args.end_line ? start + '-' + args.end_line : String(start);
      return '**`' + args.path + '`** lines ' + range + '\n\n\`\`\`\n' + content + '\n\`\`\`';
    }
  };

  // ── File Writing ─────────────────────────────────────────────────

  tools.write_file = {
    description: 'Write or overwrite a file in the project. Creates parent directories if they do not exist. Use this to create new files or update existing ones.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path where to write the file (e.g. "src/app.py")' },
        content: { type: 'string', description: 'The full file content to write' }
      },
      required: ['path', 'content']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/write', { path: args.path, content: args.content });
      if (!result.success) return 'write_file error: ' + result.error;
      var lines = args.content.split('\n').length;
      return 'File written: `' + args.path + '` (' + lines + ' lines, ' + args.content.length + ' chars)';
    }
  };

  tools.edit_file = {
    description: 'Perform a targeted text replacement in a file. Replaces the FIRST occurrence of old_string with new_string. Safer than write_file for making small changes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit (e.g. "src/app.js")' },
        old_string: { type: 'string', description: 'The exact text to find and replace (first occurrence only)' },
        new_string: { type: 'string', description: 'The replacement text' }
      },
      required: ['path', 'old_string', 'new_string']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/edit', {
        path: args.path,
        old_string: args.old_string,
        new_string: args.new_string
      });
      if (!result.success) return 'edit_file error: ' + result.error;
      return 'File edited: `' + args.path + '`';
    }
  };

  // ── File Operations ─────────────────────────────────────────────

  tools.delete_file = {
    description: 'Delete a file or empty directory from the project. Use with caution - this is irreversible.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file or directory to delete' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/delete', { path: args.path });
      if (!result.success) return 'delete_file error: ' + result.error;
      return 'Deleted: `' + args.path + '`';
    }
  };

  tools.move_file = {
    description: 'Rename or move a file from one path to another within the project.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Current file path (e.g. "old_name.py")' },
        destination: { type: 'string', description: 'New file path (e.g. "new_name.py" or "subdir/new_name.py")' }
      },
      required: ['source', 'destination']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/move', { source: args.source, destination: args.destination });
      if (!result.success) return 'move_file error: ' + result.error;
      return 'Moved: `' + args.source + '` to `' + args.destination + '`';
    }
  };

  tools.create_directory = {
    description: 'Create a new directory (and any necessary parent directories) in the project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the directory to create (e.g. "src/components")' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/mkdir', { path: args.path });
      if (!result.success) return 'create_directory error: ' + result.error;
      return 'Directory created: `' + args.path + '`';
    }
  };

  // ── Search & Info ───────────────────────────────────────────────

  tools.search_files = {
    description: 'Search for files by name pattern in the project. Supports glob patterns like "*.py", "**/*.test.js", "src/**/*.css".',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern/query (e.g. "*.py", "*test*")' },
        root: { type: 'string', default: '.', description: 'Root directory to search in' }
      },
      required: ['pattern']
    },
    handler: async function(args) {
      var root = args.root || '.';
      var result = await bridgeCall('/api/search', { q: args.pattern, root: root });
      if (!result.success) return 'search_files error: ' + result.error;
      var files = result.results || result.files || result.data || [];
      if (!files.length) return 'No files matching `' + args.pattern + '` in `' + root + '`';
      var lines = ['**Search results for `' + args.pattern + '`** in `' + root + '`:', ''];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var name = typeof f === 'string' ? f : (f.path || f.name || '');
        lines.push((i + 1) + '. `' + name + '`');
      }
      return lines.join('\n');
    }
  };

  tools.file_exists = {
    description: 'Check if a specific file exists in the project. Returns a boolean.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to check (e.g. "src/app.py")' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/exists', { path: args.path });
      if (!result.success) return 'file_exists error: ' + result.error;
      var exists = !!(result.exists || result.data === true || result.found === true);
      if (exists) {
        return 'File exists: `' + args.path + '`';
      } else {
        return 'File not found: `' + args.path + '`';
      }
    }
  };

  tools.get_file_info = {
    description: 'Get detailed information about a file or directory: size, type, creation/modification dates, permissions.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file or directory (e.g. "src/app.js")' }
      },
      required: ['path']
    },
    handler: async function(args) {
      var result = await bridgeCall('/api/info', { path: args.path });
      if (!result.success) return 'get_file_info error: ' + result.error;
      // Server returns stat dict directly at top level of response
      var info = result.info || result.data || result;
      var lines = [
        '**File Info:** `' + args.path + '`',
        '**Type:** ' + (info.type || 'file')
      ];
      if (info.size !== undefined) lines.push('**Size:** ' + formatSize(info.size));
      if (info.created) lines.push('**Created:** ' + info.created);
      if (info.modified) lines.push('**Modified:** ' + info.modified);
      if (info.permissions) lines.push('**Permissions:** ' + info.permissions);
      if (info.owner) lines.push('**Owner:** ' + info.owner);
      return lines.join('\n');
    }
  };

  tools.get_project_stats = {
    description: 'Get overall project statistics: total files, directories, lines of code, file types, and total size.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.', description: 'Project root path' }
      },
      required: []
    },
    handler: async function(args) {
      var path = args.path || '.';
      var result = await bridgeCall('/api/stats', { path: path });
      if (!result.success) return 'get_project_stats error: ' + result.error;
      var stats = result.stats || result.data || result;
      var lines = ['**Project Statistics:** `' + path + '`', ''];
      if (stats.files !== undefined) lines.push('**Files:** ' + stats.files);
      if (stats.directories !== undefined) lines.push('**Directories:** ' + stats.directories);
      if (stats.lines !== undefined) lines.push('**Lines of Code:** ' + stats.lines);
      if (stats.size !== undefined) lines.push('**Total Size:** ' + formatSize(stats.size));
      if (stats.languages || stats.extensions) {
        var langs = stats.languages || stats.extensions || {};
        var entries = [];
        for (var lk in langs) {
          if (langs.hasOwnProperty(lk)) {
            entries.push({ ext: lk, count: langs[lk] });
          }
        }
        entries.sort(function(a, b) { return b.count - a.count; });
        if (entries.length) {
          lines.push('', '**By Extension:**');
          for (var ei = 0; ei < entries.length; ei++) {
            lines.push('  `' + entries[ei].ext + '`: ' + entries[ei].count);
          }
        }
      }
      return lines.join('\n');
    }
  };

  // ─── Module Registration ──────────────────────────────────────────
  var toolList = [];
  var toolKeys = Object.keys(tools);
  for (var ti = 0; ti < toolKeys.length; ti++) {
    var name = toolKeys[ti];
    var def = tools[name];
    toolList.push({
      type: 'function',
      function: {
        name: name,
        description: def.description,
        parameters: {
          type: 'object',
          properties: def.parameters.properties,
          required: def.parameters.required || []
        }
      }
    });
  }

  ModuleSystem.register('fs-bridge', {
    name: 'FS Bridge',
    description: 'Browse, read, write, edit, search, and manage project files on your local machine via the FS Bridge server. Connect to a local server on port 8742 to access your file system from the chat.',
    tools: toolList,
    // 🐛 FIX: Must check if tool belongs to THIS module before calling handler
    // Without this check, tools["evolve_self"] is undefined, and .handler
    // throws TypeError caught below, which returns a STRING instead of null.
    // That string hijacks the evolve_self dispatch in chatseed.html!
    handleToolCall: async function(toolName, args) {
      try {
        // CRITICAL: Only handle tools that belong to THIS module
        // If the tool name isn't in our tools object, return null immediately
        // so the chatseed.html dispatch can route to 'evolve_self' or fallback.
        if (!tools.hasOwnProperty(toolName)) {
          return null;
        }
        return await tools[toolName].handler(args);
      } catch (e) {
        var msg = (e && e.message) ? e.message : String(e);
        return toolName + ' error: ' + msg;
      }
    }
  });

  console.log('[FS Bridge Module] Registered with ' + Object.keys(tools).length + ' tools');
  console.log('[FS Bridge Module] Bridge at ' + BRIDGE_BASE + ' | ' + (keyManager.has() ? 'Key found' : 'No key stored'));
  console.log('[FS Bridge Module] Dashboard: ' + bridgeUrl('/ui/'));

})();