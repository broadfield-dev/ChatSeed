// HuggingFace Hub Module for ChatSeed v10 — FIXED
// ============================================================================
// FIXES:
//   1. commitFiles() now uses dynamic repo type path (spaces/models/datasets)
//      instead of hardcoded /api/models/ — fixes "Repository not found" on uploads
//   2. hf_delete_file() now uses the same dynamic path for commit endpoint
//   3. Added proper repo type resolution throughout
// ============================================================================

(function() {
  'use strict';

  // ─── Configuration ───────────────────────────────────────────────────────
  const HF_API_BASE = 'https://huggingface.co';
  const INFERENCE_API_BASE = 'https://api-inference.huggingface.co';

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function getToken() {
    try {
      return localStorage.getItem('chatseed_hf_token') || '';
    } catch(e) {
      return '';
    }
  }

  function setToken(token) {
    try {
      localStorage.setItem('chatseed_hf_token', token);
    } catch(e) {}
  }

  function clearToken() {
    try {
      localStorage.removeItem('chatseed_hf_token');
    } catch(e) {}
  }

  function authHeader() {
    const t = getToken();
    if (!t) throw new Error('No HuggingFace token set. Use hf_set_token or hf_login_ui to set your HF access token first.');
    return { 'Authorization': 'Bearer ' + t };
  }

  /** Generic fetch wrapper for HF Hub API */
  async function hfFetch(path, options = {}) {
    const url = HF_API_BASE + path;
    const headers = {
      ...authHeader(),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let msg = '';
      try { const err = await res.json(); msg = err.error || JSON.stringify(err); } catch(e) { msg = res.statusText; }
      throw new Error(`HF API ${res.status}: ${msg}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  async function hfFetchText(path) {
    const url = HF_API_BASE + path;
    const headers = { ...authHeader() };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let msg = '';
      try { const err = await res.json(); msg = err.error || JSON.stringify(err); } catch(e) { msg = res.statusText; }
      throw new Error(`HF API ${res.status}: ${msg}`);
    }
    return res.text();
  }
/** Fetch raw content (for reading file contents from repos, including private ones) */
  async function hfFetchRaw(path) {
    const url = HF_API_BASE + path;
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let msg = '';
      try { const err = await res.json(); msg = err.error || JSON.stringify(err); } catch(e) { msg = res.statusText; }
      throw new Error(`HF API ${res.status}: ${msg}`);
    }
    return res.text();
  }

  /** Fetch with HEAD method (for checking existence) */
  async function hfFetchHead(path) {
    const url = HF_API_BASE + path;
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, { method: 'HEAD', headers });
    return { ok: res.ok, status: res.status };
  }

  /** Convert repo type to API path segment */
  function repoTypePath(type) {
    switch(type) {
      case 'space': return 'spaces';
      case 'model': return 'models';
      case 'dataset': return 'datasets';
      default: return 'spaces';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ★ FIX #1 — commitFiles now uses dynamic repo type path instead of
  //            hardcoded /api/models/
  // ══════════════════════════════════════════════════════════════════════════
  async function commitFiles(repoType, namespace, repo, files, summary, description) {
    const rev = 'main';
    const typePath = repoTypePath(repoType); // "spaces" | "models" | "datasets"
    const body = {
      summary: summary || 'Update via ChatSeed',
      description: description || '',
      files: files.map(f => ({
        path: f.path,
        content: f.content,
        encoding: f.encoding || 'utf-8'
      }))
    };
    // ✓ NOW USES /api/spaces/... or /api/models/... or /api/datasets/...
    return hfFetch(`/api/${typePath}/${namespace}/${repo}/commit/${rev}`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // ─── Secure Popup UI ─────────────────────────────────────────────────

  function openSecureLoginPopup() {
    const existing = document.getElementById('chatseed-hf-login-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'chatseed-hf-login-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px; animation: fadeIn 0.2s ease-out;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #1f2937; border: 1px solid #374151; border-radius: 20px;
      padding: 28px; width: 420px; max-width: 100%;
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
      position: relative; font-family: system-ui, -apple-system, sans-serif;
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes chatseed-hf-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      #chatseed-hf-login-overlay > div { animation: chatseed-hf-fade-in 0.2s ease-out; }
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.5rem;">🤗</span>
        <span style="font-size:1.1rem;font-weight:600;color:#f3f4f6;">HuggingFace Login</span>
      </div>
      <button id="chatseed-hf-close-btn" style="
        background:none;border:none;color:#9ca3af;font-size:1.3rem;cursor:pointer;
        width:32px;height:32px;border-radius:8px;display:flex;align-items:center;
        justify-content:center;transition:background 0.15s;
      " onmouseover="this.style.background='#374151'" onmouseout="this.style.background='none'">✕</button>
    `;

    const body = document.createElement('div');
    body.innerHTML = `
      <p style="color:#d1d5db;font-size:0.85rem;margin:0 0 16px 0;line-height:1.5;">
        Paste your HuggingFace access token below. 
        <strong style="color:#6ee7b7;">Your token is stored directly in your browser's localStorage</strong>
        — it never passes through the AI model or any external server (other than HF's own API for verification).
      </p>
      <div style="background:#111827;border:1px solid #374151;border-radius:12px;padding:12px 16px;margin-bottom:16px;">
        <label style="color:#9ca3af;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:6px;">
          🔑 HuggingFace Token
        </label>
        <input type="password" id="chatseed-hf-token-input" placeholder="hf_..." style="
          width:100%;padding:10px 12px;background:#030712;border:1px solid #4b5563;
          border-radius:8px;color:#f3f4f6;font-size:0.9rem;outline:none;
          transition:border-color 0.15s;box-sizing:border-box;
        ">
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="chatseed-hf-show-token" style="accent-color:#059669;">
          <label for="chatseed-hf-show-token" style="color:#6b7280;font-size:0.75rem;cursor:pointer;">Show token</label>
        </div>
      </div>
      <div id="chatseed-hf-login-status" style="
        display:none;font-size:0.8rem;padding:8px 12px;border-radius:8px;margin-bottom:12px;
      "></div>
      <div style="display:flex;gap:10px;">
        <button id="chatseed-hf-login-submit" style="
          flex:1;padding:10px 16px;background:#059669;color:white;border:none;
          border-radius:10px;font-size:0.9rem;font-weight:500;cursor:pointer;
          transition:background 0.15s;
        " onmouseover="this.style.background='#047857'" onmouseout="this.style.background='#059669'">
          🔐 Set Token
        </button>
        <button id="chatseed-hf-login-cancel" style="
          padding:10px 16px;background:#374151;color:#d1d5db;border:none;
          border-radius:10px;font-size:0.9rem;cursor:pointer;
          transition:background 0.15s;
        " onmouseover="this.style.background='#4b5563'" onmouseout="this.style.background='#374151'">
          Cancel
        </button>
      </div>
      <p style="color:#6b7280;font-size:0.7rem;margin:12px 0 0 0;text-align:center;">
        Get your token at <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:#60a5fa;">huggingface.co/settings/tokens</a>
      </p>
    `;

    box.appendChild(header);
    box.appendChild(body);
    overlay.appendChild(styleEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = document.getElementById('chatseed-hf-token-input');
    const showCheck = document.getElementById('chatseed-hf-show-token');
    const submitBtn = document.getElementById('chatseed-hf-login-submit');
    const cancelBtn = document.getElementById('chatseed-hf-login-cancel');
    const closeBtn = document.getElementById('chatseed-hf-close-btn');
    const statusEl = document.getElementById('chatseed-hf-login-status');

    function closeOverlay() { overlay.remove(); }

    showCheck.addEventListener('change', function() {
      input.type = this.checked ? 'text' : 'password';
    });

    setTimeout(() => input.focus(), 100);

    async function handleSubmit() {
      const token = input.value.trim();
      if (!token) {
        showStatus('⚠️ Please enter a token.', '#f59e0b');
        return;
      }
      if (!token.startsWith('hf_')) {
        showStatus('⚠️ Tokens should start with <code>hf_</code>. Get one from your HF settings.', '#f59e0b');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Verifying...';
      submitBtn.style.opacity = '0.6';

      setToken(token);

      try {
        const res = await fetch('https://huggingface.co/api/whoami-v2', {
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          const info = await res.json();
          const name = info.name || info.user || 'unknown';
          const masked = token.substring(0, 6) + '…' + token.substring(token.length - 4);
          showStatus(`✅ **Authenticated as ${name}** (${masked})`, '#059669');
          submitBtn.textContent = '✅ Done!';
          submitBtn.style.background = '#059669';
          setTimeout(closeOverlay, 1500);
        } else {
          showStatus(`⚠️ Token stored, but HF verification failed (${res.status}). It may still work for some operations.`, '#f59e0b');
          submitBtn.disabled = false;
          submitBtn.textContent = '🔐 Set Token';
          submitBtn.style.opacity = '1';
        }
      } catch(e) {
        showStatus(`⚠️ Token stored locally, but couldn't verify: ${e.message}`, '#f59e0b');
        submitBtn.disabled = false;
        submitBtn.textContent = '🔐 Set Token';
        submitBtn.style.opacity = '1';
      }
    }

    function showStatus(msg, color) {
      statusEl.style.display = 'block';
      statusEl.style.background = color + '18';
      statusEl.style.border = '1px solid ' + color + '44';
      statusEl.style.color = color;
      statusEl.innerHTML = msg;
    }

    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', closeOverlay);
    closeBtn.addEventListener('click', closeOverlay);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleSubmit();
      if (e.key === 'Escape') closeOverlay();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeOverlay();
    });
  }

  // ─── Tool Implementations ────────────────────────────────────────────────

  const tools = {
    // ── Authentication ──────────────────────────────────────────────────
    hf_set_token: {
      description: 'Store your HuggingFace access token for this session. Get it from https://huggingface.co/settings/tokens',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Your HF access token (hf_...). Required for all write operations.' }
        },
        required: ['token']
      },
      handler: async function(args) {
        const t = (args.token || '').trim();
        if (!t || !t.startsWith('hf_')) {
          return '⚠️ Invalid token format. Tokens start with `hf_`. Get one at https://huggingface.co/settings/tokens';
        }
        const masked = t.substring(0, 6) + '…' + t.substring(t.length - 4);
        setToken(t);
        try {
          const whoami = await hfFetch('/api/whoami-v2');
          const name = whoami.name || whoami.user || 'unknown';
          return `✅ **HuggingFace token stored** (${masked})\n👤 Authenticated as: **${name}**\nYou can now use all HF tools.`;
        } catch(e) {
          return `⚠️ Token stored (${masked}) but verification failed: ${e.message}. Check that the token is valid.`;
        }
      }
    },

    hf_login_ui: {
      description: '🔐 Open a secure popup to enter your HF token. The token is stored directly in your browser — it never passes through the AI model.',
      parameters: { type: 'object', properties: {} },
      handler: async function() {
        openSecureLoginPopup();
        return [
          '🔐 **Secure Login Popup Opened**',
          '',
          'A popup has been opened where you can paste your HuggingFace token.',
          '',
          '> 🛡️ **Your token is stored directly in your browser\'s localStorage**',
          '> — it **never passes through this AI model** or the LLM provider.',
          '> The model has no way to see or log your token.',
          '',
          '💡 **Tip:** You can also paste your token directly in the chat with `hf_set_token`,',
          '   but the popup method is more secure.',
          '',
          '📋 Get your token at: https://huggingface.co/settings/tokens'
        ].join('\n');
      }
    },

    hf_logout: {
      description: 'Clear your stored HuggingFace token from localStorage.',
      parameters: { type: 'object', properties: {} },
      handler: async function() {
        const hadToken = !!getToken();
        clearToken();
        return hadToken
          ? '🚪 **Logged out.** HuggingFace token has been removed from localStorage.'
          : '👋 No token was stored. Nothing to clear.';
      }
    },

    hf_token_status: {
      description: 'Check if a HF token is stored and who it belongs to (without revealing the token).',
      parameters: { type: 'object', properties: {} },
      handler: async function() {
        const t = getToken();
        if (!t) {
          return '🔑 **No token stored.** Use `hf_login_ui` (secure popup) or `hf_set_token` to log in.';
        }
        const masked = t.substring(0, 6) + '…' + t.substring(t.length - 4);
        try {
          const info = await hfFetch('/api/whoami-v2');
          const name = info.name || info.user || 'unknown';
          return [
            `🔑 **Token Status:** Active (${masked})`,
            `👤 **Authenticated as:** ${name}`,
            `📧 **Email:** ${info.email || 'N/A'}`,
            `💳 **Can Pay:** ${info.canPay ? 'Yes' : 'No'}`,
            ``,
            `💡 Use \`hf_logout\` to clear your token.`
          ].join('\n');
        } catch(e) {
          return `⚠️ **Token stored** (${masked}) but verification failed: ${e.message}`;
        }
      }
    },

    hf_whoami: {
      description: 'Check who you are authenticated as on HuggingFace Hub.',
      parameters: { type: 'object', properties: {} },
      handler: async function() {
        try {
          const info = await hfFetch('/api/whoami-v2');
          const lines = [
            `**👤 HuggingFace User Info**`,
            `**ID:** ${info.id || info.name || 'N/A'}`,
            `**Name:** ${info.name || info.user || 'N/A'}`,
            `**Email:** ${info.email || 'N/A'}`,
            `**Type:** ${info.type || info.org || 'user'}`,
            `**Can Pay:** ${info.canPay ? '✅ Yes' : '❌ No'}`,
            `**Plan:** ${info.plan ? info.plan.name || info.plan : 'Free/Unknown'}`
          ];
          if (info.orgs && info.orgs.length) {
            lines.push(`**Organizations:** ${info.orgs.map(o => o.name).join(', ')}`);
          }
          if (info.usage && info.usage.inference) {
            lines.push(`**Inference Usage:** ${JSON.stringify(info.usage.inference)}`);
          }
          return lines.join('\n');
        } catch(e) {
          return `❌ Failed to get user info: ${e.message}`;
        }
      }
    },

    // ── Spaces: Create / Duplicate / Delete ─────────────────────────────
    hf_create_space: {
      description: 'Create a new HuggingFace Space. Supports Gradio, Streamlit, Docker, or static SDKs.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Space name (e.g. "my-cool-demo"). Must be unique under your namespace.' },
          sdk: { type: 'string', enum: ['gradio', 'streamlit', 'docker', 'static'], default: 'gradio', description: 'SDK/framework to use' },
          type: { type: 'string', enum: ['space'], default: 'space' },
          title: { type: 'string', description: 'Optional display title' },
          license: { type: 'string', description: 'Optional license (e.g. "mit", "apache-2.0")' },
          hardware: { type: 'string', description: 'Hardware upgrade (e.g. "t4-medium", "cpu-upgrade"). See HF docs for options.' },
          secrets: { type: 'string', description: 'JSON object of secrets {"key": "value", ...}' },
          variables: { type: 'string', description: 'JSON object of env variables {"KEY": "VALUE", ...}' },
          sleep_time: { type: 'number', description: 'Sleep timeout in seconds (for GPU spaces)' },
          private: { type: 'boolean', default: false, description: 'Create as private space?' },
          org: { type: 'string', description: 'Organization namespace (if creating under an org)' }
        },
        required: ['name']
      },
      handler: async function(args) {
        const namespace = args.org || (await hfFetch('/api/whoami-v2')).name;
        const repoId = namespace + '/' + args.name;
        const payload = {
          name: args.name,
          type: 'space',
          sdk: args.sdk || 'gradio',
          private: args.private || false
        };
        if (args.title) payload.title = args.title;
        if (args.license) payload.license = args.license;
        if (args.hardware) payload.hardware = args.hardware;
        if (args.sleep_time) payload.sleep_time = args.sleep_time;

        const secrets = args.secrets ? (typeof args.secrets === 'string' ? JSON.parse(args.secrets) : args.secrets) : {};
        const variables = args.variables ? (typeof args.variables === 'string' ? JSON.parse(args.variables) : args.variables) : {};
        if (Object.keys(secrets).length) payload.secrets = secrets;
        if (Object.keys(variables).length) payload.variables = variables;

        const result = await hfFetch('/api/repos/create', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        const url = `https://huggingface.co/spaces/${repoId}`;
        const appUrl = `https://${namespace.replace(/\//g, '-')}-${args.name}.hf.space`;

        let extra = '';
        if (args.hardware) extra += `\n⚡ Hardware requested: ${args.hardware}`;
        if (args.sleep_time) extra += `\n💤 Sleep timeout: ${args.sleep_time}s`;

        return [
          `✅ **Space created successfully!**`,
          ``,
          `**Repo:** ${repoId}`,
          `**SDK:** ${args.sdk || 'gradio'}`,
          `**Visibility:** ${args.private ? '🔒 Private' : '🌍 Public'}`,
          `**URL:** ${url}`,
          `**App:** ${appUrl}`,
          extra,
          ``,
          `💡 **Next steps:** Upload files using \`hf_upload_file\` or \`hf_upload_app\``
        ].join('\n');
      }
    },

    hf_duplicate_space: {
      description: 'Duplicate an existing Space (useful for forking with custom config).',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Source Space ID (e.g. "username/space-name")' },
          name: { type: 'string', description: 'New Space name' },
          org: { type: 'string', description: 'Optional org to duplicate into' },
          hardware: { type: 'string', description: 'Hardware for the new Space' },
          secrets: { type: 'string', description: 'JSON of secrets' },
          variables: { type: 'string', description: 'JSON of env variables' },
          sleep_time: { type: 'number', description: 'Sleep timeout in seconds' },
          private: { type: 'boolean', default: false }
        },
        required: ['from', 'name']
      },
      handler: async function(args) {
        const namespace = args.org || (await hfFetch('/api/whoami-v2')).name;
        const repoId = namespace + '/' + args.name;
        const secrets = args.secrets ? (typeof args.secrets === 'string' ? JSON.parse(args.secrets) : args.secrets) : {};
        const variables = args.variables ? (typeof args.variables === 'string' ? JSON.parse(args.variables) : args.variables) : {};
        const body = {
          from: args.from,
          name: args.name,
          namespace: namespace,
          private: args.private || false
        };
        if (args.hardware) body.hardware = args.hardware;
        if (args.sleep_time) body.sleep_time = args.sleep_time;
        if (Object.keys(secrets).length) body.secrets = secrets;
        if (Object.keys(variables).length) body.variables = variables;

        const result = await hfFetch(`/api/spaces/duplicate`, {
          method: 'POST',
          body: JSON.stringify(body)
        });

        return [
          `✅ **Space duplicated!**`,
          ``,
          `**From:** ${args.from}`,
          `**New Repo:** ${repoId}`,
          `**URL:** https://huggingface.co/spaces/${repoId}`,
          `**App:** https://${namespace.replace(/\//g, '-')}-${args.name}.hf.space`,
          args.hardware ? `**Hardware:** ${args.hardware}` : '',
          args.sleep_time ? `**Sleep:** ${args.sleep_time}s` : ''
        ].filter(l => l).join('\n');
      }
    },

    hf_delete_space: {
      description: 'Delete a Space repository from HuggingFace Hub.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID to delete (e.g. "username/my-space")' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use format "namespace/repo-name"';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}`, { method: 'DELETE' });
        return `✅ **Space deleted:** ${args.repo_id}`;
      }
    },

    // ── File Operations ────────────────────────────────────────────────
    hf_upload_file: {
      description: 'Upload a single file to a Space (app.py, requirements.txt, README.md, etc.). Triggers a rebuild.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID (e.g. "username/my-space")' },
          path: { type: 'string', description: 'Path in the repo (e.g. "app.py" or "src/utils.py")' },
          content: { type: 'string', description: 'File content as text' },
          summary: { type: 'string', description: 'Commit message (default: "Update via ChatSeed")' },
          description: { type: 'string', description: 'Optional commit description' }
        },
        required: ['repo_id', 'path', 'content']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;

        // ★ FIX #1 applied: commitFiles now uses dynamic repo type path
        const result = await commitFiles(
          'space', namespace, repo,
          [{ path: args.path, content: args.content }],
          args.summary || 'Update via ChatSeed',
          args.description || ''
        );
        return [
          `✅ **File uploaded:** \`${args.path}\` → \`${args.repo_id}\``,
          `📝 ${args.summary || 'Update via ChatSeed'}`,
          ``,
          `💡 The Space will now rebuild automatically. Check status with \`hf_space_status\`.`
        ].join('\n');
      }
    },

    hf_upload_app: {
      description: 'Upload a complete Gradio/Streamlit app with requirements.txt in one go.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID (e.g. "username/my-space")' },
          app_code: { type: 'string', description: 'The app.py (or app.js for static) source code' },
          requirements: { type: 'string', description: 'Optional requirements.txt content (one package per line)' },
          readme: { type: 'string', description: 'Optional README.md content' },
          extra_files: { type: 'string', description: 'Optional JSON of extra files {"path": "content", ...}' },
          summary: { type: 'string', description: 'Commit message' }
        },
        required: ['repo_id', 'app_code']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;

        const files = [{ path: 'app.py', content: args.app_code }];
        if (args.requirements) files.push({ path: 'requirements.txt', content: args.requirements });
        if (args.readme) files.push({ path: 'README.md', content: args.readme });
        if (args.extra_files) {
          const extras = typeof args.extra_files === 'string' ? JSON.parse(args.extra_files) : args.extra_files;
          for (const [path, content] of Object.entries(extras)) {
            files.push({ path, content: String(content) });
          }
        }

        // ★ FIX #1 applied
        const result = await commitFiles(
          'space', namespace, repo, files,
          args.summary || 'Deploy app via ChatSeed',
          'Uploaded app.py' + (args.requirements ? ' + requirements.txt' : '') + (args.readme ? ' + README.md' : '')
        );
        return [
          `✅ **App deployed to:** \`${args.repo_id}\``,
          `📦 **Files uploaded:** ${files.map(f => '`' + f.path + '`').join(', ')}`,
          ``,
          `🌐 **Space:** https://huggingface.co/spaces/${args.repo_id}`,
          `🚀 **App URL:** https://${namespace.replace(/\//g, '-')}-${repo}.hf.space`,
          ``,
          `💡 The Space is now building. Use \`hf_space_status ${args.repo_id}\` to check progress.`
        ].join('\n');
      }
    },

    // ★ FIX #2 — hf_delete_file now uses dynamic repo type path
    hf_delete_file: {
      description: 'Delete a file from a Space repository.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID (e.g. "username/my-space")' },
          path: { type: 'string', description: 'File path in the repo to delete' },
          summary: { type: 'string', description: 'Commit message' }
        },
        required: ['repo_id', 'path']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;

        const rev = 'main';
        const typePath = 'spaces'; // DELETE only applies to spaces
        const body = {
          summary: args.summary || `Delete ${args.path}`,
          description: '',
          deletedEntries: [{ path: args.path }]
        };

        // ★ FIX #2: uses /api/spaces/.../commit/main instead of /api/models/...
        await hfFetch(`/api/${typePath}/${namespace}/${repo}/commit/${rev}`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        return `✅ **File deleted:** \`${args.path}\` from \`${args.repo_id}\``;
      }
    },

    // ── Space Configuration ─────────────────────────────────────────────
    hf_set_secret: {
      description: 'Add or update a secret (environment variable) for a Space. Triggers a restart.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID (e.g. "username/my-space")' },
          key: { type: 'string', description: 'Secret name (e.g. "HF_TOKEN", "API_KEY")' },
          value: { type: 'string', description: 'Secret value' }
        },
        required: ['repo_id', 'key', 'value']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}/secrets`, {
          method: 'POST',
          body: JSON.stringify({ key: args.key, value: args.value })
        });
        return `🔐 **Secret set:** \`${args.key}\` in \`${args.repo_id}\`\n⚠️ The Space will restart.`;
      }
    },

    hf_delete_secret: {
      description: 'Delete a secret from a Space.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID' },
          key: { type: 'string', description: 'Secret name to delete' }
        },
        required: ['repo_id', 'key']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}/secrets`, {
          method: 'DELETE',
          body: JSON.stringify({ key: args.key })
        });
        return `🗑️ **Secret deleted:** \`${args.key}\` from \`${args.repo_id}\``;
      }
    },

    hf_set_hardware: {
      description: 'Request a hardware upgrade/downgrade for a Space (e.g. CPU → GPU). Triggers a restart.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID' },
          hardware: {
            type: 'string',
            description: 'Hardware tier: cpu-basic (free), cpu-upgrade ($0.03/hr), t4-small ($0.40), t4-medium ($0.60), l4-1x ($0.80), a10g-small ($1.00), a100-large ($2.50)',
            enum: ['cpu-basic', 'cpu-upgrade', 't4-small', 't4-medium', 'l4-1x', 'a10g-small', 'a10g-large', 'a100-large']
          },
          sleep_time: { type: 'number', description: 'Auto-sleep timeout in seconds (for GPU) - e.g. 7200 = 2h' }
        },
        required: ['repo_id', 'hardware']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        const body = { hardware: args.hardware };
        if (args.sleep_time) body.sleep_time = args.sleep_time;
        await hfFetch(`/api/spaces/${namespace}/${repo}/hardware`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        return [
          `⚡ **Hardware change requested for:** \`${args.repo_id}\``,
          `**New hardware:** ${args.hardware}`,
          args.sleep_time ? `**Sleep timeout:** ${args.sleep_time}s` : '',
          ``,
          `⏳ The Space is restarting. Check status with \`hf_space_status\`.`
        ].filter(l => l).join('\n');
      }
    },

    hf_set_visibility: {
      description: 'Change the visibility of a Space (public / private).',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID' },
          visibility: { type: 'string', enum: ['public', 'private'], description: 'New visibility level' }
        },
        required: ['repo_id', 'visibility']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}/settings`, {
          method: 'POST',
          body: JSON.stringify({ private: args.visibility === 'private' })
        });
        const icon = args.visibility === 'private' ? '🔒' : '🌍';
        return `${icon} **Visibility changed to ${args.visibility}:** \`${args.repo_id}\``;
      }
    },

    hf_set_sleep: {
      description: 'Set auto-sleep timeout for a Space (useful for GPU spaces to save cost).',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID' },
          sleep_time: { type: 'number', description: 'Sleep timeout in seconds (0 to disable, 300 = 5 min, 3600 = 1h, 7200 = 2h)' }
        },
        required: ['repo_id', 'sleep_time']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}/settings`, {
          method: 'POST',
          body: JSON.stringify({ sleep_time: args.sleep_time })
        });
        const status = args.sleep_time === 0 ? '❌ Disabled (never sleeps)' : `💤 ${args.sleep_time}s (${Math.round(args.sleep_time/60)} min)`;
        return `✅ **Sleep configured:** \`${args.repo_id}\` → ${status}`;
      }
    },

    hf_pause_space: {
      description: 'Pause a Space to stop billing. It can be restarted later with hf_restart_space.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID to pause' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}/pause`, { method: 'POST' });
        return `⏸️ **Space paused:** \`${args.repo_id}\`\n💡 Restart with \`hf_restart_space ${args.repo_id}\``;
      }
    },

    hf_restart_space: {
      description: 'Restart a paused Space.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID to restart' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        await hfFetch(`/api/spaces/${namespace}/${repo}/restart`, { method: 'POST' });
        return `▶️ **Space restarting:** \`${args.repo_id}\``;
      }
    },

    // ── Query / Status ─────────────────────────────────────────────────
    hf_space_status: {
      description: 'Get the runtime status, hardware, and stage of a Space.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID (e.g. "username/my-space")' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        const runtime = await hfFetch(`/api/spaces/${namespace}/${repo}/runtime`);
        const repoInfo = await hfFetch(`/api/spaces/${namespace}/${repo}`);

        const stageEmoji = {
          'NO_APP_FILE': '📄', 'BUILDING': '🔨', 'RUNNING': '✅',
          'RUNNING_BUILDING': '🔄', 'PAUSED': '⏸️', 'SLEEPING': '💤',
          'STOPPED': '⛔', 'ERROR': '❌'
        };
        const stage = runtime.stage || 'UNKNOWN';
        const sdk = repoInfo.sdk || 'N/A';
        const hardware = runtime.hardware || 'cpu-basic';
        const requestedHardware = runtime.requestedHardware || hardware;
        const visibility = repoInfo.private ? '🔒 Private' : '🌍 Public';
        const likes = repoInfo.likes || 0;

        return [
          `**📊 Space Status:** \`${args.repo_id}\``,
          ``,
          `**Stage:** ${stageEmoji[stage] || '❓'} ${stage}`,
          `**SDK:** ${sdk}`,
          `**Hardware:** ${hardware}`,
          `**Requested HW:** ${requestedHardware}`,
          `**Visibility:** ${visibility}`,
          `**Likes:** ⭐ ${likes}`,
          `**URL:** https://huggingface.co/spaces/${args.repo_id}`,
          `**App:** https://${namespace}-${repo}.hf.space`
        ].join('\n');
      }
    },

    hf_space_logs: {
      description: 'Fetch the latest build/runtime logs from a Space.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Space ID' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        try {
          const logs = await hfFetchText(`/api/spaces/${namespace}/${repo}/logs`);
          const truncated = logs.length > 3000 ? '... (truncated)\n' + logs.slice(-3000) : logs;
          return [`📋 **Build Logs for** \`${args.repo_id}\``, '```', truncated, '```'].join('\n');
        } catch(e) {
          return `❌ Could not fetch logs: ${e.message}`;
        }
      }
    },

    // ── Search / List ──────────────────────────────────────────────────
    hf_search_spaces: {
      description: 'Search for Spaces on the HuggingFace Hub by query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', default: 5, description: 'Max results (1-25)' }
        },
        required: ['query']
      },
      handler: async function(args) {
        const limit = Math.min(Math.max(args.limit || 5, 1), 25);
        const results = await hfFetch(`/api/spaces?search=${encodeURIComponent(args.query)}&limit=${limit}&sort=likes`);
        if (!results || !results.length) return `🔍 No Spaces found for "${args.query}"`;

        const lines = [`🔍 **Spaces matching "${args.query}":**`, ''];
        results.forEach((s, i) => {
          const id = s.id || `${s.namespace || '?'}/${s.name || '?'}`;
          const sdk = s.sdk ? ` [${s.sdk}]` : '';
          const likes = s.likes ? ` ⭐${s.likes}` : '';
          const desc = s.description ? `\n   > ${s.description.substring(0, 150)}` : '';
          lines.push(`${i+1}. **${id}**${sdk}${likes}`);
          if (desc) lines.push(desc);
          lines.push(`   https://huggingface.co/spaces/${id}`);
          lines.push('');
        });
        return lines.join('\n');
      }
    },

    hf_list_my_spaces: {
      description: 'List all Spaces owned by your account.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', default: 10, description: 'Max results' } },
        required: []
      },
      handler: async function() {
        const userInfo = await hfFetch('/api/whoami-v2');
        const name = userInfo.name || userInfo.user;
        const results = await hfFetch(`/api/spaces?author=${encodeURIComponent(name)}&limit=25&sort=lastModified`);
        if (!results || !results.length) {
          return `📭 No Spaces found under **${name}**.\nCreate one with \`hf_create_space\`!`;
        }
        const lines = [`📂 **Your Spaces (${name})**:`, ''];
        results.forEach((s, i) => {
          const id = s.id || `${s.namespace}/${s.name}`;
          const sdk = s.sdk ? ` [${s.sdk}]` : '';
          const vis = s.private ? '🔒' : '🌍';
          const likes = s.likes ? ` ⭐${s.likes}` : '';
          const stage = s.runtime?.stage || '';
          lines.push(`${vis} **${id}**${sdk}${likes}${stage ? ` — ${stage}` : ''}`);
        });
        lines.push('', `💡 Use \`hf_space_status <id>\` for details on any Space.`);
        return lines.join('\n');
      }
    },

    hf_search_models: {
      description: 'Search for models on the HuggingFace Hub.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', default: 5, description: 'Max results' }
        },
        required: ['query']
      },
      handler: async function(args) {
        const limit = Math.min(Math.max(args.limit || 5, 1), 25);
        const results = await hfFetch(`/api/models?search=${encodeURIComponent(args.query)}&limit=${limit}&sort=likes`);
        if (!results || !results.length) return `🔍 No models found for "${args.query}"`;

        const lines = [`🔍 **Models matching "${args.query}":**`, ''];
        results.forEach((m, i) => {
          const id = m.id || `${m.namespace || '?'}/${m.name || '?'}`;
          const pipeline = m.pipeline_tag ? ` [${m.pipeline_tag}]` : '';
          const likes = m.likes ? ` ⭐${m.likes}` : '';
          const downloads = m.downloads ? ` 📥${(m.downloads/1000).toFixed(0)}k` : '';
          lines.push(`${i+1}. **${id}**${pipeline}${likes}${downloads}`);
          lines.push(`   https://huggingface.co/${id}`);
        });
        return lines.join('\n');
      }
    },

    // ── Gradio Space API Calls ─────────────────────────────────────────
    hf_call_space: {
      description: 'Call a Gradio Space API endpoint (make predictions/inference via the Space API).',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Gradio Space ID (e.g. "abidlabs/en2fr")' },
          api_name: { type: 'string', default: '/predict', description: 'API endpoint name (e.g. "/predict", "/generate")' },
          data: { type: 'string', description: 'JSON array of input data (e.g. ["Hello world"])' }
        },
        required: ['repo_id', 'data']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        const subdomain = `${namespace.replace(/\//g, '-')}-${repo}`;
        const apiName = args.api_name || '/predict';
        const payload = typeof args.data === 'string' ? JSON.parse(args.data) : args.data;
        const inputArray = Array.isArray(payload) ? payload : [payload];

        const submitUrl = `https://${subdomain}.hf.space/gradio_api/call${apiName}`;
        const headers = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const submitRes = await fetch(submitUrl, {
          method: 'POST', headers,
          body: JSON.stringify({ data: inputArray })
        });
        if (!submitRes.ok) {
          const errText = await submitRes.text();
          return `❌ API call failed (${submitRes.status}): ${errText.substring(0, 300)}`;
        }
        const submitData = await submitRes.json();
        const eventId = submitData.event_id;
        if (!eventId) return '❌ No event_id returned. The Space may not support API calls.';

        const resultUrl = `https://${subdomain}.hf.space/gradio_api/call${apiName}/${eventId}`;
        for (let attempt = 0; attempt < 30; attempt++) {
          const pollRes = await fetch(resultUrl, { headers });
          const text = await pollRes.text();
          const lines = text.split('\n').filter(l => l.startsWith('data: '));
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            const dataStr = lastLine.replace('data: ', '');
            if (dataStr === '[DONE]') break;
            try {
              const resultData = JSON.parse(dataStr);
              return [
                `✅ **Space API Response** from \`${args.repo_id}${apiName}\``,
                '```json',
                JSON.stringify(resultData, null, 2),
                '```'
              ].join('\n');
            } catch(e) {
              if (text.includes('event: complete')) {
                const dataMatch = text.match(/data:(\[.*?\]|\{.*\})/s);
                if (dataMatch) {
                  return [
                    `✅ **Space API Response** from \`${args.repo_id}${apiName}\``,
                    '```json', dataMatch[1], '```'
                  ].join('\n');
                }
              }
            }
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        return `⏱️ Result still pending after 30s. Check manually at https://${subdomain}.hf.space`;
      }
    },

    hf_inference: {
      description: 'Run inference on a HuggingFace model using the free Inference API.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model ID (e.g. "gpt2", "meta-llama/Llama-3.2-3B-Instruct")' },
          inputs: { type: 'string', description: 'Input text or JSON string of inputs' },
          parameters: { type: 'string', description: 'Optional JSON string of generation parameters (max_length, temperature, etc.)' },
          task: { type: 'string', description: 'Optional task type (e.g. "text-generation", "image-classification", "automatic-speech-recognition")' }
        },
        required: ['model', 'inputs']
      },
      handler: async function(args) {
        const headers = { ...authHeader(), 'Content-Type': 'application/json' };
        const params = args.parameters ? (typeof args.parameters === 'string' ? JSON.parse(args.parameters) : args.parameters) : {};
        let inputData;
        try { inputData = JSON.parse(args.inputs); } catch(e) { inputData = args.inputs; }

        const body = Object.keys(params).length
          ? JSON.stringify({ inputs: inputData, parameters: params })
          : JSON.stringify({ inputs: inputData });

        const url = args.task
          ? `${INFERENCE_API_BASE}/pipeline/${args.task}/${args.model}`
          : `${INFERENCE_API_BASE}/models/${args.model}`;

        const res = await fetch(url, { method: 'POST', headers, body });
        if (!res.ok) {
          let msg = '';
          try { const e = await res.json(); msg = e.error || JSON.stringify(e); } catch(e) { msg = res.statusText; }
          if (res.status === 503 && msg.includes('loading')) {
            const estimated = msg.match(/(\d+)/);
            const time = estimated ? estimated[1] + 's' : 'a moment';
            return `⏳ Model **${args.model}** is loading. Try again in ${time}.`;
          }
          return `❌ Inference failed (${res.status}): ${msg.substring(0, 500)}`;
        }
        const result = await res.json();
        return [
          `🧠 **Inference Result — \`${args.model}\`**`,
          '```json',
          JSON.stringify(result, null, 2),
          '```'
        ].join('\n');
      }
    },

    // ── Repo Info ──────────────────────────────────────────────────────
    hf_repo_info: {
      description: 'Get detailed information about any HF repo (Space, Model, or Dataset).',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/repo-name")' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        const type = repoTypePath(args.type || 'space');
        const info = await hfFetch(`/api/${type}/${namespace}/${repo}`);

        const lines = [
          `**📦 Repo Info:** \`${args.repo_id}\``,
          `**Type:** ${args.type || 'space'}`,
          `**Visibility:** ${info.private ? '🔒 Private' : '🌍 Public'}`,
          `**Likes:** ⭐ ${info.likes || 0}`,
          `**Downloads:** 📥 ${info.downloads || 0}`,
          `**Created:** ${info.createdAt ? new Date(info.createdAt).toLocaleDateString() : 'N/A'}`,
          `**Last Modified:** ${info.lastModified ? new Date(info.lastModified).toLocaleDateString() : 'N/A'}`,
          `**URL:** https://huggingface.co/${args.repo_id}`
        ];
        if (info.sdk) lines.push(`**SDK:** ${info.sdk}`);
        if (info.pipeline_tag) lines.push(`**Pipeline:** ${info.pipeline_tag}`);
        if (info.description) lines.push(`**Description:** ${info.description.substring(0, 300)}`);
        if (info.tags && info.tags.length) lines.push(`**Tags:** ${info.tags.join(', ')}`);
        return lines.join('\n');
      }
    },

    hf_list_files: {
      description: 'List files in a repository at a given path.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space' },
          path: { type: 'string', default: '', description: 'Subdirectory path (optional)' },
          revision: { type: 'string', default: 'main', description: 'Branch/revision' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id';
        const [namespace, repo] = parts;
        const type = repoTypePath(args.type || 'space');
        const rev = args.revision || 'main';
        const path = args.path || '';

// ★ FIX: For root listing, send empty path instead of "/"
        const body = { paths: [path || ''], expand: false };
        const info = await hfFetch(`/api/${type}/${namespace}/${repo}/paths-info/${rev}`, {
          method: 'POST', body: JSON.stringify(body)
        });
        if (!info || !info.length) {
          return `📁 No files found at \`${path || '/'}\` in \`${args.repo_id}\``;
        }
        const lines = [`📁 **Files in** \`${args.repo_id}/${path || ''}\` (${rev}):`, ''];
        info.forEach(f => {
          const icon = f.type === 'directory' ? '📁' : '📄';
          const size = f.size ? ` (${(f.size / 1024).toFixed(1)} KB)` : '';
          lines.push(`${icon} \`${f.path}\`${size}`);
        });
        return lines.join('\n');
      }
},

    // ═══════════════════════════════════════════════════════════════════
    // ★ NEW TOOLS v11 — Added: read_file, file_exists, repo_exists,
    //   list_commits, move_file
    // ═══════════════════════════════════════════════════════════════════

    hf_read_file: {
      description: 'Read the content of a file from ANY HuggingFace repo (Space, Model, or Dataset), including PRIVATE repos.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/my-space")' },
          path: { type: 'string', description: 'File path in the repo (e.g. "app.py", "config.json")' },
          revision: { type: 'string', default: 'main', description: 'Branch/commit revision' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' }
        },
        required: ['repo_id', 'path']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;
        const rev = args.revision || 'main';
        const filePath = args.path;

