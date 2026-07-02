# 🌱 ChatSeed

**A self-evolving AI chat interface that can read, analyze, and rewrite its own source code.**

ChatSeed is a single-file HTML application that connects to OpenRouter's API to provide a full-featured chat interface with hundreds of AI models. Its superpower? The AI assistant can **read, analyze, diff, refactor, and write its own source code** — meaning it can evolve itself through conversation.

![Preview](https://img.shields.io/badge/status-active-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![OpenRouter](https://img.shields.io/badge/powered%20by-OpenRouter-059669)

![Screenshot](https://raw.githubusercontent.com/broadfield-dev/ChatSeed/refs/heads/main/assets/1200x628.jpg)

[Live Demo: https://broadfield-dev.github.io/ChatSeed/chatseed-v10-7-2.html](https://broadfield-dev.github.io/ChatSeed/chatseed-v10-7-2.html)


---

## ✨ Features

- **🗣️ Multi-Model Chat** — Access 150+ models from OpenRouter (Claude, GPT, Gemini, DeepSeek, Llama, and more)
- **🧬 Self-Evolving** — The AI can read, analyze, and rewrite its own HTML source code through conversation
- **💬 Multi-Step Reasoning** — The AI can perform complex multi-step operations with a visual step progress bar
- **🔧 Tool Calling** — Uses function calling to evolve itself with visual tool-call badges
- **📜 Chat History** — Conversations are saved locally; searchable history sidebar
- **⚡ Streaming Responses** — Real-time token-by-token streaming
- **📁 Export/Download** — Export conversations as JSON, download evolved versions of the app
- **↩️ Undo Stack** — Revert any evolved changes with one click
- **💰 Cost Tracking** — See token counts and approximate costs per model
- **🌙 Dark Theme** — Sleek dark UI built with Tailwind CSS
- **⌨️ Keyboard Shortcuts** — `Enter` to send, `Shift+Enter` for newline, `Esc` to cancel

---

## 🚀 Getting Started

### 1. Obtain an API Key

ChatSeed uses [OpenRouter](https://openrouter.ai/) to access hundreds of AI models through a single API.

1. Sign up at [openrouter.ai](https://openrouter.ai/)
2. Generate an API key (starts with `sk-or-...`)
3. Optionally add a credit balance to access paid models

### 2. Run ChatSeed

**Option A: Open directly**

Just open `chatseed-v7.html` in your browser — no server required!

**Option B: Host on GitHub Pages**

1. Push `chatseed-v7.html` to a GitHub repository
2. Enable GitHub Pages in repo settings
3. Access your instance at `https://<username>.github.io/<repo>/`

### 3. Configure

1. Click the **Settings** button in the sidebar
2. Enter your OpenRouter API key (`sk-or-...`)
3. (Optional) Set a custom system prompt
4. Click **Save Settings**

### 4. Start Chatting

Select a model from the dropdown in the sidebar, type a message, and press **Enter**. Try asking the AI to evolve itself:

> *"Read your code and tell me what you see"*
>
> *"Add a dark/light mode toggle to your UI"*
>
> *"Analyze your code for security vulnerabilities"*
>
> *"Refactor your code to be more modular"*

---

## 🧬 Self-Evolution: How It Works

ChatSeed defines an `evolve_self` tool that the AI can call during conversation. The tool accepts these actions:

| Action | Description |
|--------|-------------|
| **`read`** | The AI reads its own full source code |
| **`analyze`** | The AI analyzes the code and reports insights |
| **`diff`** | The AI proposes changes and shows differences |
| **`refactor`** | The AI rewrites/modifies the code without breaking functionality |
| **`write`** | The AI writes an entirely new version of itself |

When the AI writes or refactors code, the new version is automatically **downloaded** and saved to an **undo stack** so you can always revert.

### Multi-Step Evolution

The AI can perform complex evolution tasks across **up to 10 steps**, each displayed with a progress bar and labeled phase indicator (e.g., "Reading source code...", "Refactoring..."). This allows for sophisticated changes like:

1. **Read** the current code
2. **Analyze** what to change
3. **Write** a new version
4. **Download** the result automatically

---

## 🎨 Interface Overview

```
┌─────────────────────────────────────────────────────┐
│ 🌱 ChatSeed                   ⚙️ Settings          │
├─────────────────────────────────────────────────────┤
│  ┌─── Sidebar ─────────────────┐                    │
│  │ [+] New Chat                │  Chat messages      │
│  │  ⚙️ Settings                │  appear here...     │
│  │                             │                    │
│  │ Conversations [undo] [tok]  │  ┌──────────────┐  │
│  │ Search...                   │  │ Step 3/10    │  │
│  │ ┌─────────────────────┐     │  │ Refactoring▶│  │
│  │ │ Chat 1              │     │  └──────────────┘  │
│  │ │ Chat 2              │     │                    │
│  │ │ Chat 3              │     │                    │
│  │ └─────────────────────┘     │                    │
│  │                             │                    │
│  │ [🔍 Model Search...  ▼]    │ ┌──────────────┐   │
│  │ Enter · Shift+Enter · Esc  │ │ Send message  │▶│ │
│  └─────────────────────────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 🛠️ Technical Details

### Stack
- **Single-file HTML** — No build step, no dependencies to install
- **Tailwind CSS** (CDN) — Utility-first styling
- **Marked.js** (CDN) — Markdown rendering
- **DOMPurify** (CDN) — XSS prevention
- **Font Awesome** (CDN) — Icons
- **LocalStorage** — Persistent chat history and settings

### Architecture
- All state is managed in a global namespace
- Conversations are stored in `localStorage` under `chatseed_conversations`
- API keys are stored in `localStorage` under `chatseed_api_key`
- Pricing data is fetched live from OpenRouter's models endpoint
- Tool calls are executed in a multi-step loop (up to 10 iterations)

### Files
- **`chatseed-v7.html`** — The entire application in a single file (no other files needed!)

---

## 🔒 Security Notes

- Your API key is stored **only in your browser's LocalStorage** — it is never sent anywhere except directly to OpenRouter's API. The key persists in your browsers local storage, so use caution and delete local storage if using a shared device.
- All user-generated content is sanitized via **DOMPurify** before rendering
- The app runs entirely client-side — no backend server involved
- When the AI rewrites code, it's always **saved as a new file** (the original is preserved)

---

## 📋 Requirements

- A modern web browser (Chrome, Firefox, Edge, Safari)
- An [OpenRouter](https://openrouter.ai/) API key
- Internet connection (for API calls and CDN resources)

---

## 🔗 Quick Links (10+)

[Files JS: https://broadfield-dev.github.io/ChatSeed/assets/chatseed-files.js](https://broadfield-dev.github.io/ChatSeed/assets/chatseed-files.js)

[Stylesheet: https://broadfield-dev.github.io/ChatSeed/assets/style.css](https://broadfield-dev.github.io/ChatSeed/assets/style.css)

[Modules: https://broadfield-dev.github.io/ChatSeed/modules](https://broadfield-dev.github.io/ChatSeed/modules)

---
## ❓ FAQ

**Q: Does ChatSeed use my API key for anything other than OpenRouter?**  
A: No. Your key is stored locally and sent only to `openrouter.ai`.

**Q: Can the AI break itself?**  
A: The AI can propose code changes, but they're always downloaded as new files. The original `chatseed-v7.html` remains untouched unless you explicitly replace it.

**Q: What models are supported?**  
A: Any model available on OpenRouter — including Claude, GPT-4, Gemini, DeepSeek, Llama, Mistral, and many more. The list is fetched dynamically from OpenRouter's API.

**Q: Do I need a server?**  
A: No! ChatSeed is entirely client-side. Just open the HTML file.

**Q: Are my conversations private?**  
A: Yes. All data stays in your browser's LocalStorage. Nothing is sent to any server except the OpenRouter API for chat completions.

---

## 📄 License

MIT — Use it, modify it, evolve it freely.

---

## 🙌 Acknowledgments

- Powered by [OpenRouter](https://openrouter.ai/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)
- Markdown via [Marked](https://marked.js.org/)
- Sanitization via [DOMPurify](https://github.com/cure53/DOMPurify)
- Icons by [Font Awesome](https://fontawesome.com/)

---

*Built by conversation. Evolving through code.* 🌱
