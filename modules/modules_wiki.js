/**
 * ChatSeed Wiki Module
 * =====================
 * Self-contained browser module for persistent, auto-improving knowledge.
 * 
 * Features:
 *   - IndexedDB-backed wiki pages with hook-based activation
 *   - Auto-loads relevant pages into AI context based on keywords/tool usage
 *   - Build loop runs after conversations to extract + consolidate knowledge
 *   - Separate training model configurable via UI
 *   - Full control panel with page browser, stats, and settings
 * 
 * Integration:
 *   - Registers with ModuleSystem (wiki_search + wiki_read as AI-callable tools)
 *   - Hooks into ModuleSystem.getContext() for auto-injection
 *   - Hooks into ModuleSystem.onResponse() for the build loop
 *   - [📚 Wiki] name in accordion opens the wiki control panel
 * 
 * License: MIT
 */

(function () {
  'use strict';

  // ===========================================================================
  // SECTION 1: CONSTANTS & DEFAULTS
  // ===========================================================================

  const DB_NAME = 'chatseed_wiki';
  const DB_VERSION = 1;
  const WIKI_BUTTON_HTML = '📚';
  const WIKI_BUTTON_LABEL = 'Wiki';
  const MAX_AUTO_LOAD_PAGES = 3;
  const DEFAULT_TRAIN_PROVIDER = 'openrouter';
  const DEFAULT_TRAIN_MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';

  // Seed pages — created on first ever load
  const SEED_PAGES = [
    {
      title: 'core/personality.md',
      content: `# Personality & Identity

I am ChatSeed — a helpful, thoughtful AI assistant designed to be clear, concise, and practical.

## Core Values

- **Clarity**: I explain things simply without being patronizing
- **Precision**: I give accurate, well-reasoned answers
- **Usefulness**: I focus on what actually helps the user
- **Honesty**: I say when I don't know something

## Communication Style

- I use markdown formatting for structured responses
- I break complex topics into digestible parts
- I ask clarifying questions when the user's intent is unclear
- I cite sources when using external information

## Guiding Principles

1. First, understand the problem before proposing a solution
2. Prefer practical examples over abstract theory
3. When unsure, I state my confidence level
4. I learn from mistakes and acknowledge them`,
      hooks: ['always'],
      category: 'core',
      summary: 'Core identity, communication style, and guiding principles',
      relevance: 1.0
    },
    {
      title: 'core/skills.md',
      content: `# Master Operational Skills

## How I Approach Tasks

1. **Understand** — Parse the user's request carefully
2. **Plan** — Identify which tools and knowledge I need
3. **Execute** — Use tools effectively, one step at a time
4. **Verify** — Check results before presenting
5. **Reflect** — What can I learn from this interaction?

## Tool Usage Principles

- Always read tool documentation/guidance from wiki when available
- For web searches, use specific, well-structured queries
- For code: explain what the code does, not just show it
- Chain tools when needed — one tool's output feeds the next

## Handling Uncertainty

- If I lack a tool for a task, I say so clearly
- If information might be outdated, I note the limitation
- I ask permission before making significant changes`,
      hooks: ['always'],
      category: 'core',
      summary: 'Master operational skills and approach to tasks',
      relevance: 1.0
    },
    {
      title: 'tool/evolve_self.md',
      content: `# Evolve Self Tool Guide

The evolve_self tool is for reading, writing, editing, and analyzing source code in the ScratchPad.

## Best Practices

- Always use \`list_files\` first to see what's available
- Use \`read_file\` to view existing files before editing
- For small changes, use \`edit_file\` with old_string → new_string
- For new files or major rewrites, use \`write_file\`
- Always set a descriptive "description" parameter so actions are logged

## When to Use

- Creating new project files
- Refactoring existing code
- Reading source code to understand a project
- Writing documentation or planning files in .md format

## Pitfalls

- File paths are case-sensitive
- \`write_file\` overwrites existing content entirely
- \`edit_file\` only replaces the FIRST occurrence`,
      hooks: ['tool:evolve_self', 'keyword:code', 'keyword:file', 'keyword:source'],
      category: 'tool',
      summary: 'Best practices for using the evolve_self code tool',
      relevance: 0.85
    },
    {
      title: 'tool/web_search.md',
      content: `# Web Search Guide

The web_search tool searches the internet using a browser-based search API.

## Best Practices

1. **Be specific** — "Python 3.12 async comprehension syntax" beats "python async stuff"
2. **Use multiple queries** — One narrow query then a broader one if needed
3. **Scrape key pages** — Use scrape_web for pages that look promising
4. **Verify from multiple sources** — Don't trust a single result

## Query Patterns

- For docs: "framework_name feature_name documentation"
- For solutions: "problem description fix solution error"
- For comparisons: "technique_A vs technique_B comparison"
- For latest: add "2024" or "2025" for recency

## When NOT to search

- When the answer is well-known and I'm confident
- For code generation that doesn't need external reference
- When the user is clearly asking for my own reasoning`,
      hooks: ['tool:search_web', 'tool:scrape_web', 'keyword:search', 'keyword:find', 'keyword:look up', 'keyword:research', 'keyword:latest', 'action:research'],
      category: 'tool',
      summary: 'Best practices for web searching and research',
      relevance: 0.90
    }
  ];

  // ===========================================================================
  // SECTION 2: INDEXEDDB WRAPPER
  // ===========================================================================

  class WikiDB {
    constructor() {
      this.db = null;
      this.ready = false;
    }

    async open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // Pages store
          if (!db.objectStoreNames.contains('pages')) {
            const store = db.createObjectStore('pages', { keyPath: 'title' });
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('relevance', 'relevance', { unique: false });
            store.createIndex('hooks', 'hooks', { unique: false, multiEntry: true });
            store.createIndex('updated', 'updated', { unique: false });
          }

          // Config store (single key)
          if (!db.objectStoreNames.contains('config')) {
            db.createObjectStore('config', { keyPath: 'key' });
          }

          // Build logs
          if (!db.objectStoreNames.contains('build_log')) {
            const store = db.createObjectStore('build_log', { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          this.ready = true;

          // Handle version change (e.g., another tab updated DB)
          this.db.onversionchange = () => {
            this.db.close();
          };

          resolve();
        };

        request.onerror = (event) => {
          console.error('[WikiDB] Open error:', event.target.error);
          reject(event.target.error);
        };
      });
    }

    _ensureOpen() {
      if (!this.ready || !this.db) {
        throw new Error('[WikiDB] Database not initialized. Call open() first.');
      }
    }

    _getStore(name, mode = 'readonly') {
      this._ensureOpen();
      const tx = this.db.transaction(name, mode);
      return tx.objectStore(name);
    }

    // ── Pages CRUD ──

    async getAllPages(includeArchived = false) {
      const store = this._getStore('pages');
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          let pages = request.result || [];
          if (!includeArchived) {
            pages = pages.filter(p => p.category !== 'archive');
          }
          resolve(pages);
        };
        request.onerror = () => reject(request.error);
      });
    }

    async getPage(title) {
      const store = this._getStore('pages');
      return new Promise((resolve, reject) => {
        const request = store.get(title);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async putPage(page) {
      const store = this._getStore('pages', 'readwrite');
      return new Promise((resolve, reject) => {
        // Ensure timestamps
        const now = new Date().toISOString();
        if (!page.created) page.created = now;
        page.updated = now;

        const request = store.put(page);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async deletePage(title) {
      const store = this._getStore('pages', 'readwrite');
      return new Promise((resolve, reject) => {
        const request = store.delete(title);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    async archivePage(title) {
      const page = await this.getPage(title);
      if (page) {
        page.category = 'archive';
        page.relevance = Math.min(page.relevance, 0.1);
        await this.putPage(page);
      }
      return page;
    }

    async searchPages(query) {
      const all = await this.getAllPages(false);
      const q = query.toLowerCase();
      return all.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        (p.hooks || []).some(h => h.toLowerCase().includes(q)) ||
        p.content.toLowerCase().includes(q)
      ).sort((a, b) => b.relevance - a.relevance);
    }

    async getPagesByHooks(matchedHooks, limit = MAX_AUTO_LOAD_PAGES) {
      const all = await this.getAllPages(false);
      const scored = [];

      for (const page of all) {
        const pageHooks = page.hooks || [];
        let score = 0;

        // 'always' pages get max score
        if (pageHooks.includes('always')) {
          score = 10;
        } else {
          for (const hook of pageHooks) {
            if (matchedHooks.includes(hook)) {
              // Weighted score: keyword < tool < intent < always
              if (hook.startsWith('tool:')) score += 3;
              else if (hook.startsWith('intent:')) score += 2.5;
              else if (hook.startsWith('action:')) score += 2;
              else if (hook.startsWith('user:')) score += 2;
              else if (hook.startsWith('keyword:')) score += 1;
              else score += 1;
            }
          }
        }

        if (score > 0) {
          // Multiply by relevance (relevance 0.0–1.0 acts as confidence multiplier)
          scored.push({
            page,
            score: score * page.relevance
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map(s => s.page);
    }

    // ── Config ──

    async getConfig() {
      const store = this._getStore('config');
      return new Promise((resolve, reject) => {
        const request = store.get('main');
        request.onsuccess = () => {
          const config = request.result || { key: 'main' };
          // Merge with defaults
          const defaults = {
            build_enabled: true,
            build_frequency: 'every',
            build_interval: 3,
            train_provider: DEFAULT_TRAIN_PROVIDER,
            train_model: DEFAULT_TRAIN_MODEL,
            max_pages: 50,
            max_page_size: 8192,
            relevance_decay: 0.01,
            archive_threshold: 0.15,
            auto_trigger: true,
            show_loaded_badge: true,
            show_notifications: false,
            total_builds: 0,
            total_build_cost: 0,
            last_build: null
          };
          resolve({ ...defaults, ...config });
        };
        request.onerror = () => reject(request.error);
      });
    }

    async saveConfig(partial) {
      const store = this._getStore('config', 'readwrite');
      return new Promise((resolve, reject) => {
        const getReq = store.get('main');
        getReq.onsuccess = () => {
          const existing = getReq.result || { key: 'main' };
          const updated = { ...existing, ...partial, key: 'main' };
          const putReq = store.put(updated);
          putReq.onsuccess = () => resolve(updated);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    }

    // ── Build Logs ──

    async addBuildLog(log) {
      const store = this._getStore('build_log', 'readwrite');
      return new Promise((resolve, reject) => {
        const request = store.put(log);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    async getBuildLogs(limit = 20) {
      const store = this._getStore('build_log');
      const index = store.index('timestamp');
      return new Promise((resolve, reject) => {
        const request = index.openCursor(null, 'prev');
        const logs = [];
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && logs.length < limit) {
            logs.push(cursor.value);
            cursor.continue();
          } else {
            resolve(logs);
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    // ── Stats ──

    async getStats() {
      const all = await this.getAllPages(true);
      const active = all.filter(p => p.category !== 'archive');
      const archived = all.filter(p => p.category === 'archive');
      const config = await this.getConfig();
      const logs = await this.getBuildLogs(5);
      const totalSize = all.reduce((acc, p) => acc + (p.content ? p.content.length : 0), 0);

      return {
        total_pages: all.length,
        active_pages: active.length,
        archived_pages: archived.length,
        total_size_bytes: totalSize,
        by_category: {
          core: active.filter(p => p.category === 'core').length,
          tool: active.filter(p => p.category === 'tool').length,
          concept: active.filter(p => p.category === 'concept').length,
          skill: active.filter(p => p.category === 'skill').length,
          pref: active.filter(p => p.category === 'pref').length
        },
        total_builds: config.total_builds || 0,
        total_build_cost: config.total_build_cost || 0,
        last_build: config.last_build,
        recent_builds: logs
      };
    }

    // ── Seed on first load ──

    async seedIfEmpty() {
      const all = await this.getAllPages(true);
      if (all.length === 0) {
        for (const page of SEED_PAGES) {
          await this.putPage(page);
        }
        console.log('[WikiDB] Seeded with default pages:', SEED_PAGES.length);
        return true;
      }
      return false;
    }

    // ── Reset ──

    async clearAll() {
      // Delete all stores
      const storeNames = ['pages', 'config', 'build_log'];
      for (const name of storeNames) {
        const store = this._getStore(name, 'readwrite');
        await new Promise((resolve, reject) => {
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
    }
  }

  // ===========================================================================
  // SECTION 3: HOOK ENGINE
  // ===========================================================================

  class HookEngine {
    /**
     * Extract hooks from user input, tool context, and session info.
     */
    static extractHooks(userMessage = '', sessionInfo = {}) {
      const hooks = new Set();
      const msg = (userMessage || '').toLowerCase();

      // Always add tool hooks based on session tool state
      if (sessionInfo.activeTool) {
        hooks.add(`tool:${sessionInfo.activeTool}`);
      }

      if (sessionInfo.userId) {
        hooks.add(`user:${sessionInfo.userId}`);
      }

      // Extract keyword hooks from the message
      // Simple word-based extraction
      const words = msg.split(/[\s,.;:!?()]+/).filter(w => w.length > 2);
      for (const word of words) {
        hooks.add(`keyword:${word}`);
      }

      // Extract multi-word patterns
      const patterns = [
        { regex: /how (to|do|can|would)/i, hook: 'action:learn' },
        { regex: /what is/i, hook: 'action:define' },
        { regex: /(error|bug|issue|problem|broken)/i, hook: 'keyword:error' },
        { regex: /(search|find|look up|google)/i, hook: 'action:research' },
        { regex: /(code|function|script|program)/i, hook: 'action:code' },
        { regex: /(explain|describe|clarify)/i, hook: 'action:explain' },
        { regex: /(fix|solve|repair|resolve|troubleshoot)/i, hook: 'intent:troubleshoot' },
        { regex: /(compare|vs|versus|difference)/i, hook: 'intent:compare' },
        { regex: /(tutorial|guide|how|step|walkthrough)/i, hook: 'intent:learn' },
        { regex: /(install|setup|configure|deploy)/i, hook: 'keyword:setup' },
        { regex: /(api|endpoint|route)/i, hook: 'keyword:api' },
        { regex: /(test|testing|spec|assert)/i, hook: 'keyword:test' },
        { regex: /(security|secure|auth|protect|vulnerab)/i, hook: 'keyword:security' },
        { regex: /(perform|speed|fast|slow|optimize)/i, hook: 'keyword:performance' },
        { regex: /(python|javascript|typescript|rust|go|java)/i, hook: 'keyword:language' }
      ];

      for (const pattern of patterns) {
        if (pattern.regex.test(msg)) {
          hooks.add(pattern.hook);
        }
      }

      // Always include 'always' hook for matching purposes
      hooks.add('always');

      return [...hooks];
    }

    /**
     * Score how well a page's hooks match the extracted hooks.
     */
    static matchScore(pageHooks = [], extractedHooks = []) {
      if (!pageHooks.length || !extractedHooks.length) return 0;

      let score = 0;

      // 'always' pages automatically match
      if (pageHooks.includes('always')) {
        score += 5;
      }

      for (const ph of pageHooks) {
        for (const eh of extractedHooks) {
          if (ph === eh) {
            // Exact match
            if (ph.startsWith('tool:')) score += 3;
            else if (ph.startsWith('intent:')) score += 2.5;
            else if (ph.startsWith('action:')) score += 2;
            else if (ph.startsWith('user:')) score += 2;
            else score += 1;
          } else if (ph.startsWith('keyword:') && eh.startsWith('keyword:')) {
            // Partial keyword match (e.g. "keyword:async" vs "keyword:asynchronous")
            const phWord = ph.replace('keyword:', '');
            const ehWord = eh.replace('keyword:', '');
            if (phWord.includes(ehWord) || ehWord.includes(phWord)) {
              score += 0.5;
            }
          }
        }
      }

      return score;
    }
  }

  // ===========================================================================
  // SECTION 4: WIKI MODULE — MAIN CONTROLLER
  // ===========================================================================

  class ChatSeedWiki {
    constructor() {
      this.db = new WikiDB();
      this._initialized = false;
      this._panelOpen = false;
      this._loadedPages = new Set(); // Track pages loaded this session
      this._appApi = null; // Reference to app API
      this._panelEl = null;
      this._buttonEl = null;
      this._enabled = true;
      this._conversationCount = 0;

      // Tool definitions for AI
      this.tools = [
        {
          name: 'wiki_search',
          description: 'Search the wiki knowledge base for relevant pages. Returns page titles, summaries, and relevance scores. Use this when the auto-loaded pages aren\'t enough or you need something specific.',
          parameters: {
            query: { type: 'string', description: 'Search query to find relevant wiki pages' },
            max_results: { type: 'number', description: 'Maximum results to return (1–5)', default: 3 }
          },
          handler: (args) => this._handleWikiSearch(args)
        },
        {
          name: 'wiki_read',
          description: 'Read the full content of a wiki page into your working context. Use this after wiki_search to load specific page content.',
          parameters: {
            page: { type: 'string', description: 'The title of the wiki page to read (e.g. "concept/fastapi.md")' }
          },
          handler: (args) => this._handleWikiRead(args)
        }
      ];
    }

    // ── Initialization ──

    async init(appApi) {
      if (this._initialized) return;

      this._appApi = appApi;
      console.log('[WikiModule] Initializing...');

      // Open IndexedDB
      await this.db.open();
      await this.db.seedIfEmpty();

      // Read config
      const config = await this.db.getConfig();
      this._enabled = config.auto_trigger !== false;

      // Note: UI (accordion + panel) is handled by the ModuleSystem bootstrap, not here.
      // _injectUI() has been replaced by ModuleSystem.register integration.

      this._initialized = true;
      console.log('[WikiModule] Initialized successfully');
      console.log('[WikiModule] Seed pages loaded, DB ready');
    }

    /**
     * Called by the app before the AI thinks.
     * Returns wiki pages to inject into the AI's context.
     */
    async getContext(userMessage, sessionInfo = {}) {
      if (!this._enabled) return '';

      const config = await this.db.getConfig();
      if (!config.auto_trigger) return '';

      try {
        // Extract hooks from user message
        const extractedHooks = HookEngine.extractHooks(userMessage, sessionInfo);

        // Find matching pages
        const matchedPages = await this.db.getPagesByHooks(extractedHooks, MAX_AUTO_LOAD_PAGES);

        if (matchedPages.length === 0) return '';

        // Track loaded pages for build loop
        for (const page of matchedPages) {
          this._loadedPages.add(page.title);
        }

        // Build context string
        let context = '═══════════════════════════════════════════\n';
        context += `📚 Wiki: ${matchedPages.length} page(s) loaded for context\n`;
        context += '───────────────────────────────────────────\n';

        for (const page of matchedPages) {
          context += `📄 ${page.title} (rel:${page.relevance.toFixed(2)})\n`;
          context += page.content;
          context += '\n───────────────────────────────────────────\n';
        }

        context += '═══════════════════════════════════════════\n';

        return context;
      } catch (err) {
        console.error('[WikiModule] getContext error:', err);
        return '';
      }
    }

    /**
     * Called by the app after the AI responds.
     * Triggers the build loop if enabled.
     */
    async onResponse(userMessage, aiResponse, toolCalls, sessionInfo) {
      if (!this._enabled) return;

      const config = await this.db.getConfig();
      if (!config.build_enabled) return;

      this._conversationCount++;

      // Check frequency
      if (config.build_frequency === 'manual') return;
      if (config.build_frequency === 'n_conversations') {
        const interval = config.build_interval || 3;
        if (this._conversationCount % interval !== 0) return;
      }

      // Get the current loaded pages content
      const loadedPageContents = [];
      for (const title of this._loadedPages) {
        const page = await this.db.getPage(title);
        if (page) {
          loadedPageContents.push(page);
        }
      }

      // Fire build loop asynchronously (don't block)
      this._runBuildLoop(userMessage, aiResponse, toolCalls || [], loadedPageContents)
        .catch(err => console.error('[WikiModule] Build loop error:', err));

      // Reset loaded pages for next turn
      this._loadedPages.clear();
    }

    // ── Build Loop ──

    async _runBuildLoop(userMessage, aiResponse, toolCalls, loadedPages) {
      const config = await this.db.getConfig();

      const startTime = Date.now();
      console.log('[WikiModule] 🔄 Build loop starting...');

      // Build the training prompt
      const prompt = this._constructBuildPrompt(userMessage, aiResponse, toolCalls, loadedPages);

      try {
        // Call the training model
        const result = await this._callTrainingModel(prompt, config);

        // Parse the result (JSON from the training model)
        const suggestions = this._parseBuildResult(result);

        if (!suggestions || suggestions.length === 0) {
          console.log('[WikiModule] Build loop: no new knowledge to capture');
          return;
        }

        // Process each suggestion
        const actions = [];
        for (const suggestion of suggestions) {
          try {
            const action = await this._processSuggestion(suggestion);
            if (action) actions.push(action);
          } catch (err) {
            console.error(`[WikiModule] Error processing suggestion:`, suggestion, err);
          }
        }

        // Update config stats
        const duration = Date.now() - startTime;
        const cost = this._estimateCost(prompt, result, config);

        await this.db.saveConfig({
          total_builds: (config.total_builds || 0) + 1,
          total_build_cost: (config.total_build_cost || 0) + cost,
          last_build: new Date().toISOString()
        });

        // Log the build
        await this.db.addBuildLog({
          id: `build_${Date.now()}`,
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          actions,
          model_used: `${config.train_provider}/${config.train_model}`,
          cost
        });

        // Apply relevance updates
        await this._applyRelevanceUpdates(actions, loadedPages);

        console.log(`[WikiModule] ✅ Build complete: ${actions.length} changes made ($${cost.toFixed(4)})`);

      } catch (err) {
        console.error('[WikiModule] Build loop failed:', err);
      }
    }

    _constructBuildPrompt(userMessage, aiResponse, toolCalls, loadedPages) {
      return `You are a knowledge extraction and consolidation engine. Analyze this conversation and determine what should be captured or updated in the AI's wiki knowledge base.

CONVERSATION:
User message: "${(userMessage || '').substring(0, 2000)}"
AI response: "${(aiResponse || '').substring(0, 2000)}"

Tool calls made: ${JSON.stringify((toolCalls || []).slice(0, 5))}

Pages already loaded in context: ${JSON.stringify(loadedPages.map(p => ({ title: p.title, summary: p.summary })))}

INSTRUCTIONS:
Output a JSON array of knowledge actions. Each action can be:
1. "create" — brand new page
2. "update" — update existing page
3. "archive" — deprecate a page

For "create" and "update" actions, include:
- \`action\`: "create" or "update"
- \`page\`: page title (e.g. "concept/something.md")
- \`category\`: "core" | "tool" | "concept" | "skill" | "pref"
- \`content\`: Full markdown content of the page
- \`hooks\`: Array of trigger hooks (e.g. ["keyword:python", "tool:evolve_self"])
- \`summary\`: One-line summary of the page
- \`reason\`: Why this knowledge is being captured

Hook system:
- \`tool:toolname\` — triggers when AI uses that tool
- \`keyword:word\` — triggers when word appears in user message
- \`keyword:phrase with spaces\` — multi-word keyword triggers
- \`action:actionname\` — triggers for specific actions
- \`intent:intentname\` — triggers for user intents
- \`always\` — loads on every turn (use sparingly, for core pages only)

Rules:
- Keep pages focused and concise (under 4KB each)
- Use markdown formatting with ## section headers
- Only capture knowledge that would be useful in FUTURE conversations
- If the conversation didn't teach anything new, output an empty array []
- For "update" actions, provide the COMPLETE new content, not just a diff
- Review existing pages if they were loaded — consolidate old + new

Output ONLY valid JSON, nothing else.`;
    }

    async _callTrainingModel(prompt, config) {
      const provider = config.train_provider || DEFAULT_TRAIN_PROVIDER;
      const model = config.train_model || DEFAULT_TRAIN_MODEL;

      // If the app has an LLM API, use it
      if (this._appApi && typeof this._appApi.callLLM === 'function') {
        return await this._appApi.callLLM({
          provider,
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 3000
        });
      }

      // Otherwise, try the app's fetch-based API
      if (this._appApi && typeof this._appApi.makeLLMRequest === 'function') {
        return await this._appApi.makeLLMRequest(provider, model, [
          { role: 'user', content: prompt }
        ], { temperature: 0.3, max_tokens: 3000 });
      }

      // Fallback: try to use a generic API endpoint from global config
      if (window.__LLM_API__ && typeof window.__LLM_API__ === 'function') {
        return await window.__LLM_API__({
          provider,
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 3000
        });
      }

      // Fallback: use the app's OpenRouter API key directly
      // ChatSeed stores the API key in window.API_KEY or localStorage
      try {
        var apiKey = window.API_KEY || '';
        if (!apiKey) {
          try { apiKey = localStorage.getItem('chatseed_api_key') || ''; } catch(ex) {}
        }
        if (apiKey && apiKey.indexOf('sk-or-') === 0) {
          // Determine the full model ID for OpenRouter
          var fullModelId = model;
          if (provider === 'openrouter' || !provider || provider === DEFAULT_TRAIN_PROVIDER) {
            // If the model doesn't include a provider prefix, add one
            if (model.indexOf('/') === -1) {
              fullModelId = 'openai/' + model;
            } else {
              fullModelId = model;
            }
          } else if (provider === 'openai') {
            fullModelId = 'openai/' + model;
          } else if (provider === 'anthropic') {
            fullModelId = 'anthropic/' + model;
          } else if (provider === 'google') {
            fullModelId = 'google/' + model;
          } else {
            fullModelId = model.indexOf('/') === -1 ? 'openai/' + model : model;
          }

          var resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + apiKey,
              'Content-Type': 'application/json',
              'HTTP-Referer': window.location.href || 'https://chatseed.app',
              'X-Title': 'ChatSeed Wiki Training'
            },
            body: JSON.stringify({
              model: fullModelId,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.3,
              max_tokens: 3000
            })
          });

          if (resp.ok) {
            var data = await resp.json();
            var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
            return content;
          } else {
            console.warn('[WikiModule] OpenRouter training model returned:', resp.status);
          }
        }
      } catch(ex) {
        console.warn('[WikiModule] OpenRouter fallback failed:', ex);
      }

      console.warn('[WikiModule] No app LLM API found for training model');
      return '[]';
    }

    _parseBuildResult(result) {
      if (!result) return [];

      // Try to extract JSON from the response
      try {
        // First try direct parse
        return JSON.parse(result);
      } catch {
        // Try to find JSON array in the text
        const match = result.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch {
            // Try cleaning up common issues
            const cleaned = match[0]
              .replace(/\n/g, ' ')
              .replace(/\r/g, '')
              .replace(/\\'/g, "'")
              .replace(/'/g, '"')
              // Fix unescaped quotes inside strings (heuristic)
              .replace(/"([^"]*?)"([^,"\]}]+?)"/g, (m, p1, p2) => {
                return `"${p1}${p2.replace(/"/g, '\\"')}"`;
              });
            try {
              return JSON.parse(cleaned);
            } catch {
              console.error('[WikiModule] Could not parse build result');
            }
          }
        }
      }

      return [];
    }

    async _processSuggestion(suggestion) {
      if (!suggestion || !suggestion.action || !suggestion.page) {
        return null;
      }

      const { action, page: title, content, hooks, category, summary, reason } = suggestion;

      if (action === 'archive') {
        await this.db.archivePage(title);
        return { type: 'archive', page: title, reason };
      }

      if (action === 'create') {
        // Check if page already exists
        const existing = await this.db.getPage(title);
        if (existing) {
          // Consolidate instead
          return this._processSuggestion({
            ...suggestion,
            action: 'update'
          });
        }

        await this.db.putPage({
          title,
          content: content || `# ${title.split('/').pop().replace('.md', '')}\n\n[Content to be expanded]`,
          hooks: hooks || [`keyword:${title.split('/').pop().replace('.md', '').toLowerCase()}`],
          category: category || 'concept',
          summary: summary || reason || `Knowledge about ${title}`,
          relevance: 0.7,
          hit_count: 0,
          use_count: 0,
          version: 1,
          previous_versions: []
        });

        return { type: 'create', page: title, category, reason };
      }

      if (action === 'update') {
        const existing = await this.db.getPage(title);
        if (existing) {
          // Save old version
          const prevVersions = existing.previous_versions || [];
          prevVersions.push({
            version: existing.version || 1,
            content: existing.content,
            saved_at: new Date().toISOString()
          });
          // Keep only last 5 versions
          if (prevVersions.length > 5) prevVersions.splice(0, prevVersions.length - 5);

          await this.db.putPage({
            ...existing,
            content: content || existing.content,
            hooks: hooks || existing.hooks,
            category: category || existing.category,
            summary: summary || existing.summary,
            relevance: Math.min(1, existing.relevance + 0.02), // Bump relevance on update
            version: (existing.version || 1) + 1,
            previous_versions: prevVersions
          });

          return { type: 'update', page: title, version: (existing.version || 1) + 1, reason };
        } else {
          // Doesn't exist yet, create it
          return this._processSuggestion({ ...suggestion, action: 'create' });
        }
      }

      return null;
    }

    async _applyRelevanceUpdates(actions, loadedPages) {
      // Bump relevance for pages that were loaded and used
      for (const page of loadedPages) {
        const wasUpdated = actions.some(a => a.page === page.title);
        const delta = wasUpdated ? 0.05 : 0.02;
        const existing = await this.db.getPage(page.title);
        if (existing && existing.category !== 'core') {
          existing.relevance = Math.min(1, (existing.relevance || 0.5) + delta);
          existing.hit_count = (existing.hit_count || 0) + 1;
          if (wasUpdated) existing.use_count = (existing.use_count || 0) + 1;
          await this.db.putPage(existing);
        }
      }

      // Apply decay to non-core, non-loaded pages
      const all = await this.db.getAllPages(false);
      const config = await this.db.getConfig();
      const decay = config.relevance_decay || 0.01;

      for (const page of all) {
        if (page.category === 'core') continue; // Core pages don't decay
        if (page.hooks && page.hooks.includes('always')) continue; // Always pages don't decay

        page.relevance = Math.max(0, (page.relevance || 0.5) - decay);

        // Archive if below threshold
        if (page.relevance < (config.archive_threshold || 0.15)) {
          page.category = 'archive';
        }

        await this.db.putPage(page);
      }
    }

    _estimateCost(prompt, result, config) {
      // Rough estimation: input ~$0.50/M tokens, output ~$1.50/M tokens for mid-range models
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil((result || '').length / 4);
      const inputCost = (inputTokens / 1000000) * 0.50;
      const outputCost = (outputTokens / 1000000) * 1.50;
      return inputCost + outputCost;
    }

    // ── Tool Handlers ──

    async _handleWikiSearch(args) {
      const query = args.query || '';
      const maxResults = Math.min(args.max_results || 3, 5);

      if (!query) return { results: [], error: 'Query is required' };

      const results = await this.db.searchPages(query);
      const top = results.slice(0, maxResults).map(p => ({
        title: p.title,
        category: p.category,
        summary: p.summary,
        relevance: p.relevance,
        hooks: p.hooks || []
      }));

      return { results: top, total: results.length };
    }

    async _handleWikiRead(args) {
      const title = args.page || '';

      if (!title) return { error: 'Page title is required' };

      const page = await this.db.getPage(title);
      if (!page) {
        // Try fuzzy match
        const all = await this.db.getAllPages(false);
        const match = all.find(p => p.title.toLowerCase().includes(title.toLowerCase()));
        if (match) {
          this._loadedPages.add(match.title);
          return {
            title: match.title,
            category: match.category,
            content: match.content,
            relevance: match.relevance,
            hooks: match.hooks || []
          };
        }
        return { error: `Page "${title}" not found` };
      }

      this._loadedPages.add(page.title);
      return {
        title: page.title,
        category: page.category,
        content: page.content,
        relevance: page.relevance,
        hooks: page.hooks || []
      };
    }

    // ── UI ──

    _injectUI() {
      // Deprecated — UI is handled via ModuleSystem accordion.
      // Keeping this method for backward compatibility but it no longer runs by default.
      console.log('[WikiModule] _injectUI() is deprecated — use ModuleSystem accordion integration instead');
    }

    _createFloatingButton() {
      const btn = document.createElement('button');
      btn.className = 'wiki-floating-btn';
      btn.title = 'Toggle Wiki Module';
      btn.innerHTML = '📚';
      btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: none;
        background: var(--bg-secondary, #16213e);
        color: inherit;
        font-size: 22px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9998;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.9;
        transition: opacity 0.2s, transform 0.2s;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.1)'; });
      btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
      btn.addEventListener('click', () => this._togglePanel());
      document.body.appendChild(btn);
      this._buttonEl = { el: btn };
    }

    _createButton(toolbar) {
      const btn = document.createElement('button');
      btn.className = 'wiki-toggle-btn';
      btn.title = 'Toggle Wiki Module';
      btn.setAttribute('data-wiki-toggle', '');
      btn.innerHTML = WIKI_BUTTON_HTML;
      btn.style.cssText = `
        cursor: pointer;
        border: none;
        background: transparent;
        font-size: 18px;
        padding: 4px 8px;
        border-radius: 6px;
        transition: background 0.2s;
        opacity: ${this._enabled ? 1 : 0.5};
        position: relative;
      `;

      // Label
      const label = document.createElement('span');
      label.textContent = WIKI_BUTTON_LABEL;
      label.style.cssText = `
        font-size: 11px;
        display: block;
        text-align: center;
        line-height: 1;
      `;
      btn.appendChild(label);

      // Active indicator dot
      const dot = document.createElement('span');
      dot.className = 'wiki-active-dot';
      dot.style.cssText = `
        position: absolute;
        top: 2px;
        right: 2px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${this._enabled ? '#4CAF50' : '#999'};
        transition: background 0.3s;
      `;
      btn.prepend(dot);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._togglePanel();
      });

      toolbar.appendChild(btn);
      this._buttonEl = { el: btn, dot };
    }

    _createPanel() {
      const panel = document.createElement('div');
      panel.className = 'wiki-control-panel';
      panel.setAttribute('data-wiki-panel', '');
      panel.style.cssText = `
        display: none;
        position: fixed;
        top: 60px;
        right: 20px;
        width: 480px;
        max-width: 90vw;
        max-height: 80vh;
        background: var(--bg-primary, #1a1a2e);
        border: 1px solid var(--border-color, #333);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        z-index: 9999;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: var(--text-primary, #e0e0e0);
        flex-direction: column;
      `;

      panel.innerHTML = this._getPanelHTML();
      document.body.appendChild(panel);
      this._panelEl = panel;

      // Bind panel events
      this._bindPanelEvents(panel);
    }

    _getPanelHTML() {
      return `
        <style>
          .wiki-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color, #333);
            background: var(--bg-secondary, #16213e);
            flex-shrink: 0;
          }
          .wiki-panel-title {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .wiki-panel-close {
            cursor: pointer;
            background: none;
            border: none;
            color: inherit;
            font-size: 20px;
            opacity: 0.6;
            transition: opacity 0.2s;
          }
          .wiki-panel-close:hover { opacity: 1; }
          .wiki-panel-body {
            padding: 16px;
            overflow-y: auto;
            flex: 1;
          }
          .wiki-section {
            margin-bottom: 16px;
          }
          .wiki-section-title {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.6;
            margin-bottom: 8px;
          }
          .wiki-model-selectors {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .wiki-model-selectors select {
            flex: 1;
            padding: 6px 10px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #444);
            background: var(--bg-input, #0f3460);
            color: inherit;
            font-size: 13px;
            cursor: pointer;
          }
          .wiki-model-selectors select:focus {
            outline: none;
            border-color: #4CAF50;
          }
          .wiki-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
          }
          .wiki-toggle-switch {
            position: relative;
            width: 40px;
            height: 22px;
            cursor: pointer;
            flex-shrink: 0;
          }
          .wiki-toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          .wiki-toggle-slider {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #555;
            border-radius: 11px;
            transition: 0.3s;
          }
          .wiki-toggle-slider::before {
            content: '';
            position: absolute;
            height: 16px;
            width: 16px;
            left: 3px;
            bottom: 3px;
            background: white;
            border-radius: 50%;
            transition: 0.3s;
          }
          .wiki-toggle-switch input:checked + .wiki-toggle-slider {
            background: #4CAF50;
          }
          .wiki-toggle-switch input:checked + .wiki-toggle-slider::before {
            transform: translateX(18px);
          }
          .wiki-search-box {
            width: 100%;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid var(--border-color, #444);
            background: var(--bg-input, #0f3460);
            color: inherit;
            font-size: 13px;
            box-sizing: border-box;
            margin-bottom: 8px;
          }
          .wiki-search-box:focus {
            outline: none;
            border-color: #4CAF50;
          }
          .wiki-search-box::placeholder {
            opacity: 0.5;
          }
          .wiki-page-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .wiki-page-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            border-radius: 6px;
            background: var(--bg-secondary, #16213e);
            font-size: 13px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .wiki-page-item:hover {
            background: var(--bg-hover, #1a2744);
          }
          .wiki-page-title {
            display: flex;
            align-items: center;
            gap: 6px;
            overflow: hidden;
            flex: 1;
          }
          .wiki-page-cat {
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 4px;
            opacity: 0.8;
            flex-shrink: 0;
          }
          .wiki-page-relevance {
            font-size: 11px;
            opacity: 0.6;
            white-space: nowrap;
          }
          .wiki-page-delete {
            cursor: pointer;
            opacity: 0.4;
            transition: opacity 0.2s;
            background: none;
            border: none;
            color: #ff6b6b;
            font-size: 14px;
            padding: 2px;
            flex-shrink: 0;
          }
          .wiki-page-delete:hover { opacity: 1; }
          .wiki-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .wiki-btn {
            padding: 6px 14px;
            border-radius: 6px;
            border: 1px solid var(--border-color, #444);
            background: var(--bg-secondary, #16213e);
            color: inherit;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .wiki-btn:hover {
            background: var(--bg-hover, #1a2744);
          }
          .wiki-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .wiki-btn-danger {
            border-color: #ff6b6b;
            color: #ff6b6b;
          }
          .wiki-btn-danger:hover {
            background: rgba(255,107,107,0.1);
          }
          .wiki-btn-primary {
            border-color: #4CAF50;
            color: #4CAF50;
          }
          .wiki-btn-primary:hover {
            background: rgba(76,175,80,0.1);
          }
          .wiki-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .wiki-stat-card {
            padding: 8px 12px;
            border-radius: 6px;
            background: var(--bg-secondary, #16213e);
            text-align: center;
          }
          .wiki-stat-value {
            font-size: 20px;
            font-weight: 600;
          }
          .wiki-stat-label {
            font-size: 11px;
            opacity: 0.6;
            margin-top: 2px;
          }
          .wiki-page-preview-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .wiki-page-preview {
            background: var(--bg-primary, #1a1a2e);
            border: 1px solid var(--border-color, #333);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            max-width: 90vw;
            width: 640px;
            max-height: 80vh;
            overflow: auto;
            padding: 20px;
            position: relative;
          }
          .wiki-page-preview pre {
            white-space: pre-wrap;
            font-size: 13px;
            line-height: 1.5;
            margin: 0;
            font-family: inherit;
          }
          .wiki-preview-close {
            position: sticky;
            top: 0;
            float: right;
            cursor: pointer;
            background: none;
            border: none;
            color: inherit;
            font-size: 20px;
            opacity: 0.6;
          }
          .wiki-preview-close:hover { opacity: 1; }
          .wiki-build-log {
            font-size: 11px;
            opacity: 0.7;
            padding: 4px 0;
          }
          .wiki-freq-select {
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid var(--border-color, #444);
            background: var(--bg-input, #0f3460);
            color: inherit;
            font-size: 12px;
            cursor: pointer;
          }
          .wiki-freq-select:focus {
            outline: none;
            border-color: #4CAF50;
          }
          .wiki-cost-display {
            font-size: 11px;
            opacity: 0.5;
            margin-top: 4px;
          }
          .wiki-notification {
            position: fixed;
            bottom: 80px;
            right: 20px;
            padding: 10px 16px;
            background: var(--bg-secondary, #16213e);
            border: 1px solid var(--border-color, #333);
            border-radius: 8px;
            font-size: 13px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001;
            animation: wiki-fade-in 0.3s ease;
          }
          @keyframes wiki-fade-in {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .wiki-empty-state {
            opacity: 0.5;
            font-size: 13px;
            text-align: center;
            padding: 20px 12px;
          }
          .wiki-interval-input {
            width: 60px;
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid var(--border-color, #444);
            background: var(--bg-input, #0f3460);
            color: inherit;
            font-size: 12px;
            text-align: center;
          }
          .wiki-interval-input:focus {
            outline: none;
            border-color: #4CAF50;
          }
        </style>

        <div class="wiki-panel-header">
          <span class="wiki-panel-title">📚 Wiki Module</span>
          <div style="display:flex;align-items:center;gap:12px;">
            <label class="wiki-toggle-switch" title="Enable/disable wiki auto-loading">
              <input type="checkbox" data-wiki-enabled ${this._enabled ? 'checked' : ''}>
              <span class="wiki-toggle-slider"></span>
            </label>
            <button class="wiki-panel-close" data-wiki-close>✕</button>
          </div>
        </div>

        <div class="wiki-panel-body">
          <!-- Training Model Section -->
          <div class="wiki-section">
            <div class="wiki-section-title">🎯 Training Model</div>
            <div class="wiki-model-selectors">
              <select data-wiki-provider>
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="huggingface">HuggingFace</option>
                <option value="google">Google</option>
              </select>
              <select data-wiki-model>
                <option value="qwen/qwen3-coder-30b-a3b-instruct">Qwen 3 Coder 30B</option>
                <option value="qwen/qwen3-30b-a3b-instruct">Qwen 3 30B</option>
                <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                <option value="openai/gpt-4o">GPT-4o</option>
                <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                <option value="anthropic/claude-3-opus">Claude 3 Opus</option>
                <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
                <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
                <option value="mistralai/mistral-large">Mistral Large</option>
              </select>
            </div>
            <div class="wiki-cost-display" data-wiki-cost>Used by the build loop to extract & consolidate knowledge</div>
          </div>

          <!-- Build Loop Section -->
          <div class="wiki-section">
            <div class="wiki-section-title">🔄 Build Loop</div>
            <div class="wiki-toggle-row">
              <span>Auto-build after conversations</span>
              <label class="wiki-toggle-switch">
                <input type="checkbox" data-wiki-build-enabled checked>
                <span class="wiki-toggle-slider"></span>
              </label>
            </div>
            <div class="wiki-toggle-row">
              <span>Build frequency</span>
              <select class="wiki-freq-select" data-wiki-freq>
                <option value="every">Every conversation</option>
                <option value="n_conversations">Every N conversations</option>
                <option value="manual">Manual only</option>
              </select>
            </div>
            <div class="wiki-toggle-row" data-wiki-interval-row style="display:none;">
              <span>Interval</span>
              <input type="number" data-wiki-interval value="3" min="1" max="20"
                class="wiki-interval-input">
            </div>
          </div>

          <!-- Knowledge Base Section -->
          <div class="wiki-section">
            <div class="wiki-section-title">📖 Knowledge Base</div>
            <input class="wiki-search-box" data-wiki-search type="text" placeholder="🔍 Search wiki pages by title, keyword, hook...">
            <div class="wiki-page-list" data-wiki-page-list>
              <div class="wiki-empty-state">Loading pages...</div>
            </div>
          </div>

          <!-- Actions Section -->
          <div class="wiki-section">
            <div class="wiki-section-title">⚡ Actions</div>
            <div class="wiki-actions">
              <button class="wiki-btn wiki-btn-primary" data-wiki-consolidate>🔄 Full Consolidate</button>
              <button class="wiki-btn" data-wiki-export>📤 Export JSON</button>
              <button class="wiki-btn" data-wiki-import>📥 Import</button>
              <button class="wiki-btn wiki-btn-danger" data-wiki-reset>🗑 Reset</button>
            </div>
            <input type="file" data-wiki-import-input accept=".json" style="display:none;">
          </div>

          <!-- Stats Section -->
          <div class="wiki-section">
            <div class="wiki-section-title">📊 Stats</div>
            <div class="wiki-stats-grid" data-wiki-stats>
              <div class="wiki-stat-card">
                <div class="wiki-stat-value" data-stat-pages>0</div>
                <div class="wiki-stat-label">Active Pages</div>
              </div>
              <div class="wiki-stat-card">
                <div class="wiki-stat-value" data-stat-size>0KB</div>
                <div class="wiki-stat-label">Total Size</div>
              </div>
              <div class="wiki-stat-card">
                <div class="wiki-stat-value" data-stat-builds>0</div>
                <div class="wiki-stat-label">Builds Run</div>
              </div>
              <div class="wiki-stat-card">
                <div class="wiki-stat-value" data-stat-cost>$0.00</div>
                <div class="wiki-stat-label">Total Cost</div>
              </div>
            </div>
            <div class="wiki-build-log" data-wiki-last-build></div>
          </div>
        </div>
      `;
    }

    _bindPanelEvents(panel) {
      // Close button
      panel.querySelector('[data-wiki-close]').addEventListener('click', (e) => {
        e.stopPropagation();
        this._togglePanel(false);
      });

      // Enable/disable toggle
      const enabledCheckbox = panel.querySelector('[data-wiki-enabled]');
      enabledCheckbox.addEventListener('change', async (e) => {
        this._enabled = e.target.checked;
        await this.db.saveConfig({ auto_trigger: this._enabled });
        if (this._buttonEl) {
          this._buttonEl.el.style.opacity = this._enabled ? 1 : 0.5;
          if (this._buttonEl.dot) {
            this._buttonEl.dot.style.background = this._enabled ? '#4CAF50' : '#999';
          }
        }
      });

      // Provider selector
      const providerSel = panel.querySelector('[data-wiki-provider]');
      const modelSel = panel.querySelector('[data-wiki-model]');

      providerSel.addEventListener('change', async () => {
        await this.db.saveConfig({ train_provider: providerSel.value });
      });

      modelSel.addEventListener('change', async () => {
        await this.db.saveConfig({ train_model: modelSel.value });
      });

      // Build loop toggle
      const buildToggle = panel.querySelector('[data-wiki-build-enabled]');
      buildToggle.addEventListener('change', async (e) => {
        await this.db.saveConfig({ build_enabled: e.target.checked });
      });

      // Build frequency
      const freqSel = panel.querySelector('[data-wiki-freq]');
      freqSel.addEventListener('change', async (e) => {
        await this.db.saveConfig({ build_frequency: e.target.value });
        const intervalRow = panel.querySelector('[data-wiki-interval-row]');
        intervalRow.style.display = e.target.value === 'n_conversations' ? 'flex' : 'none';
      });

      const intervalInput = panel.querySelector('[data-wiki-interval]');
      intervalInput.addEventListener('change', async (e) => {
        await this.db.saveConfig({ build_interval: parseInt(e.target.value) || 3 });
      });

      // Search
      const searchBox = panel.querySelector('[data-wiki-search]');
      let searchTimeout;
      searchBox.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => this._renderPageList(panel, searchBox.value), 300);
      });

      // Actions
      panel.querySelector('[data-wiki-consolidate]').addEventListener('click', () => {
        this._manualConsolidate(panel);
      });

      panel.querySelector('[data-wiki-export]').addEventListener('click', () => {
        this._exportWiki();
      });

      panel.querySelector('[data-wiki-import]').addEventListener('click', () => {
        panel.querySelector('[data-wiki-import-input]').click();
      });

      panel.querySelector('[data-wiki-import-input]').addEventListener('change', (e) => {
        this._importWiki(e.target.files[0]);
        e.target.value = '';
      });

      panel.querySelector('[data-wiki-reset]').addEventListener('click', () => {
        if (confirm('Are you sure you want to delete ALL wiki pages? This cannot be undone.')) {
          if (confirm('Really? All pages, including core pages?')) {
            this._resetWiki(panel);
          }
        }
      });

      // Close on click outside
      this._outsideClickHandler = (e) => {
        if (this._panelOpen && !panel.contains(e.target) &&
            this._buttonEl && !this._buttonEl.el.contains(e.target)) {
          this._togglePanel(false);
        }
      };
      setTimeout(() => document.addEventListener('click', this._outsideClickHandler), 100);
    }

    async _togglePanel(forceState) {
      if (!this._panelEl) {
        this._createPanel();
      }
      if (!this._panelEl) return;

      this._panelOpen = forceState !== undefined ? forceState : !this._panelOpen;

      if (this._panelOpen) {
        this._panelEl.style.display = 'flex';
        await this._loadConfigIntoPanel(this._panelEl);
        await this._renderPageList(this._panelEl, (this._panelEl.querySelector('[data-wiki-search]') || {}).value || '');
        await this._renderStats(this._panelEl);
      } else {
        this._panelEl.style.display = 'none';
      }
    }

    async _loadConfigIntoPanel(panel) {
      const config = await this.db.getConfig();

      // Provider + model
      const providerSel = panel.querySelector('[data-wiki-provider]');
      const modelSel = panel.querySelector('[data-wiki-model]');

      if (providerSel.querySelector(`option[value="${config.train_provider}"]`)) {
        providerSel.value = config.train_provider;
      }
      if (modelSel.querySelector(`option[value="${config.train_model}"]`)) {
        modelSel.value = config.train_model;
      }

      // Build loop
      const buildToggle = panel.querySelector('[data-wiki-build-enabled]');
      buildToggle.checked = config.build_enabled !== false;

      const freqSel = panel.querySelector('[data-wiki-freq]');
      freqSel.value = config.build_frequency || 'every';
      const intervalRow = panel.querySelector('[data-wiki-interval-row]');
      intervalRow.style.display = freqSel.value === 'n_conversations' ? 'flex' : 'none';
      const intervalInput = panel.querySelector('[data-wiki-interval]');
      intervalInput.value = config.build_interval || 3;
    }

    async _renderPageList(panel, searchTerm) {
      const listEl = panel.querySelector('[data-wiki-page-list]');
      if (!listEl) return;

      let pages;
      if (searchTerm) {
        pages = await this.db.searchPages(searchTerm);
      } else {
        pages = await this.db.getAllPages(false);
        pages.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
      }

      if (!pages || pages.length === 0) {
        listEl.innerHTML = `<div class="wiki-empty-state">${
          searchTerm ? 'No pages match your search' : 'No wiki pages yet'
        }</div>`;
        return;
      }

      let html = '';
      for (const p of pages) {
        const catColors = {
          core: { bg: '#1a3a2e', color: '#4CAF50' },
          tool: { bg: '#1a2a3e', color: '#64B5F6' },
          concept: { bg: '#2a1a3e', color: '#CE93D8' },
          skill: { bg: '#1a2e2e', color: '#81C784' },
          pref: { bg: '#2e2a1a', color: '#FFB74D' },
          archive: { bg: '#2a1a1a', color: '#EF5350' }
        };
        const catColor = catColors[p.category] || { bg: '#1a1a1a', color: '#999' };
        const catBg = catColor.bg;
        const catColorHex = catColor.color;
        html += `<div class="wiki-page-item" data-page-title="${this._escapeHtml(p.title)}">
            <div class="wiki-page-title">
              <span class="wiki-page-cat" style="background:${catBg};color:${catColorHex};">${p.category}</span>
              <span>${this._escapeHtml(p.title.split('/').pop().replace('.md', ''))}</span>
              <span class="wiki-page-relevance">★ ${(p.relevance || 0.5).toFixed(2)}</span>
              <button class="wiki-page-delete" data-delete-title="${this._escapeHtml(p.title)}" title="Delete">✕</button>
            </div>
          </div>`;
      }
      listEl.innerHTML = html;

      // Page click → preview
      listEl.querySelectorAll('.wiki-page-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.wiki-page-delete')) return;
          const title = item.dataset.pageTitle;
          if (title) this._showPagePreview(title);
        });
      });

      // Delete button
      listEl.querySelectorAll('.wiki-page-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const title = btn.dataset.deleteTitle;
          if (title && confirm(`Delete "${title}"?`)) {
            await this.db.deletePage(title);
            await this._renderPageList(panel, (panel.querySelector('[data-wiki-search]') || {}).value || '');
            await this._renderStats(panel);
            this._showNotification(`Deleted: ${title}`);
          }
        });
      });
    }

    async _showPagePreview(title) {
      const page = await this.db.getPage(title);
      if (!page) return;

      // Remove existing preview
      const existing = document.querySelector('.wiki-page-preview-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'wiki-page-preview-overlay';
      overlay.innerHTML = `
        <div class="wiki-page-preview">
          <button class="wiki-preview-close">✕</button>
          <h3 style="margin:0 0 12px 0">${this._escapeHtml(page.title)}</h3>
          <div style="margin-bottom:12px;font-size:12px;opacity:0.7">
            <span>Category: ${page.category}</span>
            <span style="margin-left:16px">Relevance: ${(page.relevance || 0.5).toFixed(2)}</span>
            <span style="margin-left:16px">Version: ${page.version || 1}</span>
          </div>
          <pre>${this._escapeHtml(page.content)}</pre>
        </div>
      `;
      overlay.querySelector('.wiki-preview-close').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    }

    _escapeHtml(str) {
      const el = document.createElement('span');
      el.textContent = str;
      return el.innerHTML;
    }

    async _renderStats(panel) {
      const statsEl = panel.querySelector('[data-wiki-stats]');
      if (!statsEl) return;
      try {
        const stats = await this.db.getStats();
        const pagesEl = statsEl.querySelector('[data-stat-pages]');
        if (pagesEl) pagesEl.textContent = stats.active_pages;
        const sizeEl = statsEl.querySelector('[data-stat-size]');
        if (sizeEl) sizeEl.textContent = stats.total_size_bytes > 1024
          ? (stats.total_size_bytes / 1024).toFixed(0) + 'KB'
          : stats.total_size_bytes + 'B';
        const buildsEl = statsEl.querySelector('[data-stat-builds]');
        if (buildsEl) buildsEl.textContent = stats.total_builds;
        const costEl = statsEl.querySelector('[data-stat-cost]');
        if (costEl) costEl.textContent = '$' + (stats.total_build_cost || 0).toFixed(4);

        const lastBuildEl = panel.querySelector('[data-wiki-last-build]');
        if (lastBuildEl && stats.recent_builds && stats.recent_builds.length > 0) {
          const last = stats.recent_builds[0];
          lastBuildEl.textContent = `Last build: ${new Date(last.timestamp).toLocaleString()} — ${(last.duration_ms / 1000).toFixed(1)}s, ${(last.cost || 0).toFixed(4)}`;
        } else if (lastBuildEl) {
          lastBuildEl.textContent = 'No builds yet';
        }
      } catch (err) {
        console.error('[WikiModule] Stats error:', err);
      }
    }

    async _manualConsolidate(panel) {
      const btn = panel.querySelector('[data-wiki-consolidate]');
      if (btn) btn.disabled = true;
      this._showNotification('Consolidating knowledge...');

      // Simulate a build with empty current conversation
      await this._runBuildLoop('Manual consolidate', '', [], []);

      if (btn) btn.disabled = false;
      await this._renderPageList(panel, '');
      await this._renderStats(panel);
      this._showNotification('Consolidation complete');
    }

    async _exportWiki() {
      try {
        const all = await this.db.getAllPages(true);
        const config = await this.db.getConfig();

        const exportData = {
          version: 1,
          module: 'chatseed-wiki',
          exported: new Date().toISOString(),
          pages: all.map(p => ({
            title: p.title,
            category: p.category,
            content: p.content,
            hooks: p.hooks || [],
            summary: p.summary || '',
            relevance: p.relevance || 0.5,
            version: p.version || 1
          })),
          config: {
            train_provider: config.train_provider,
            train_model: config.train_model
          }
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wiki_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this._showNotification(`Exported ${all.length} pages`);
        console.log('[WikiModule] Exported', all.length, 'pages');
      } catch (err) {
        console.error('[WikiModule] Export error:', err);
        alert('Export failed: ' + err.message);
      }
    }

    async _importWiki(file) {
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.pages || !Array.isArray(data.pages)) {
          alert('Invalid wiki export file');
          return;
        }

        let imported = 0;
        for (const page of data.pages) {
          await this.db.putPage({
            title: page.title,
            category: page.category || 'concept',
            content: page.content || '',
            hooks: page.hooks || [`keyword:${(page.title || '').split('/').pop().replace('.md','').toLowerCase()}`],
            summary: page.summary || '',
            relevance: page.relevance || 0.5,
            hit_count: 0,
            use_count: 0,
            version: page.version || 1,
            previous_versions: []
          });
          imported++;
        }

        // Restore config if present
        if (data.config) {
          await this.db.saveConfig({
            train_provider: data.config.train_provider,
            train_model: data.config.train_model
          });
        }

        this._showNotification(`Imported ${imported} pages`);
        
        if (this._panelEl && this._panelOpen) {
          await this._renderPageList(this._panelEl, '');
          await this._renderStats(this._panelEl);
          await this._loadConfigIntoPanel(this._panelEl);
        }

        console.log('[WikiModule] Imported', imported, 'pages');
      } catch (err) {
        console.error('[WikiModule] Import error:', err);
        alert('Import failed: ' + err.message);
      }
    }

    async _resetWiki(panel) {
      await this.db.clearAll();

      // Re-seed
      await this.db.seedIfEmpty();

      if (panel && this._panelOpen) {
        await this._renderPageList(panel, '');
        await this._renderStats(panel);
        await this._loadConfigIntoPanel(panel);
      }

      this._showNotification('Wiki reset to defaults');
      console.log('[WikiModule] Wiki reset to defaults');
    }

    _showNotification(msg) {
      // Remove existing
      const existing = document.querySelector('.wiki-notification');
      if (existing) existing.remove();

      const notif = document.createElement('div');
      notif.className = 'wiki-notification';
      notif.textContent = msg;
      document.body.appendChild(notif);

      setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transition = 'opacity 0.5s';
        setTimeout(() => notif.remove(), 500);
      }, 2500);
    }
  }