// Use /raw/ endpoint — works for both public and private repos
        // Auth header is automatically added for private repos
        // Using typePath prefix — Spaces need /spaces/namespace/repo/raw/...
        const typePath = repoTypePath(args.type || 'space');
        const rawPath = `/${typePath}/${namespace}/${repo}/raw/${encodeURIComponent(rev)}/${filePath}`;
        const content = await hfFetchRaw(rawPath);
        const truncated = content.length > 8000 ? content.substring(0, 8000) + '\n\n... (truncated, full length: ' + content.length + ' chars)' : content;
        return [
          `📄 **\`${filePath}\`** from \`${args.repo_id}\` (${rev})`,
          '',
          '```',
          truncated,
          '```',
          '',
          `📊 **File info:** ${content.length} chars, ${new Blob([content]).size} bytes`
        ].join('\n');
      }
    },

    hf_file_exists: {
      description: 'Check if a file exists in a HuggingFace repo (including private repos).',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/my-space")' },
          path: { type: 'string', description: 'File path to check (e.g. "app.py", "requirements.txt")' },
          revision: { type: 'string', default: 'main', description: 'Branch/revision' }
        },
        required: ['repo_id', 'path']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;
        const rev = args.revision || 'main';
        const filePath = args.path;
const typePath = repoTypePath(args.type || 'space');
        const { ok, status } = await hfFetchHead(`/${typePath}/${namespace}/${repo}/raw/${encodeURIComponent(rev)}/${filePath}`);
        if (ok) {
return `✅ **File exists:** \`${filePath}\` in \`${args.repo_id}\` (${rev})`;
        } else if (status === 404) {
          return `❌ **File not found:** \`${filePath}\` does not exist in \`${args.repo_id}\` (${rev})`;
        } else {
          return `⚠️ **Check failed:** HTTP ${status} for \`${filePath}\` in \`${args.repo_id}\``;
        }
      }
    },

    hf_repo_exists: {
      description: 'Check if a HuggingFace repository exists (Space, Model, or Dataset). Works for private repos too.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/my-space")' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;
        const type = repoTypePath(args.type || 'space');

        try {
          const info = await hfFetch(`/api/${type}/${namespace}/${repo}`);
          const vis = info.private ? '🔒 Private' : '🌍 Public';
          return [
            `✅ **Repo exists:** \`${args.repo_id}\``,
            `**Type:** ${args.type || 'space'}`,
            `**Visibility:** ${vis}`,
            `**Likes:** ⭐ ${info.likes || 0}`,
            `**Downloads:** 📥 ${info.downloads || 0}`,
            `**URL:** https://huggingface.co/${args.repo_id}`
          ].join('\n');
        } catch(e) {
          if (e.message.includes('404')) {
            return `❌ **Repo not found:** \`${args.repo_id}\` does not exist.`;
          }
          return `⚠️ **Error checking repo:** ${e.message}`;
        }
      }
    },

    hf_list_commits: {
      description: 'View the commit history of a HuggingFace repository.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/my-space")' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' },
          revision: { type: 'string', default: 'main', description: 'Branch/revision to view commits for' },
          limit: { type: 'number', default: 10, description: 'Max commits to show (1-50)' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;
        const type = repoTypePath(args.type || 'space');
        const rev = args.revision || 'main';
        const limit = Math.min(Math.max(args.limit || 10, 1), 50);

        const commits = await hfFetch(`/api/${type}/${namespace}/${repo}/commits/${encodeURIComponent(rev)}?limit=${limit}`);
        if (!commits || !commits.length) {
          return `📭 No commits found for \`${args.repo_id}\` (${rev})`;
        }
        const lines = [
          `📜 **Recent commits — \`${args.repo_id}\` (${rev})**:`,
          ''
        ];
        commits.forEach((c, i) => {
          const date = c.date ? new Date(c.date).toLocaleString() : 'N/A';
          const shortId = c.id ? c.id.substring(0, 7) : '???????';
          const title = (c.title || c.message || 'No message').substring(0, 100);
          const author = c.author || 'unknown';
          lines.push(`${i+1}. \`${shortId}\` — **${title}**`);
          lines.push(`   👤 ${author} — 🕐 ${date}`);
        });
        return lines.join('\n');
      }
    },

    hf_move_file: {
      description: 'Rename or move a file in a HuggingFace repository.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/my-space")' },
          source_path: { type: 'string', description: 'Current file path (e.g. "old_name.py")' },
          dest_path: { type: 'string', description: 'New file path (e.g. "new_name.py" or "subfolder/new_name.py")' },
          summary: { type: 'string', description: 'Commit message (default: "Move/Rename file")' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' }
        },
        required: ['repo_id', 'source_path', 'dest_path']
      },
      handler: async function(args) {
        const parts = args.repo_id.split('/');
        if (parts.length !== 2) return '❌ Invalid repo_id. Use "namespace/repo-name"';
        const [namespace, repo] = parts;
        const typePath = repoTypePath(args.type || 'space');
        const rev = 'main';

        // The commit API supports rename via oldPath in file entries
        const body = {
          summary: args.summary || `Move ${args.source_path} → ${args.dest_path}`,
          description: '',
          files: [{
            path: args.dest_path,
            oldPath: args.source_path,
            content: null // null content with oldPath = rename
          }]
        };
        await hfFetch(`/api/${typePath}/${namespace}/${repo}/commit/${rev}`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        return [
          `✅ **File moved:** \`${args.source_path}\` → \`${args.dest_path}\` in \`${args.repo_id}\``,
          `📝 ${body.summary}`,
          ``,
          `💡 The Space will rebuild if applicable.`
        ].join('\n');
      }
    }
  };

  // ─── Module Registration ─────────────────────────────────────────────

  const toolList = Object.entries(tools).map(([name, def]) => ({
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
  }));

  ModuleSystem.register('huggingface-hub', {
    name: 'HuggingFace Hub',
    description: 'Full remote control of HuggingFace Spaces and Hub. Create Spaces, upload apps, configure hardware/secrets, run inference, call Gradio APIs, and manage repos — all from the chat.',
    tools: toolList,
    handleToolCall: async function(toolName, args) {
      if (tools[toolName]) {
        try {
          return await tools[toolName].handler(args);
        } catch(e) {
          return `❌ **${toolName} error:** ${e.message}`;
        }
      }
      return null;
    }
  });

  console.log('[HF Module FIXED] Registered with ' + Object.keys(tools).length + ' tools');
})();
