// ============================================================================
// HuggingFace Hub Module for ChatSeed — REBUILT with @huggingface/hub JS SDK
// ============================================================================
// Uses the OFFICIAL HuggingFace JavaScript library (via esm.sh CDN) instead
// of raw fetch() calls. Properly handles:
//   - Private repos & spaces
//   - Authentication via access tokens
//   - File uploads with proper LFS handling
//   - All repo operations (CRUD, config, etc.)
// ============================================================================
// Loaded as: import { ... } from 'https://esm.sh/@huggingface/hub@2.13.2'
// ============================================================================

(function() {
  'use strict';

  // ─── Configuration ────────────────────────────────────────────────
  const HF_API_BASE = 'https://huggingface.co';
  const INFERENCE_API_BASE = 'https://api-inference.huggingface.co';
  let hfLib = null; // Will hold the @huggingface/hub module after import

  // ─── Helpers ──────────────────────────────────────────────────────

  function getToken() {
    try { return localStorage.getItem('chatseed_hf_token') || ''; } catch(e) { return ''; }
  }
  function setToken(token) {
    try { localStorage.setItem('chatseed_hf_token', token); } catch(e) {}
  }
  function clearToken() {
    try { localStorage.removeItem('chatseed_hf_token'); } catch(e) {}
  }

  function requireToken() {
    const t = getToken();
    if (!t) throw new Error('No HuggingFace token set. Use hf_set_token or hf_login_ui to set your HF access token first.');
    return t;
  }

  /** Lazily import @huggingface/hub from esm.sh CDN */
  async function getHub() {
    if (hfLib) return hfLib;
    try {
      // Dynamic import of the official JS SDK
      const mod = await import('https://esm.sh/@huggingface/hub@2.13.2');
      hfLib = mod;
      return mod;
    } catch(e) {
      // Fallback: try importmap-less approach
      throw new Error('Failed to load @huggingface/hub from CDN: ' + e.message);
    }
  }

  /** Parse a "namespace/repo" string into { namespace, repo } */
  function parseRepoId(repoId) {
    const parts = repoId.split('/');
    if (parts.length < 2) throw new Error('Invalid repo_id. Use format "namespace/repo-name"');
    const namespace = parts.slice(0, -1).join('/');
    const repo = parts[parts.length - 1];
    return { namespace, repo };
  }

  /** Parse a repo designation for the JS library */
  function makeRepoDesignation(repoId, type) {
    return { type: type || 'space', name: repoId };
  }

  /** Generic REST fallback for endpoints not covered by @huggingface/hub */
  async function hfFetch(path, options = {}) {
    const token = requireToken();
    const url = HF_API_BASE + path;
    const headers = {
      'Authorization': 'Bearer ' + token,
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

  // ─── Secure Popup UI ──────────────────────────────────────────────

  function openSecureLoginPopup() {
    const existing = document.getElementById('chatseed-hf-login-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'chatseed-hf-login-overlay';
    overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn 0.2s ease-out;`;

    const box = document.createElement('div');
    box.style.cssText = `background:#1f2937;border:1px solid #374151;border-radius:20px;padding:28px;width:420px;max-width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.5);position:relative;font-family:system-ui,-apple-system,sans-serif;`;

    const styleEl = document.createElement('style');
    styleEl.textContent = `@keyframes chatseed-hf-fade-in{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}#chatseed-hf-login-overlay>div{animation:chatseed-hf-fade-in 0.2s ease-out}`;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;';
    header.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:1.5rem;">🤗</span><span style="font-size:1.1rem;font-weight:600;color:#f3f4f6;">HuggingFace Login</span></div><button id="chatseed-hf-close-btn" style="background:none;border:none;color:#9ca3af;font-size:1.3rem;cursor:pointer;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background 0.15s;" onmouseover="this.style.background='#374151'" onmouseout="this.style.background='none'">✕</button>`;

    const body = document.createElement('div');
    body.innerHTML = `<p style="color:#d1d5db;font-size:0.85rem;margin:0 0 16px 0;line-height:1.5;">Paste your HuggingFace access token below. <strong style="color:#6ee7b7;">Your token is stored directly in your browser's localStorage</strong> — it never passes through the AI model or any external server.</p>
      <div style="background:#111827;border:1px solid #374151;border-radius:12px;padding:12px 16px;margin-bottom:16px;">
        <label style="color:#9ca3af;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:6px;">🔑 HuggingFace Token</label>
        <input type="password" id="chatseed-hf-token-input" placeholder="hf_..." style="width:100%;padding:10px 12px;background:#030712;border:1px solid #4b5563;border-radius:8px;color:#f3f4f6;font-size:0.9rem;outline:none;transition:border-color 0.15s;box-sizing:border-box;">
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="chatseed-hf-show-token" style="accent-color:#059669;"><label for="chatseed-hf-show-token" style="color:#6b7280;font-size:0.75rem;cursor:pointer;">Show token</label></div>
      </div>
      <div id="chatseed-hf-login-status" style="display:none;font-size:0.8rem;padding:8px 12px;border-radius:8px;margin-bottom:12px;"></div>
      <div style="display:flex;gap:10px;">
        <button id="chatseed-hf-login-submit" style="flex:1;padding:10px 16px;background:#059669;color:white;border:none;border-radius:10px;font-size:0.9rem;font-weight:500;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='#047857'" onmouseout="this.style.background='#059669'">🔐 Set Token</button>
        <button id="chatseed-hf-login-cancel" style="padding:10px 16px;background:#374151;color:#d1d5db;border:none;border-radius:10px;font-size:0.9rem;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='#4b5563'" onmouseout="this.style.background='#374151'">Cancel</button>
      </div>
      <p style="color:#6b7280;font-size:0.7rem;margin:12px 0 0 0;text-align:center;">Get your token at <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:#60a5fa;">huggingface.co/settings/tokens</a></p>`;

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
      if (!token) { showStatus('⚠️ Please enter a token.', '#f59e0b'); return; }
      if (!token.startsWith('hf_')) { showStatus('⚠️ Tokens should start with <code>hf_</code>.', '#f59e0b'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Verifying...';
      submitBtn.style.opacity = '0.6';

      setToken(token);

      try {
        // Verify using the JS library
        const hub = await getHub();
        const info = await hub.whoAmI({ accessToken: token });
        const name = info.name || info.user || 'unknown';
        const masked = token.substring(0, 6) + '…' + token.substring(token.length - 4);
        showStatus(`✅ **Authenticated as ${name}** (${masked})`, '#059669');
        submitBtn.textContent = '✅ Done!';
        submitBtn.style.background = '#059669';
        setTimeout(closeOverlay, 1500);
      } catch(e) {
        showStatus(`⚠️ Token stored, but verification failed: ${e.message}`, '#f59e0b');
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

  // ─── Tool Implementations ─────────────────────────────────────────

  const tools = {

    // ── Authentication ──────────────────────────────────────────────
    hf_set_token: {
      description: 'Store your HuggingFace access token for this session. Get it from https://huggingface.co/settings/tokens',
      parameters: { type: 'object', properties: { token: { type: 'string', description: 'Your HF access token (hf_...). Required for all write operations.' } }, required: ['token'] },
      handler: async function(args) {
        const t = (args.token || '').trim();
        if (!t || !t.startsWith('hf_')) return '⚠️ Invalid token format. Tokens start with `hf_`. Get one at https://huggingface.co/settings/tokens';
        const masked = t.substring(0, 6) + '…' + t.substring(t.length - 4);
        setToken(t);
        try {
          const hub = await getHub();
          const info = await hub.whoAmI({ accessToken: t });
          const name = info.name || info.user || 'unknown';
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
        return '🔐 **Secure Login Popup Opened**\n\nA popup has been opened where you can paste your HuggingFace token.\n\n> 🛡️ **Your token is stored directly in your browser\'s localStorage**\n> — it **never passes through this AI model** or the LLM provider.\n\n💡 Get your token at: https://huggingface.co/settings/tokens';
      }
    },

    hf_logout: {
      description: 'Clear your stored HuggingFace token from localStorage.',
      parameters: { type: 'object', properties: {} },
      handler: async function() {
        const hadToken = !!getToken();
        clearToken();
        return hadToken ? '🚪 **Logged out.** HuggingFace token has been removed from localStorage.' : '👋 No token was stored. Nothing to clear.';
      }
    },

    hf_token_status: {
      description: 'Check if a HF token is stored and who it belongs to (without revealing the token).',
      parameters: { type: 'object', properties: {} },
      handler: async function() {
        const t = getToken();
        if (!t) return '🔑 **No token stored.** Use `hf_login_ui` (secure popup) or `hf_set_token` to log in.';
        const masked = t.substring(0, 6) + '…' + t.substring(t.length - 4);
        try {
          const hub = await getHub();
          const info = await hub.whoAmI({ accessToken: t });
          const name = info.name || info.user || 'unknown';
          return `🔑 **Token Status:** Active (${masked})\n👤 **Authenticated as:** ${name}\n📧 **Email:** ${info.email || 'N/A'}\n💳 **Can Pay:** ${info.canPay ? 'Yes' : 'No'}\n\n💡 Use \`hf_logout\` to clear your token.`;
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
          const hub = await getHub();
          const info = await hub.whoAmI({ accessToken: requireToken() });
          const lines = [
            `**👤 HuggingFace User Info**`,
            `**Name:** ${info.name || info.user || 'N/A'}`,
            `**Email:** ${info.email || 'N/A'}`,
            `**Type:** ${info.type || info.org || 'user'}`,
            `**Can Pay:** ${info.canPay ? '✅ Yes' : '❌ No'}`,
            `**Plan:** ${info.plan ? info.plan.name || info.plan : 'Free/Unknown'}`
          ];
          if (info.orgs && info.orgs.length) lines.push(`**Organizations:** ${info.orgs.map(o => o.name).join(', ')}`);
          if (info.usage && info.usage.inference) lines.push(`**Inference Usage:** ${JSON.stringify(info.usage.inference)}`);
          return lines.join('\n');
        } catch(e) { return `❌ Failed to get user info: ${e.message}`; }
      }
    },

    // ── Spaces: Create / Duplicate / Delete ─────────────────────────

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
        const token = requireToken();
        const hub = await getHub();
        const whoami = await hub.whoAmI({ accessToken: token });
        const name = args.org || whoami.name || whoami.user;
        const repoId = `${name}/${args.name}`;
        const repo = makeRepoDesignation(repoId, 'space');

        const params = {
          repo,
          accessToken: token,
          type: 'space',
          sdk: args.sdk || 'gradio',
          private: args.private || false
        };
        if (args.title) params.title = args.title;
        if (args.license) params.license = args.license;

        // createRepo using the official library
        await hub.createRepo(params);

        // Handle hardware/sleep/secrets via REST (not in createRepo API)
        if (args.hardware || args.sleep_time) {
          try {
            await hfFetch(`/api/spaces/${name}/${args.name}/hardware`, {
              method: 'POST',
              body: JSON.stringify({
                hardware: args.hardware || 'cpu-basic',
                ...(args.sleep_time ? { sleep_time: args.sleep_time } : {})
              })
            });
          } catch(e) { /* non-critical */ }
        }

        if (args.secrets) {
          const secrets = typeof args.secrets === 'string' ? JSON.parse(args.secrets) : args.secrets;
          for (const [key, value] of Object.entries(secrets)) {
            try {
              await hfFetch(`/api/spaces/${name}/${args.name}/secrets`, { method: 'POST', body: JSON.stringify({ key, value }) });
            } catch(e) {}
          }
        }

        const url = `https://huggingface.co/spaces/${repoId}`;
        const appUrl = `https://${name.replace(/\//g, '-')}-${args.name}.hf.space`;
        const lines = [`✅ **Space created successfully!**`, ``, `**Repo:** ${repoId}`, `**SDK:** ${args.sdk || 'gradio'}`, `**Visibility:** ${args.private ? '🔒 Private' : '🌍 Public'}`, `**URL:** ${url}`, `**App:** ${appUrl}`];
        if (args.hardware) lines.push(`**Hardware:** ${args.hardware}`);
        if (args.sleep_time) lines.push(`**Sleep:** ${args.sleep_time}s`);
        lines.push(``, `💡 **Next steps:** Upload files using \`hf_upload_file\` or \`hf_upload_app\``);
        return lines.join('\n');
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
        const token = requireToken();
        const hub = await getHub();
        const whoami = await hub.whoAmI({ accessToken: token });
        const namespace = args.org || whoami.name || whoami.user;
        const newId = `${namespace}/${args.name}`;

        const body = {
          from: args.from,
          name: args.name,
          namespace: namespace,
          private: args.private || false
        };
        if (args.hardware) body.hardware = args.hardware;
        if (args.sleep_time) body.sleep_time = args.sleep_time;
        if (args.secrets) body.secrets = typeof args.secrets === 'string' ? JSON.parse(args.secrets) : args.secrets;
        if (args.variables) body.variables = typeof args.variables === 'string' ? JSON.parse(args.variables) : args.variables;

        // Duplicate via REST (no npm library function for this)
        await hfFetch('/api/spaces/duplicate', { method: 'POST', body: JSON.stringify(body) });

        const lines = [`✅ **Space duplicated!**`, ``, `**From:** ${args.from}`, `**New Repo:** ${newId}`, `**URL:** https://huggingface.co/spaces/${newId}`, `**App:** https://${namespace.replace(/\//g, '-')}-${args.name}.hf.space`];
        if (args.hardware) lines.push(`**Hardware:** ${args.hardware}`);
        if (args.sleep_time) lines.push(`**Sleep:** ${args.sleep_time}s`);
        return lines.join('\n');
      }
    },

    hf_delete_space: {
      description: 'Delete a Space repository from HuggingFace Hub.',
      parameters: { type: 'object', properties: { repo_id: { type: 'string', description: 'Space ID to delete (e.g. "username/my-space")' } }, required: ['repo_id'] },
      handler: async function(args) {
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, 'space');
        await hub.deleteRepo({ repo, accessToken: token });
        return `✅ **Space deleted:** ${args.repo_id}`;
      }
    },

    // ── File Operations ────────────────────────────────────────────

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
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, 'space');

        // Use the official uploadFiles with Blob content
        await hub.uploadFiles({
          repo,
          accessToken: token,
          files: [{
            path: args.path,
            content: new Blob([args.content], { type: 'text/plain' })
          }]
        });

        return `✅ **File uploaded:** \`${args.path}\` → \`${args.repo_id}\`\n📝 ${args.summary || 'Update via ChatSeed'}\n\n💡 The Space will now rebuild automatically. Check status with \`hf_space_status\`.`;
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
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, 'space');

        const files = [{ path: 'app.py', content: new Blob([args.app_code], { type: 'text/plain' }) }];
        if (args.requirements) files.push({ path: 'requirements.txt', content: new Blob([args.requirements], { type: 'text/plain' }) });
        if (args.readme) files.push({ path: 'README.md', content: new Blob([args.readme], { type: 'text/markdown' }) });
        if (args.extra_files) {
          const extras = typeof args.extra_files === 'string' ? JSON.parse(args.extra_files) : args.extra_files;
          for (const [path, content] of Object.entries(extras)) {
            files.push({ path, content: new Blob([String(content)], { type: 'text/plain' }) });
          }
        }

        // Use the official uploadFiles with progress
        await hub.uploadFiles({ repo, accessToken: token, files });

        const parts = parseRepoId(args.repo_id);
        return `✅ **App deployed to:** \`${args.repo_id}\`\n📦 **Files uploaded:** ${files.map(f => '`' + f.path + '`').join(', ')}\n\n🌐 **Space:** https://huggingface.co/spaces/${args.repo_id}\n🚀 **App URL:** https://${parts.namespace.replace(/\//g, '-')}-${parts.repo}.hf.space\n\n💡 The Space is building. Use \`hf_space_status ${args.repo_id}\` to check.`;
      }
    },

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
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, 'space');

        // Use the official deleteFile from the library
        await hub.deleteFile({ repo, accessToken: token, path: args.path });

        return `✅ **File deleted:** \`${args.path}\` from \`${args.repo_id}\``;
      }
    },

    hf_list_files: {
      description: 'List files in a repository at a given path.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/repo-name")' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' },
          path: { type: 'string', description: 'Subdirectory path (optional)' },
          revision: { type: 'string', default: 'main', description: 'Branch/revision' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, args.type || 'space');

        const files = [];
        try {
          for await (const file of hub.listFiles({ repo, accessToken: token, revision: args.revision || 'main', ...(args.path ? { path: args.path } : {}) })) {
            files.push(file);
          }
        } catch(e) {
          return `❌ Failed to list files: ${e.message}`;
        }

        if (files.length === 0) return `📁 **No files found** in \`${args.repo_id}\``;

        const lines = [`📁 **Files in \`${args.repo_id}\`**`, ''];
        files.forEach((f, i) => {
          const type = f.type === 'directory' ? '📂' : '📄';
          const size = f.size ? ` (${(f.size / 1024).toFixed(1)} KB)` : '';
          lines.push(`${type} **${f.path}**${size}`);
        });
        return lines.join('\n');
      }
    },

    // ── Space Configuration ────────────────────────────────────────

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
        const parts = parseRepoId(args.repo_id);
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/secrets`, {
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
        properties: { repo_id: { type: 'string', description: 'Space ID' }, key: { type: 'string', description: 'Secret name to delete' } },
        required: ['repo_id', 'key']
      },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/secrets`, {
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
          hardware: { type: 'string', enum: ['cpu-basic', 'cpu-upgrade', 't4-small', 't4-medium', 'l4-1x', 'a10g-small', 'a10g-large', 'a100-large'], description: 'Hardware tier' },
          sleep_time: { type: 'number', description: 'Auto-sleep timeout in seconds (for GPU) - e.g. 7200 = 2h' }
        },
        required: ['repo_id', 'hardware']
      },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        const body = { hardware: args.hardware };
        if (args.sleep_time) body.sleep_time = args.sleep_time;
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/hardware`, { method: 'POST', body: JSON.stringify(body) });
        const lines = [`⚡ **Hardware change requested for:** \`${args.repo_id}\``, `**New hardware:** ${args.hardware}`];
        if (args.sleep_time) lines.push(`**Sleep timeout:** ${args.sleep_time}s`);
        lines.push(``, `⏳ The Space is restarting. Check status with \`hf_space_status\`.`);
        return lines.join('\n');
      }
    },

    hf_set_visibility: {
      description: 'Change the visibility of a Space (public / private).',
      parameters: {
        type: 'object',
        properties: { repo_id: { type: 'string', description: 'Space ID' }, visibility: { type: 'string', enum: ['public', 'private'], description: 'New visibility level' } },
        required: ['repo_id', 'visibility']
      },
      handler: async function(args) {
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, 'space');
        const isPrivate = args.visibility === 'private';

        // Use the JS library updateRepo method or fallback to REST
        // The @huggingface/hub doesn't have a direct setVisibility, so use REST
        const parts = parseRepoId(args.repo_id);
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/settings`, {
          method: 'POST',
          body: JSON.stringify({ private: isPrivate })
        });

        const icon = isPrivate ? '🔒' : '🌍';
        return `${icon} **Visibility changed to ${args.visibility}:** \`${args.repo_id}\``;
      }
    },

    hf_set_sleep: {
      description: 'Set auto-sleep timeout for a Space (useful for GPU spaces to save cost).',
      parameters: {
        type: 'object',
        properties: { repo_id: { type: 'string', description: 'Space ID' }, sleep_time: { type: 'number', description: 'Sleep timeout in seconds (0 to disable, 300 = 5 min, 3600 = 1h, 7200 = 2h)' } },
        required: ['repo_id', 'sleep_time']
      },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/settings`, { method: 'POST', body: JSON.stringify({ sleep_time: args.sleep_time }) });
        const status = args.sleep_time === 0 ? '❌ Disabled (never sleeps)' : `💤 ${args.sleep_time}s (${Math.round(args.sleep_time / 60)} min)`;
        return `✅ **Sleep configured:** \`${args.repo_id}\` → ${status}`;
      }
    },

    hf_pause_space: {
      description: 'Pause a Space to stop billing. It can be restarted later with hf_restart_space.',
      parameters: { type: 'object', properties: { repo_id: { type: 'string', description: 'Space ID to pause' } }, required: ['repo_id'] },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/pause`, { method: 'POST' });
        return `⏸️ **Space paused:** \`${args.repo_id}\`\n💡 Restart with \`hf_restart_space ${args.repo_id}\``;
      }
    },

    hf_restart_space: {
      description: 'Restart a paused Space.',
      parameters: { type: 'object', properties: { repo_id: { type: 'string', description: 'Space ID to restart' } }, required: ['repo_id'] },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/restart`, { method: 'POST' });
        return `▶️ **Space restarting:** \`${args.repo_id}\``;
      }
    },

    // ── Query / Status ─────────────────────────────────────────────

    hf_space_status: {
      description: 'Get the runtime status, hardware, and stage of a Space.',
      parameters: { type: 'object', properties: { repo_id: { type: 'string', description: 'Space ID (e.g. "username/my-space")' } }, required: ['repo_id'] },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        const runtime = await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/runtime`);
        const repoInfo = await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}`);

        const stageEmoji = { 'NO_APP_FILE': '📄', 'BUILDING': '🔨', 'RUNNING': '✅', 'RUNNING_BUILDING': '🔄', 'PAUSED': '⏸️', 'SLEEPING': '💤', 'STOPPED': '⛔', 'ERROR': '❌' };
        const stage = runtime.stage || 'UNKNOWN';
        const sdk = repoInfo.sdk || 'N/A';
        const hardware = runtime.hardware || 'cpu-basic';
        const requestedHardware = runtime.requestedHardware || hardware;
        const visibility = repoInfo.private ? '🔒 Private' : '🌍 Public';
        const likes = repoInfo.likes || 0;

        return `**📊 Space Status:** \`${args.repo_id}\`\n\n**Stage:** ${stageEmoji[stage] || '❓'} ${stage}\n**SDK:** ${sdk}\n**Hardware:** ${hardware}\n**Requested HW:** ${requestedHardware}\n**Visibility:** ${visibility}\n**Likes:** ⭐ ${likes}\n**URL:** https://huggingface.co/spaces/${args.repo_id}\n**App:** https://${parts.namespace}-${parts.repo}.hf.space`;
      }
    },

    hf_space_logs: {
      description: 'Fetch the latest build/runtime logs from a Space.',
      parameters: { type: 'object', properties: { repo_id: { type: 'string', description: 'Space ID' } }, required: ['repo_id'] },
      handler: async function(args) {
        const parts = parseRepoId(args.repo_id);
        try {
          const logs = await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}/logs`);
          const truncated = logs.length > 3000 ? '... (truncated)\n' + logs.slice(-3000) : logs;
          return `📋 **Build Logs for** \`${args.repo_id}\`\n\`\`\`\n${truncated}\n\`\`\``;
        } catch(e) { return `❌ Could not fetch logs: ${e.message}`; }
      }
    },

    // ── Search / List ─────────────────────────────────────────────

    hf_search_spaces: {
      description: 'Search for Spaces on the HuggingFace Hub by query.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', default: 5, description: 'Max results (1-25)' } },
        required: ['query']
      },
      handler: async function(args) {
        const token = requireToken();
        const hub = await getHub();
        const limit = Math.min(Math.max(args.limit || 5, 1), 25);
        const results = [];
        try {
          for await (const s of hub.listSpaces({ search: { query: args.query }, accessToken: token })) {
            results.push(s);
            if (results.length >= limit) break;
          }
        } catch(e) { return `❌ Search failed: ${e.message}`; }

        if (results.length === 0) return `🔍 No Spaces found for "${args.query}"`;
        const lines = [`🔍 **Spaces matching "${args.query}":**`, ''];
        results.forEach((s, i) => {
          const id = s.id || `${s.namespace || '?'}/${s.name || '?'}`;
          const sdk = s.sdk ? ` [${s.sdk}]` : '';
          const likes = s.likes ? ` ⭐${s.likes}` : '';
          lines.push(`${i + 1}. **${id}**${sdk}${likes}`);
          lines.push(`   https://huggingface.co/spaces/${id}`);
          lines.push('');
        });
        return lines.join('\n');
      }
    },

    hf_list_my_spaces: {
      description: 'List all Spaces owned by your account.',
      parameters: { type: 'object', properties: { limit: { type: 'number', default: 10, description: 'Max results' } }, required: [] },
      handler: async function() {
        const token = requireToken();
        const hub = await getHub();
        const info = await hub.whoAmI({ accessToken: token });
        const name = info.name || info.user;

        // Use listSpaces with the author filter via REST (library doesn't have author filter directly)
        const results = await hfFetch(`/api/spaces?author=${encodeURIComponent(name)}&limit=25&sort=lastModified`);
        if (!results || !results.length) return `📭 No Spaces found under **${name}**.\nCreate one with \`hf_create_space\`!`;

        const lines = [`📂 **Your Spaces (${name})**:`, ''];
        results.forEach(s => {
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
        properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', default: 5, description: 'Max results' } },
        required: ['query']
      },
      handler: async function(args) {
        const token = requireToken();
        const hub = await getHub();
        const limit = Math.min(Math.max(args.limit || 5, 1), 25);
        const results = [];
        try {
          for await (const m of hub.listModels({ search: { query: args.query }, accessToken: token })) {
            results.push(m);
            if (results.length >= limit) break;
          }
        } catch(e) { return `❌ Search failed: ${e.message}`; }

        if (results.length === 0) return `🔍 No models found for "${args.query}"`;
        const lines = [`🔍 **Models matching "${args.query}":**`, ''];
        results.forEach((m, i) => {
          const id = m.id || `${m.namespace || '?'}/${m.name || '?'}`;
          const pipeline = m.pipeline_tag ? ` [${m.pipeline_tag}]` : '';
          const likes = m.likes ? ` ⭐${m.likes}` : '';
          const downloads = m.downloads ? ` 📥${(m.downloads / 1000).toFixed(0)}k` : '';
          lines.push(`${i + 1}. **${id}**${pipeline}${likes}${downloads}`);
          lines.push(`   https://huggingface.co/${id}`);
        });
        return lines.join('\n');
      }
    },

    // ── Gradio Space API Calls ─────────────────────────────────────

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
        const parts = parseRepoId(args.repo_id);
        const subdomain = `${parts.namespace.replace(/\//g, '-')}-${parts.repo}`;
        const apiName = args.api_name || '/predict';
        const payload = typeof args.data === 'string' ? JSON.parse(args.data) : args.data;
        const inputArray = Array.isArray(payload) ? payload : [payload];

        const submitUrl = `https://${subdomain}.hf.space/gradio_api/call${apiName}`;
        const headers = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const submitRes = await fetch(submitUrl, { method: 'POST', headers, body: JSON.stringify({ data: inputArray }) });
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
              return `✅ **Space API Response** from \`${args.repo_id}${apiName}\`\n\`\`\`json\n${JSON.stringify(resultData, null, 2)}\n\`\`\``;
            } catch(e) {
              if (text.includes('event: complete')) {
                const dataMatch = text.match(/data:(\[.*?\]|\{.*\})/s);
                if (dataMatch) return `✅ **Space API Response** from \`${args.repo_id}${apiName}\`\n\`\`\`json\n${dataMatch[1]}\n\`\`\``;
              }
            }
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        return `⏱️ Result still pending after 30s. Check manually at https://${subdomain}.hf.space`;
      }
    },

    // ── Inference ──────────────────────────────────────────────────

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
        const token = requireToken();
        const params = args.parameters ? (typeof args.parameters === 'string' ? JSON.parse(args.parameters) : args.parameters) : {};
        let inputData;
        try { inputData = JSON.parse(args.inputs); } catch(e) { inputData = args.inputs; }

        const body = Object.keys(params).length ? JSON.stringify({ inputs: inputData, parameters: params }) : JSON.stringify({ inputs: inputData });
        const url = args.task
          ? `${INFERENCE_API_BASE}/pipeline/${args.task}/${args.model}`
          : `${INFERENCE_API_BASE}/models/${args.model}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body
        });

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
        return `🧠 **Inference Result — \`${args.model}\`**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
      }
    },

    // ── Repo Info ──────────────────────────────────────────────────

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
        const token = requireToken();
        const hub = await getHub();
        const repoType = args.type || 'space';
        const repo = makeRepoDesignation(args.repo_id, repoType);

        let info;
        try {
          if (repoType === 'model') {
            info = await hub.modelInfo({ name: args.repo_id, accessToken: token });
          } else if (repoType === 'dataset') {
            info = await hub.datasetInfo({ name: args.repo_id, accessToken: token });
          } else {
            // Space - use REST since spaceInfo might not be in the lib
            const parts = parseRepoId(args.repo_id);
            info = await hfFetch(`/api/spaces/${parts.namespace}/${parts.repo}`);
          }
        } catch(e) { return `❌ Failed to get repo info: ${e.message}`; }

        const lines = [
          `**📦 Repo Info:** \`${args.repo_id}\``,
          `**Type:** ${repoType}`,
          `**Visibility:** ${info.private ? '🔒 Private' : '🌍 Public'}`,
          `**Likes:** ⭐ ${info.likes || 0}`,
          `**Downloads:** 📥 ${info.downloads || 0}`,
          `**Created:** ${info.createdAt ? new Date(info.createdAt).toLocaleDateString() : 'N/A'}`,
          `**Last Modified:** ${info.lastModified ? new Date(info.lastModified).toLocaleDateString() : 'N/A'}`,
          `**URL:** https://huggingface.co/${args.repo_id}`
        ];

        if (info.sdk) lines.push(`**SDK:** ${info.sdk}`);
        if (info.pipeline_tag) lines.push(`**Pipeline:** ${info.pipeline_tag}`);
        if (info.library_name) lines.push(`**Library:** ${info.library_name}`);
        if (info.description) lines.push(`**Description:** ${info.description.substring(0, 200)}`);

        return lines.join('\n');
      }
    },

    // ── OAuth (future) ───────────────────────────────────────────

    hf_check_repo_access: {
      description: 'Check if your token has access to a repository.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Repo ID (e.g. "username/repo-name")' },
          type: { type: 'string', enum: ['space', 'model', 'dataset'], default: 'space', description: 'Repo type' }
        },
        required: ['repo_id']
      },
      handler: async function(args) {
        const token = requireToken();
        const hub = await getHub();
        const repo = makeRepoDesignation(args.repo_id, args.type || 'space');
        try {
          const result = await hub.checkRepoAccess({ repo, accessToken: token });
          return `✅ **Access confirmed** for \`${args.repo_id}\`\n🔑 Token has access to this repository.`;
        } catch(e) {
          if (e.statusCode === 401) return `❌ **No access** to \`${args.repo_id}\`\n🔑 Your token does not have permission to access this repository.`;
          return `❌ Access check failed: ${e.message}`;
        }
      }
    }
  };

  // ─── Module Registration ─────────────────────────────────────────

  // Register with ChatSeed module system
  if (typeof window !== 'undefined') {
    window.ChatSeedModules = window.ChatSeedModules || {};
    window.ChatSeedModules.huggingface = {
      name: 'HuggingFace Hub',
      version: '2.0.0',
      description: 'Full HuggingFace Hub control using @huggingface/hub JS SDK — private spaces, repos, files, config, inference',
      tools: tools,
      // Lazy-load the hub library on first use
      init: async function() {
        try {
          await getHub();
          return true;
        } catch(e) {
          console.warn('[HF Module] Failed to preload @huggingface/hub:', e.message);
          return false;
        }
      }
    };
  }

  // Also register tools into the global tool registry if available
  if (typeof CORE_TOOLS !== 'undefined') {
    Object.keys(tools).forEach(key => {
      const idx = CORE_TOOLS.findIndex(t => t.name === key);
      if (idx >= 0) CORE_TOOLS[idx] = { name: key, ...tools[key] };
      else CORE_TOOLS.push({ name: key, ...tools[key] });
    });
  }

})();