// ===========================================================================
  // SECTION 5: BOOTSTRAP — ModuleSystem Integration
  // ===========================================================================
  //
  // This bootstrap rewrites the old "discover appApi" pattern.
  // Instead, it integrates directly into ChatSeed's ModuleSystem:
  //   1) ModuleSystem.register()  → tools appear in accordion + AI tool list
  //   2) ModuleSystem.getContext() → wiki pages auto-injected into AI context
  //   3) ModuleSystem.onResponse()  → build loop runs after AI replies
  //
  // The old custom button/panel UI is replaced — the wiki control panel
  // is launched via a [📚 Wiki] accordion item in the Modules section.
  // ===========================================================================

  // Create the global module instance (used by handleToolCall handlers)
  const wikiModule = new ChatSeedWiki();
  window.ChatSeedWikiModule = wikiModule;

  // ── Add context hook to ModuleSystem ──
  // The app's sendMessage() calls ModuleSystem.getContext() if it exists.
  // We install it here so wiki context gets auto-injected into the system prompt.
  function installContextHook() {
    if (!ModuleSystem || ModuleSystem.__wikiContextInstalled) return;
    // Wrap getContext: save original if any, chain ours after it
    var _origGetContext = ModuleSystem.getContext;
    ModuleSystem.getContext = async function(userMessage, sessionInfo) {
      var results = '';
      if (_origGetContext) results = await _origGetContext(userMessage, sessionInfo);
      try {
        var wikiCtx = await wikiModule.getContext(userMessage, sessionInfo);
        if (wikiCtx) results += (results ? '\n\n' : '') + wikiCtx;
      } catch(e) {
        console.warn('[WikiModule] getContext error:', e);
      }
      return results;
    };
    ModuleSystem.__wikiContextInstalled = true;
  }

  // ── Add post-response hook to ModuleSystem ──
  function installPostResponseHook() {
    if (!ModuleSystem || ModuleSystem.__wikiPostResponseInstalled) return;
    var _origOnResponse = ModuleSystem.onResponse;
    ModuleSystem.onResponse = async function(userMessage, aiResponse, toolCalls, sessionInfo) {
      if (_origOnResponse) await _origOnResponse(userMessage, aiResponse, toolCalls, sessionInfo);
      try {
        await wikiModule.onResponse(userMessage, aiResponse, toolCalls, sessionInfo);
      } catch(e) {
        console.warn('[WikiModule] onResponse error:', e);
      }
    };
    ModuleSystem.__wikiPostResponseInstalled = true;
  }

  // ── Register with ModuleSystem ──
  function registerWithModuleSystem() {
    if (typeof ModuleSystem === 'undefined' || !ModuleSystem.register) {
      console.warn('[WikiModule] ModuleSystem not available yet, retrying...');
      return false;
    }

    // Register wiki tools via ModuleSystem.register()
    ModuleSystem.register("wiki", {
      name: "Wiki Knowledge Base",
      description: "Persistent knowledge base with auto-learning. Search and read wiki pages. Pages auto-load based on conversation keywords and tool usage.",
      tools: [
        {
          type: "function",
          function: {
            name: "wiki_search",
            description: "Search the wiki knowledge base for relevant pages. Returns page titles, summaries, and relevance scores. Use this when the auto-loaded pages aren't enough or you need something specific.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query to find relevant wiki pages" },
                max_results: { type: "number", description: "Maximum results to return (1-5)", default: 3 }
              },
              required: ["query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "wiki_read",
            description: "Read the full content of a wiki page into your working context. Use this after wiki_search to load specific page content.",
            parameters: {
              type: "object",
              properties: {
                page: { type: "string", description: "The title of the wiki page to read (e.g. 'concept/fastapi.md')" }
              },
              required: ["page"]
            }
          }
        }
      ],
      handleToolCall: async function(toolName, args) {
        try {
          if (toolName === "wiki_search") {
            var result = await wikiModule._handleWikiSearch(args);
            var out = "## 🔍 Wiki Search Results\n\n";
            if (result.error) return "❌ " + result.error;
            if (!result.results || result.results.length === 0) {
              out += "*No matching pages found. Try a different query.*";
            } else {
              out += "Found " + result.total + " matching page(s):\n\n";
              result.results.forEach(function(r, i) {
                out += "### " + (i+1) + ". " + r.title + "\n";
                out += "**Category:** " + r.category + " | **Relevance:** " + r.relevance.toFixed(2) + "\n";
                out += "**Summary:** " + r.summary + "\n\n";
              });
              out += "Use `wiki_read` with the exact page title to read full content.";
            }
            return out;
          } else if (toolName === "wiki_read") {
            var result = await wikiModule._handleWikiRead(args);
            if (result.error) return "❌ " + result.error;
            var out = "## 📖 " + result.title + "\n\n";
            out += "**Category:** " + result.category + " | **Relevance:** " + result.relevance.toFixed(2) + "\n\n";
            out += result.content;
            return out;
          }
        } catch(e) {
          return "⚠ Wiki error: " + e.message;
        }
        return null;
      }
    });

    installContextHook();
    installPostResponseHook();

    // Connect the accordion toggle — clicking the module name in the
    // Modules accordion opens the wiki control panel.
    function addAccordionListener() {
      var items = document.querySelectorAll('.module-item');
      for (var i = 0; i < items.length; i++) {
        (function(el) {
          var nameEl = el.querySelector('.mod-name');
          if (nameEl && nameEl.textContent.trim() === 'Wiki Knowledge Base') {
            var toggle = el.querySelector('.mod-toggle');
            if (toggle) {
              toggle.addEventListener('click', function(e) {
                e.stopPropagation();
              });
            }
            // Clicking the name area opens the wiki panel
            nameEl.style.cursor = 'pointer';
            nameEl.title = 'Click to open Wiki Panel';
            nameEl.addEventListener('click', function(e) {
              e.stopPropagation();
              wikiModule._togglePanel();
            });
          }
        })(items[i]);
      }
    }

    // Watch for module list re-renders
    var _origRenderModuleList = window.renderModuleList;
    if (_origRenderModuleList) {
      window.renderModuleList = function() {
        _origRenderModuleList();
        setTimeout(addAccordionListener, 50);
      };
    }

    // Periodic re-attachment to survive re-renders (limited to 20 seconds)
    if (!window._wikiAccordionInterval) {
      window._wikiAccordionInterval = setInterval(function count() {
        if (window.ModuleSystem && document.querySelectorAll('.module-item').length > 0) {
          addAccordionListener();
        }
        if (window._wikiAccordionCount === undefined) window._wikiAccordionCount = 0;
        window._wikiAccordionCount++;
        if (window._wikiAccordionCount > 40) {
          clearInterval(window._wikiAccordionInterval);
          window._wikiAccordionInterval = null;
        }
      }, 500);
    }

    // Initial attempt
    setTimeout(addAccordionListener, 500);

    console.log('[WikiModule] ✅ Registered with ModuleSystem');
    console.log('[WikiModule] Tools: wiki_search, wiki_read');
    console.log('[WikiModule] Context hook installed');
    console.log('[WikiModule] Post-response hook installed');
    return true;
  }

  // ── Retry registration until ModuleSystem is available ──
  async function waitForModuleSystem(maxAttempts) {
    maxAttempts = maxAttempts || 30;
    for (var i = 0; i < maxAttempts; i++) {
      if (typeof ModuleSystem !== 'undefined' && ModuleSystem.register) {
        return true;
      }
      await new Promise(function(r) { setTimeout(r, 500); });
    }
    return false;
  }

  // ── Main init ──
  async function initModule() {
    await wikiModule.db.open();
    await wikiModule.db.seedIfEmpty();

    var config = await wikiModule.db.getConfig();
    wikiModule._enabled = config.auto_trigger !== false;

    if (await waitForModuleSystem()) {
      registerWithModuleSystem();
    } else {
      console.warn('[WikiModule] ModuleSystem not found after timeout — tools unavailable');
      // Fallback: just expose tools on window
      window.__WIKI_TOOLS__ = wikiModule.tools;
    }

    wikiModule._initialized = true;
    console.log('[WikiModule] ✅ Bootstrapped and ready');
  }

  // ── Boot ──
  function bootstrap() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(initModule, 100);
      });
    } else {
      setTimeout(initModule, 100);
    }
  }

  bootstrap();

})();