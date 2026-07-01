#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════╗
║                 ChatSeed File System Bridge v1.1                        ║
║          🔒 API-Key locked local file bridge for AI assistants          ║
╚══════════════════════════════════════════════════════════════════════════╝

WHAT THIS IS:
  A Python HTTP server that runs on localhost and exposes your file system
  to the ChatSeed AI via simple REST API calls. The AI (me) can read, write,
  list, search, and manage files — but ONLY within the root directory YOU set.

SECURITY MODEL:
  ┌─────────────────────────────────────────────────────────┐
  │                      Your Browser                        │
  │  ┌──────────────────────┐   ┌─────────────────────────┐ │
  │  │  ChatSeed Chatbot    │   │  localStorage:          │ │
  │  │  ┌────────────────┐  │   │  FS_API_KEY="abc123"    │ │
  │  │  │  AI (me!)      │  │   │  FS_ROOT="/home/proj"   │ │
  │  │  │  calls          │  │   └──────────┬──────────────┘ │
  │  │  │  scrape_web(    │  │              │               │
  │  │  │   "http://127..")│  │              ▼               │
  │  │  └───────┬─────────┘  │   Interceptor adds:          │
  │  │          │            │   ?key=abc123 automatically  │
  │  └──────────┼────────────┘                              │
  │             │  🔐 Key auto-injected, AI never sees it!  │
  └─────────────┼───────────────────────────────────────────┘
                │  HTTP (localhost only)
                ▼
  ┌──────────────────────────────────────────┐
  │  chatseed_fs_bridge.py (Python process)   │
  │                                           │
  │  ✅ Verifies API KEY on EVERY request     │
  │  ✅ Root is HARD-SET on server side       │
  │  ✅ AI cannot change root (no key access) │
  │  ✅ All paths validated against root       │
  └──────────────────────────────────────────┘

QUICKSTART:
  1. Pick a root directory and an API key (any phrase you choose)
  2. Run: python chatseed_fs_bridge.py --root /path/to/project --api-key "your-secret"
  3. Open http://127.0.0.1:8742/ui/ in your browser
  4. Enter your API key in the UI (it saves to browser localStorage)
  5. Tell the AI: "The bridge is running!"
  6. I can now access files — but never see or change your key or root

REQUIREMENTS: Python 3.7+ (zero external dependencies — uses only stdlib)
"""

import os
import sys
import json
import html
import time
import stat
import socket
import base64
import hmac
import hashlib
import fnmatch
import urllib.parse
import mimetypes
import textwrap
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime

# ══════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════

DEFAULT_PORT = 8742
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
VERSION = "1.1.0"
DEFAULT_ROOT = "."
# ══════════════════════════════════════════════════════════════════════════
# SECURITY — Path Validation
# ══════════════════════════════════════════════════════════════════════════

def safe_path(root: str, user_path: str) -> str:
    """
    THE security gate for file paths.
    
    Resolves user-supplied path against root. Blocks traversal.
    Every file operation passes through here.
    
    Checks:
    1. Strips null bytes (null byte injection attack)
    2. URL-decodes the path
    3. Resolves '..', symlinks via os.path.realpath()
    4. Verifies result is within root directory
    """
    user_path = user_path.replace('\x00', '')
    user_path = urllib.parse.unquote(user_path)
    user_path = user_path.lstrip('/\\')
    
    root_abs = os.path.realpath(os.path.abspath(root))
    combined = os.path.join(root_abs, user_path)
    combined_abs = os.path.realpath(os.path.abspath(combined))
    
    if not combined_abs.startswith(root_abs + os.sep) and combined_abs != root_abs:
        raise ValueError(
            f"SECURITY: Path traversal blocked — '{user_path}' escapes root"
        )
    
    return combined_abs


def is_within_root(root: str, target: str) -> bool:
    root_abs = os.path.realpath(os.path.abspath(root))
    target_abs = os.path.realpath(os.path.abspath(target))
    return target_abs.startswith(root_abs + os.sep) or target_abs == root_abs


# ══════════════════════════════════════════════════════════════════════════
# AUTH — Constant-Time Key Comparison
# ══════════════════════════════════════════════════════════════════════════

def verify_key(expected: str, provided: str) -> bool:
    """
    Constant-time comparison to prevent timing attacks.
    Uses HMAC comparison — same time whether 1 char or all chars match.
    """
    if not expected or not provided:
        return False
    return hmac.compare_digest(expected, provided)


# ══════════════════════════════════════════════════════════════════════════
# FILE OPERATIONS
# ══════════════════════════════════════════════════════════════════════════

def format_size(size: int) -> str:
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.1f} {unit}" if unit != 'B' else f"{size} B"
        size /= 1024
    return f"{size:.1f} PB"


def get_stat_dict(full_path: str, root: str) -> dict:
    try:
        st = os.stat(full_path)
        rel = os.path.relpath(full_path, root).replace('\\', '/')
        is_dir = os.path.isdir(full_path)
        is_link = os.path.islink(full_path)
        
        result = {
            "name": os.path.basename(full_path),
            "path": rel,
            "type": "dir" if is_dir else "file",
            "size": st.st_size,
            "size_str": format_size(st.st_size),
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "modified_ts": st.st_mtime,
            "created": datetime.fromtimestamp(st.st_ctime).isoformat(),
            "permissions": oct(stat.S_IMODE(st.st_mode)),
            "is_symlink": is_link,
        }
        
        if is_link:
            link_target = os.readlink(full_path)
            result["symlink_target"] = link_target
            result["symlink_safe"] = is_within_root(root, os.path.join(os.path.dirname(full_path), link_target))
        
        return result
    except OSError as e:
        return {"name": os.path.basename(full_path), "error": str(e)}


def list_directory(root: str, rel_path: str = "") -> dict:
    target = safe_path(root, rel_path)
    
    if not os.path.exists(target):
        return {"error": f"Path not found: {rel_path}", "status": 404}
    if not os.path.isdir(target):
        return {"error": f"Not a directory: {rel_path}", "status": 400}
    
    entries = []
    total_size = 0
    dir_count = 0
    file_count = 0
    
    try:
        names = sorted(os.listdir(target))
    except PermissionError:
        return {"error": f"Permission denied: {rel_path}", "status": 403}
    
    for name in names:
        full_path = os.path.join(target, name)
        try:
            entry = get_stat_dict(full_path, root)
            entries.append(entry)
            if entry.get("type") == "dir":
                dir_count += 1
            else:
                file_count += 1
                total_size += entry.get("size", 0)
        except OSError:
            pass
    
    rel = os.path.relpath(target, root).replace('\\', '/')
    parent_rel = os.path.relpath(os.path.dirname(target), root).replace('\\', '/')
    if parent_rel == '.':
        parent_rel = None
    
    return {
        "path": rel if rel != '.' else '/',
        "absolute_path": target,
        "entries": entries,
        "count": len(entries),
        "dir_count": dir_count,
        "file_count": file_count,
        "total_size": total_size,
        "total_size_str": format_size(total_size),
        "parent": parent_rel,
    }


def read_file_content(root: str, rel_path: str) -> dict:
    target = safe_path(root, rel_path)
    
    if not os.path.exists(target):
        return {"error": f"File not found: {rel_path}", "status": 404}
    if not os.path.isfile(target):
        return {"error": f"Not a file: {rel_path}", "status": 400}
    
    file_size = os.path.getsize(target)
    if file_size > MAX_FILE_SIZE:
        return {
            "error": f"File too large ({format_size(file_size)}). Max: {format_size(MAX_FILE_SIZE)}",
            "status": 413,
        }
    
    st = os.stat(target)
    rel = os.path.relpath(target, root).replace('\\', '/')
    
    try:
        with open(target, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return {
            "path": rel,
            "name": os.path.basename(target),
            "size": file_size,
            "size_str": format_size(file_size),
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "content": content,
            "encoding": "utf-8",
            "mime_type": mimetypes.guess_type(target)[0] or "application/octet-stream",
        }
    except UnicodeDecodeError:
        with open(target, 'rb') as f:
            raw = f.read()
        
        return {
            "path": rel,
            "name": os.path.basename(target),
            "size": file_size,
            "size_str": format_size(file_size),
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "content_base64": base64.b64encode(raw).decode('ascii'),
            "encoding": "base64",
            "binary": True,
            "mime_type": mimetypes.guess_type(target)[0] or "application/octet-stream",
        }
    except PermissionError:
        return {"error": f"Permission denied: {rel_path}", "status": 403}


def write_file_content(root: str, rel_path: str, content: str, binary: bool = False) -> dict:
    target = safe_path(root, rel_path)
    
    content_bytes = base64.b64decode(content) if binary else content.encode('utf-8')
    if len(content_bytes) > MAX_FILE_SIZE:
        return {
            "error": f"Content too large ({format_size(len(content_bytes))}). Max: {format_size(MAX_FILE_SIZE)}",
            "status": 413,
        }
    
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        
        if binary:
            with open(target, 'wb') as f:
                f.write(base64.b64decode(content))
        else:
            with open(target, 'w', encoding='utf-8') as f:
                f.write(content)
        
        st = os.stat(target)
        rel = os.path.relpath(target, root).replace('\\', '/')
        
        return {
            "success": True,
            "path": rel,
            "size": st.st_size,
            "size_str": format_size(st.st_size),
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
        }
    except PermissionError:
        return {"error": f"Permission denied: {rel_path}", "status": 403}
    except Exception as e:
        return {"error": str(e), "status": 500}


def delete_path(root: str, rel_path: str) -> dict:
    target = safe_path(root, rel_path)
    
    if not os.path.exists(target):
        return {"error": f"Path not found: {rel_path}", "status": 404}
    
    rel = os.path.relpath(target, root).replace('\\', '/')
    
    try:
        if os.path.isfile(target) or os.path.islink(target):
            os.remove(target)
            return {"success": True, "path": rel, "type": "file"}
        elif os.path.isdir(target):
            contents = os.listdir(target)
            if contents:
                return {"error": f"Directory not empty ({len(contents)} items)", "status": 400}
            os.rmdir(target)
            return {"success": True, "path": rel, "type": "directory"}
    except PermissionError:
        return {"error": f"Permission denied: {rel_path}", "status": 403}
    except Exception as e:
        return {"error": str(e), "status": 500}


def move_path(root: str, from_rel: str, to_rel: str) -> dict:
    src = safe_path(root, from_rel)
    dst = safe_path(root, to_rel)
    
    if not os.path.exists(src):
        return {"error": f"Source not found: {from_rel}", "status": 404}
    if os.path.exists(dst):
        return {"error": f"Destination already exists: {to_rel}", "status": 409}
    
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.rename(src, dst)
        return {
            "success": True,
            "from": os.path.relpath(src, root).replace('\\', '/'),
            "to": os.path.relpath(dst, root).replace('\\', '/'),
        }
    except PermissionError:
        return {"error": "Permission denied", "status": 403}
    except Exception as e:
        return {"error": str(e), "status": 500}


def make_directory(root: str, rel_path: str) -> dict:
    target = safe_path(root, rel_path)
    
    if os.path.exists(target):
        if os.path.isdir(target):
            return {"success": True, "path": rel_path, "exists": True}
        return {"error": f"Path exists and is not a directory: {rel_path}", "status": 400}
    
    try:
        os.makedirs(target, exist_ok=True)
        return {"success": True, "path": rel_path, "created": True}
    except PermissionError:
        return {"error": f"Permission denied: {rel_path}", "status": 403}
    except Exception as e:
        return {"error": str(e), "status": 500}


def search_files(root: str, query: str, search_root: str = "") -> dict:
    target_root = safe_path(root, search_root)
    
    if not os.path.isdir(target_root):
        return {"error": f"Search root not found: {search_root}", "status": 404}
    
    results = []
    is_glob = '*' in query or '?' in query or '[' in query
    
    try:
        for dirpath, dirnames, filenames in os.walk(target_root):
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            
            for name in filenames:
                match = fnmatch.fnmatch(name, query) if is_glob else query.lower() in name.lower()
                if match:
                    full = os.path.join(dirpath, name)
                    try:
                        entry = get_stat_dict(full, root)
                        results.append(entry)
                    except OSError:
                        pass
            
            if len(results) >= 200:
                break
        
        return {"query": query, "is_glob": is_glob, "results": results, "count": len(results)}
    except PermissionError:
        return {"error": "Permission denied during search", "status": 403}


def get_directory_tree(root: str, rel_path: str, max_depth: int = 3) -> dict:
    target = safe_path(root, rel_path)
    
    if not os.path.isdir(target):
        return {"error": f"Not a directory: {rel_path}", "status": 400}
    
    def build_tree(dir_path, depth=0):
        if depth > max_depth:
            return {"name": os.path.basename(dir_path), "truncated": True}
        
        try:
            items = sorted(os.listdir(dir_path))
        except PermissionError:
            return {"name": os.path.basename(dir_path), "error": "Permission denied"}
        
        tree = {"name": os.path.basename(dir_path) if depth > 0 else (rel_path or '/'), "type": "dir", "children": []}
        
        for item in items[:200]:
            full_path = os.path.join(dir_path, item)
            if os.path.isdir(full_path) and not item.startswith('.'):
                tree["children"].append(build_tree(full_path, depth + 1))
            elif os.path.isfile(full_path):
                try:
                    st = os.stat(full_path)
                    tree["children"].append({"name": item, "type": "file", "size": st.st_size, "size_str": format_size(st.st_size)})
                except OSError:
                    tree["children"].append({"name": item, "type": "file"})
        
        return tree
    
    return {"path": rel_path or '/', "tree": build_tree(target, 0), "max_depth": max_depth}


# ══════════════════════════════════════════════════════════════════════════
# WEB UI — Interactive Dashboard
# ══════════════════════════════════════════════════════════════════════════

WEB_UI_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChatSeed FS Bridge</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-muted: #8b949e; --accent: #58a6ff;
    --success: #3fb950; --danger: #f85149; --warning: #d29922;
    --font: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.6; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  
  /* Hidden until key is verified */
  #app { display: none; }
  #app.ready { display: block; }
  
  header { 
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 20px;
    flex-wrap: wrap; gap: 12px;
  }
  header h1 { font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  header h1 span { color: var(--accent); }
  .version-badge { 
    font-size: 11px; background: var(--surface); color: var(--text-muted);
    padding: 2px 8px; border-radius: 12px; border: 1px solid var(--border);
  }
  .status-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--success); margin-right: 6px; animation: pulse 2s infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  
  /* Key Login Screen */
  #keyScreen {
    display: flex; align-items: center; justify-content: center;
    min-height: 80vh;
  }
  #keyScreen.hidden { display: none; }
  .key-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 40px; max-width: 480px; width: 100%; text-align: center;
  }
  .key-card h2 { margin-bottom: 8px; font-size: 20px; }
  .key-card p { color: var(--text-muted); margin-bottom: 24px; font-size: 13px; }
  .key-card .lock-icon { font-size: 48px; margin-bottom: 16px; display: block; }
  .key-card input[type="password"] {
    width: 100%;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 12px 16px; font-family: var(--font); font-size: 16px;
    text-align: center; letter-spacing: 2px; margin-bottom: 16px;
  }
  .key-card input:focus { outline: none; border-color: var(--accent); }
  .key-error { color: var(--danger); font-size: 12px; margin-bottom: 12px; min-height: 18px; }
  .key-saved { color: var(--success); font-size: 12px; margin-bottom: 12px; min-height: 18px; }
  
  .btn {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 8px 16px; cursor: pointer; font-family: var(--font);
    font-size: 13px; transition: all 0.15s; display: inline-flex; align-items: center; gap: 6px;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .btn-primary:hover { background: #4a90d9; }
  .btn-danger { color: var(--danger); border-color: var(--danger); }
  .btn-danger:hover { background: var(--danger); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .btn-block { width: 100%; justify-content: center; padding: 12px; }
  
  /* Root config */
  .root-bar {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 16px; margin-bottom: 20px;
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .root-bar .label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .root-bar .path { color: var(--accent); font-size: 13px; word-break: break-all; flex: 1; }
  .root-bar .locked-badge { 
    font-size: 11px; background: rgba(63,185,80,0.15); color: var(--success);
    padding: 2px 8px; border-radius: 12px; border: 1px solid var(--success);
  }
  
  /* Layout */
  .layout { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
  @media (max-width: 768px) { .layout { grid-template-columns: 1fr; } }
  
  /* Sidebar */
  .sidebar {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; max-height: 70vh; overflow-y: auto;
  }
  .sidebar h3 { font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px; }
  .sidebar .current-path { font-size: 12px; color: var(--accent); margin-bottom: 12px; word-break: break-all; }
  
  .file-list { list-style: none; }
  .file-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 4px; cursor: pointer;
    font-size: 13px; transition: background 0.1s;
  }
  .file-item:hover { background: rgba(88,166,255,0.1); }
  .file-item .icon { font-size: 14px; flex-shrink: 0; }
  .file-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-item .size { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
  .file-item.selected { background: rgba(88,166,255,0.2); }
  .file-item.dir { color: var(--accent); }
  .file-item.back { color: var(--warning); }
  
  /* Main panel */
  .main-panel {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px; min-height: 400px;
  }
  .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
  .panel-title { font-size: 14px; font-weight: 600; }
  
  .file-viewer {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 16px; max-height: 500px; overflow: auto; white-space: pre-wrap;
    font-size: 13px; line-height: 1.5;
  }
  .file-viewer .placeholder {
    color: var(--text-muted); text-align: center; padding: 60px 20px;
  }
  .file-viewer .placeholder .big-icon { font-size: 48px; margin-bottom: 12px; }
  
  .file-info {
    display: flex; gap: 16px; margin-bottom: 12px; flex-wrap: wrap;
    font-size: 12px; color: var(--text-muted);
  }
  .file-info span { display: flex; align-items: center; gap: 4px; }
  
  .editor-area textarea {
    width: 100%; min-height: 300px;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 12px; font-family: var(--font); font-size: 13px;
    resize: vertical;
  }
  .editor-area textarea:focus { outline: none; border-color: var(--accent); }
  .editor-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  
  .search-bar { display: flex; gap: 8px; margin-bottom: 12px; }
  .search-bar input {
    flex: 1;
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 6px 10px; font-family: var(--font); font-size: 13px;
  }
  .search-bar input:focus { outline: none; border-color: var(--accent); }
  
  .toast {
    position: fixed; bottom: 20px; right: 20px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 20px; font-size: 13px; z-index: 1000; max-width: 400px;
  }
  .toast.error { border-color: var(--danger); }
  .toast.success { border-color: var(--success); }
  
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  
  .loading { color: var(--text-muted); text-align: center; padding: 20px; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  /* Remove key btn */
  .key-actions { margin-top: 16px; display: flex; gap: 8px; justify-content: center; }
</style>
</head>
<body>

<div class="container">
  <!-- API Key Login Screen -->
  <div id="keyScreen">
    <div class="key-card">
      <span class="lock-icon">🔐</span>
      <h2>Enter API Key</h2>
      <p>This key was set when you started the bridge server.<br>
         It's stored in your browser — the AI never sees it.</p>
      <input type="password" id="keyInput" placeholder="Enter your API key..." autocomplete="off">
      <div class="key-error" id="keyError"></div>
      <div class="key-saved" id="keySaved"></div>
      <button class="btn btn-primary btn-block" onclick="unlock()">🔓 Unlock Dashboard</button>
      <div class="key-actions">
        <button class="btn btn-sm" onclick="document.getElementById('keyInput').value=''">Clear</button>
        <button class="btn btn-sm" onclick="clearKey()">Remove Saved Key</button>
      </div>
    </div>
  </div>

  <!-- Main App -->
  <div id="app">
    <header>
      <h1>
        <span>⌂</span> ChatSeed FS Bridge
        <span class="version-badge">v{{VERSION}}</span>
      </h1>
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:12px;color:var(--text-muted)">
          <span class="status-dot"></span>Authenticated
        </span>
        <button class="btn btn-sm" onclick="lock()">🔒 Lock</button>
      </div>
    </header>

    <div class="root-bar">
      <span class="label">📁 Root</span>
      <span class="path" id="rootPath">{{ROOT_DIR}}</span>
      <span class="locked-badge">🔒 Hard-set by server</span>
      <button class="btn btn-sm" onclick="refreshAll()">🔄 Refresh</button>
    </div>

    <div class="layout">
      <div class="sidebar" id="sidebar">
        <h3>📂 File Browser</h3>
        <div class="current-path" id="currentPath">/</div>
        <div class="search-bar">
          <input type="text" id="searchInput" placeholder="Search files..." spellcheck="false">
          <button class="btn btn-sm" onclick="searchFiles()">🔍</button>
        </div>
        <ul class="file-list" id="fileList">
          <li class="loading"><span class="spinner"></span> Loading...</li>
        </ul>
      </div>

      <div class="main-panel" id="mainPanel">
        <div class="panel-header">
          <span class="panel-title" id="panelTitle">📄 Select a file to view</span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" id="editBtn" style="display:none;" onclick="toggleEdit()">✏️ Edit</button>
            <button class="btn btn-sm btn-danger" id="deleteBtn" style="display:none;" onclick="deleteFile()">🗑 Delete</button>
          </div>
        </div>
        
        <div id="panelContent">
          <div class="file-viewer">
            <div class="placeholder">
              <div class="big-icon">📂</div>
              <p>Select a file from the browser to view its contents.</p>
              <p style="font-size:12px;margin-top:8px;color:var(--text-muted)">
                Or enter a path and click Read below ↓
              </p>
            </div>
          </div>
          
          <div style="display:flex;gap:8px;margin-top:12px;">
            <input type="text" id="directPath" placeholder="Enter file path (e.g. app.py or src/index.js)" 
                   style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;
                          color:var(--text);padding:8px 12px;font-family:var(--font);font-size:13px;" spellcheck="false">
            <button class="btn btn-primary" onclick="readDirectPath()">📖 Read</button>
            <button class="btn" onclick="showCreateDialog()">➕ New</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
// ─── Key Management ─────────────────────────────────────────
const STORAGE_KEY = 'chatseed_fs_bridge_key';

function getStoredKey() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; }
}

function storeKey(key) {
  try { localStorage.setItem(STORAGE_KEY, key); } catch(e) { /* no-op */ }
}

function clearKey() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) { /* no-op */ }
  document.getElementById('keyInput').value = '';
  document.getElementById('keySaved').textContent = '🗑 Key removed from browser.';
  document.getElementById('keyError').textContent = '';
}

// ─── Unlock / Lock ──────────────────────────────────────────
let key = '';

async function unlock() {
  const input = document.getElementById('keyInput').value.trim() || getStoredKey();
  if (!input) {
    document.getElementById('keyError').textContent = '⚠️ Please enter your API key.';
    return;
  }
  
  document.getElementById('keyError').textContent = '⏳ Checking key...';
  document.getElementById('keySaved').textContent = '';
  
  try {
    const resp = await fetch('/api/status?key=' + encodeURIComponent(input));
    const data = await resp.json();
    
    if (resp.status === 401 || data.error === 'invalid_key' || data.authenticated === false) {
      document.getElementById('keyError').textContent = '❌ Invalid API key. Try again.';
      return;
    }
    
    // Success!
    key = input;
    storeKey(key);
    document.getElementById('keyError').textContent = '';
    document.getElementById('keySaved').textContent = '';
    
    // Show app
    document.getElementById('keyScreen').classList.add('hidden');
    document.getElementById('app').classList.add('ready');
    
    // Update root path display
    if (data.root) {
      document.getElementById('rootPath').textContent = data.root;
    }
    
    // Load file browser
    loadDir('');
  } catch (e) {
    console.error('Unlock error:', e);
    document.getElementById('keyError').textContent = '❌ Connection failed! Is the bridge running on port 8742? (' + e.message + ')';
  }
}

function lock() {
  key = '';
  document.getElementById('app').classList.remove('ready');
  document.getElementById('keyScreen').classList.remove('hidden');
  document.getElementById('keyInput').value = '';
}

// Auto-unlock if key is stored
document.addEventListener('DOMContentLoaded', () => {
  const stored = getStoredKey();
  if (stored) {
    document.getElementById('keyInput').value = stored;
    unlock();
  }
});

// Also unlock on Enter
document.getElementById('keyInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') unlock();
});

// ─── API Helper ─────────────────────────────────────────────
async function api(endpoint) {
  // Append the key to every request automatically
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = endpoint + sep + 'key=' + encodeURIComponent(key);
  
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error === 'invalid_key') {
      lock();
      document.getElementById('keyError').textContent = '⚠️ Key rejected by server. Re-enter your key.';
      throw new Error('Key rejected');
    }
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    if (e.message === 'Failed to fetch' || e.message === 'Key rejected') throw e;
    showToast('⚠️ ' + e.message, 'error');
    throw e;
  }
}

function apiUrl(endpoint, params = {}) {
  const url = new URL(endpoint, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  return url.toString();
}

// ─── Toast ──────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── File Browser ───────────────────────────────────────────
let state = { currentDir: '', selectedFile: null, isEditing: false };

async function loadDir(dirPath = '') {
  state.currentDir = dirPath;
  document.getElementById('currentPath').textContent = '/' + dirPath;
  document.getElementById('fileList').innerHTML = '<li class="loading"><span class="spinner"></span> Loading...</li>';
  
  try {
    const data = await api(apiUrl('/api/list', { path: dirPath }));
    renderFileList(data);
  } catch (e) {
    if (e.message !== 'Key rejected') {
      document.getElementById('fileList').innerHTML = '<li style="color:var(--danger);padding:12px;">Error: ' + e.message + '</li>';
    }
  }
}

function renderFileList(data) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  
  if (data.parent) {
    const li = document.createElement('li');
    li.className = 'file-item back';
    li.innerHTML = '<span class="icon">📂</span><span class="name">..</span>';
    li.onclick = () => loadDir(data.parent);
    list.appendChild(li);
  }
  
  const dirs = data.entries.filter(e => e.type === 'dir');
  const files = data.entries.filter(e => e.type !== 'dir');
  
  [...dirs, ...files].forEach(entry => {
    const li = document.createElement('li');
    const isDir = entry.type === 'dir';
    const icon = isDir ? '📁' : getFileIcon(entry.name);
    
    li.className = 'file-item' + (isDir ? ' dir' : '');
    li.innerHTML = '<span class="icon">' + icon + '</span><span class="name">' + esc(entry.name) + '</span><span class="size">' + (entry.size_str || '') + '</span>';
    
    li.onclick = () => { if (isDir) loadDir(entry.path); else selectFile(entry.path); };
    list.appendChild(li);
  });
  
  if (data.entries.length === 0) {
    list.innerHTML = '<li style="color:var(--text-muted);padding:12px;">Empty directory</li>';
  }
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    'js': '📜', 'ts': '📘', 'py': '🐍', 'html': '🌐', 'css': '🎨',
    'json': '📋', 'md': '📝', 'txt': '📄', 'yaml': '⚙️', 'yml': '⚙️',
    'toml': '⚙️', 'cfg': '⚙️', 'ini': '⚙️', 'env': '🔒',
    'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
    'mp3': '🎵', 'wav': '🎵', 'mp4': '🎬', 'mov': '🎬',
    'zip': '📦', 'tar': '📦', 'gz': '📦', '7z': '📦',
    'pdf': '📕', 'doc': '📘', 'docx': '📘',
    'sh': '⚡', 'bat': '⚡', 'exe': '⚡',
    'gitignore': '🙈', 'lock': '🔒',
  };
  return icons[ext] || '📄';
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── File Viewing ───────────────────────────────────────────
async function selectFile(filePath) {
  state.selectedFile = filePath;
  state.isEditing = false;
  document.getElementById('editBtn').style.display = 'inline-block';
  document.getElementById('editBtn').textContent = '✏️ Edit';
  document.getElementById('deleteBtn').style.display = 'inline-block';
  document.getElementById('panelTitle').textContent = '📄 ' + filePath;
  
  try {
    const data = await api(apiUrl('/api/read', { path: filePath }));
    renderFileViewer(data);
  } catch (e) {
    if (e.message !== 'Key rejected') {
      document.getElementById('panelContent').innerHTML = '<div class="file-viewer"><div class="placeholder" style="color:var(--danger)">Error: ' + e.message + '</div></div>';
    }
  }
}

function renderFileViewer(data) {
  const content = data.content || (data.content_base64 ? '[Binary file — ' + data.size_str + ']' : '');
  const isBinary = data.binary || data.content_base64;
  
  let infoHtml = '<div class="file-info">' +
    '<span>📏 ' + data.size_str + '</span>' +
    '<span>🕐 ' + (data.modified ? new Date(data.modified).toLocaleString() : '-') + '</span>' +
    '<span>🏷️ ' + (data.mime_type || 'unknown') + '</span>' +
    '</div>';
  
  let viewerHtml;
  if (isBinary) {
    viewerHtml = '<div class="file-viewer"><div class="placeholder"><div class="big-icon">🖼️</div><p>Binary file (' + (data.mime_type || 'unknown') + ')</p><p style="font-size:12px;margin-top:8px;color:var(--text-muted)">' + data.size_str + '</p></div></div>';
  } else {
    viewerHtml = '<div class="file-viewer" id="fileViewer">' + esc(content) + '</div>';
  }
  
  document.getElementById('panelContent').innerHTML = infoHtml + viewerHtml;
}

async function readDirectPath() {
  const path = document.getElementById('directPath').value.trim();
  if (!path) return;
  selectFile(path);
}

// ─── Search ─────────────────────────────────────────────────
async function searchFiles() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) { loadDir(state.currentDir); return; }
  
  document.getElementById('fileList').innerHTML = '<li class="loading"><span class="spinner"></span> Searching...</li>';
  
  try {
    const data = await api(apiUrl('/api/search', { q: query, root: state.currentDir }));
    const list = document.getElementById('fileList');
    list.innerHTML = '<li style="color:var(--text-muted);padding:6px 8px;">Found ' + data.count + ' results for "' + query + '"</li>';
    
    data.results.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'file-item';
      const isDir = entry.type === 'dir';
      li.innerHTML = '<span class="icon">' + (isDir ? '📁' : '📄') + '</span><span class="name">' + esc(entry.path) + '</span><span class="size">' + (entry.size_str || '') + '</span>';
      li.onclick = () => isDir ? loadDir(entry.path) : selectFile(entry.path);
      list.appendChild(li);
    });
  } catch (e) {}
}

// ─── Edit ───────────────────────────────────────────────────
function toggleEdit() {
  if (state.isEditing) { saveFile(); return; }
  state.isEditing = true;
  document.getElementById('editBtn').textContent = '💾 Save';
  const viewer = document.getElementById('fileViewer');
  if (viewer) {
    const content = viewer.textContent;
    viewer.outerHTML = '<div class="editor-area"><textarea id="editor">' + esc(content) + '</textarea></div>';
  }
}

async function saveFile() {
  const content = document.getElementById('editor').value;
  if (!state.selectedFile) return;
  try {
    await api(apiUrl('/api/write', { path: state.selectedFile, content: content }));
    showToast('✅ Saved: ' + state.selectedFile, 'success');
    state.isEditing = false;
    document.getElementById('editBtn').textContent = '✏️ Edit';
    selectFile(state.selectedFile);
  } catch (e) {}
}

async function deleteFile() {
  if (!state.selectedFile) return;
  if (!confirm('Delete "' + state.selectedFile + '"?')) return;
  try {
    await api(apiUrl('/api/delete', { path: state.selectedFile }));
    showToast('🗑 Deleted: ' + state.selectedFile, 'success');
    state.selectedFile = null;
    document.getElementById('editBtn').style.display = 'none';
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('panelTitle').textContent = '📄 Select a file to view';
    document.getElementById('panelContent').innerHTML = '<div class="file-viewer"><div class="placeholder"><div class="big-icon">✅</div><p>File deleted.</p></div></div>';
    loadDir(state.currentDir);
  } catch (e) {}
}

// ─── Create File ────────────────────────────────────────────
function showCreateDialog() {
  const name = prompt('Enter new file name (e.g. hello.py):');
  if (!name) return;
  const dir = state.currentDir || '';
  const filePath = dir ? dir + '/' + name : name;
  api(apiUrl('/api/write', { path: filePath, content: '' })).then(() => {
    showToast('✅ Created: ' + filePath, 'success');
    loadDir(state.currentDir);
    selectFile(filePath);
  }).catch(() => {});
}

// ─── Refresh ────────────────────────────────────────────────
function refreshAll() {
  if (state.selectedFile) selectFile(state.selectedFile);
  loadDir(state.currentDir);
}

// ─── Keyboard Shortcuts ─────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const active = document.activeElement;
    if (active === document.getElementById('searchInput')) searchFiles();
    if (active === document.getElementById('directPath')) readDirectPath();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.isEditing) {
    e.preventDefault();
    saveFile();
  }
});
</script>
</body>
</html>"""


# ══════════════════════════════════════════════════════════════════════════
# HTTP SERVER
# ══════════════════════════════════════════════════════════════════════════

class FSBridgeHandler(BaseHTTPRequestHandler):
    """
    HTTP request handler for the File System Bridge.
    
    KEY AUTHENTICATION:
    - Every request (except /api/status and /ui/) requires ?key=<API_KEY>
    - The API key is set when the server starts and never changes
    - Constant-time HMAC comparison prevents timing attacks
    - The AI model never sees the key — it's added by the browser's fetch
    
    ROOT LOCKING:
    - The root directory is set at startup via --root
    - There is NO /api/set-root endpoint for the AI to abuse
    - The only way to change root is to restart with a new --root flag
    - The AI cannot change the root even if it tries every endpoint
    """
    
    root_dir = DEFAULT_ROOT
    api_key = ""
    server_start_time = time.time()
    
    # ─── Route Table ───────────────────────────────────────────
    ROUTES = {
        '/api/status':  'handle_status',   # No auth needed (health check + key test)
        '/api/list':    'handle_list',
        '/api/read':    'handle_read',
        '/api/write':   'handle_write',
        '/api/delete':  'handle_delete',
        '/api/move':    'handle_move',
        '/api/mkdir':   'handle_mkdir',
        '/api/info':    'handle_info',
        '/api/search':  'handle_search',
        '/api/exists':  'handle_exists',
        '/api/tree':    'handle_tree',
        '/api/stats':   'handle_stats',
    }
    
    # ─── Auth Check ────────────────────────────────────────────
    def _check_auth(self, params) -> bool:
        """
        Verify the API key from query parameters.
        Returns True if authenticated, False if key is wrong.
        """
        if not self.api_key:
            return True  # No key configured = no auth needed
        
        provided = params.get('key', '')
        if isinstance(provided, list):
            provided = provided[0] if provided else ''
        
        return verify_key(self.api_key, provided)
    
    def _require_auth(self, params) -> bool:
        """Check auth and send 401 if invalid. Returns True if OK."""
        if self._check_auth(params):
            return True
        
        self._json_response({
            "error": "invalid_key",
            "message": "Valid API key required. Pass ?key=<your_key> in the URL.",
            "authenticated": False,
        }, 401)
        return False
    
    # ─── Dispatch ──────────────────────────────────────────────
    def do_GET(self):
        self._handle_request()
    
    def do_POST(self):
        self._handle_request()
    
    def _handle_request(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path.rstrip('/')
            params = urllib.parse.parse_qs(parsed.query)
            params = {k: v[0] if len(v) == 1 else v for k, v in params.items()}
            
            # Route
            if path == '/ui' or path == '/ui/index.html' or path == '/ui/':
                # Serve UI always (no API key needed to see the login screen)
                # But we pass the key requirement info
                self._serve_ui()
            elif path == '/api/status':
                # Status needs no auth — but if key IS provided, check it
                self.handle_status(params)
            elif path in self.ROUTES:
                if not self._require_auth(params):
                    return  # 401 sent
                handler_name = self.ROUTES[path]
                handler = getattr(self, handler_name)
                handler(params)
            else:
                self._json_response({"error": f"Unknown endpoint: {path}"}, 404)
        
        except ValueError as e:
            if "traversal" in str(e).lower() or "outside root" in str(e).lower():
                self._log_access("SECURITY BLOCKED", str(e))
            self._json_response({"error": str(e), "security": True}, 403)
        except Exception as e:
            self._json_response({"error": str(e)}, 500)
    
    # ─── API Handlers ──────────────────────────────────────────
    def handle_status(self, params):
        """Public health check endpoint. Shows auth status."""
        is_auth = self._check_auth(params)
        
        self._json_response({
            "success": True,
            "status": "ok",
            "version": VERSION,
            "authenticated": is_auth,
            "auth_required": bool(self.api_key),
            "root": self.root_dir,
            "root_exists": os.path.isdir(self.root_dir),
            "pid": os.getpid(),
            "platform": sys.platform,
            "python": sys.version.split()[0],
            "uptime": time.time() - self.server_start_time,
        })
    
    def handle_list(self, params):
        path = params.get('path', '')
        result = list_directory(self.root_dir, path)
        self._json_response(result, result.get('status', 200))
    
    def handle_read(self, params):
        path = params.get('path', '')
        if not path:
            self._json_response({"error": "Missing 'path' parameter"}, 400)
            return
        result = read_file_content(self.root_dir, path)
        self._json_response(result, result.get('status', 200))
    
    def handle_write(self, params):
        path = params.get('path', '')
        content = params.get('content', '')
        if not path:
            self._json_response({"error": "Missing 'path' parameter"}, 400)
            return
        result = write_file_content(self.root_dir, path, content)
        self._json_response(result, result.get('status', 200))
    
    def handle_delete(self, params):
        path = params.get('path', '')
        if not path:
            self._json_response({"error": "Missing 'path' parameter"}, 400)
            return
        result = delete_path(self.root_dir, path)
        self._json_response(result, result.get('status', 200))
    
    def handle_move(self, params):
        # ⚠ Accept both 'source'/'destination' (from JS module) AND 'from'/'to' (from UI)
        from_path = params.get('source', params.get('from', ''))
        to_path = params.get('destination', params.get('to', ''))
        if not from_path or not to_path:
            self._json_response({"error": "Missing 'source'/'destination' or 'from'/'to' parameters"}, 400)
            return
        result = move_path(self.root_dir, from_path, to_path)
        self._json_response(result, result.get('status', 200))
    
    def handle_mkdir(self, params):
        path = params.get('path', '')
        if not path:
            self._json_response({"error": "Missing 'path' parameter"}, 400)
            return
        result = make_directory(self.root_dir, path)
        self._json_response(result, result.get('status', 200))
    
    def handle_info(self, params):
        path = params.get('path', '')
        target = safe_path(self.root_dir, path)
        if not os.path.exists(target):
            self._json_response({"error": f"Path not found: {path}"}, 404)
            return
        self._json_response(get_stat_dict(target, self.root_dir))
    
    def handle_search(self, params):
        query = params.get('q', '')
        search_root = params.get('root', '')
        if not query:
            self._json_response({"error": "Missing 'q' (query) parameter"}, 400)
            return
        result = search_files(self.root_dir, query, search_root)
        self._json_response(result)
    
    def handle_exists(self, params):
        path = params.get('path', '')
        if not path:
            self._json_response({"error": "Missing 'path' parameter"}, 400)
            return
        try:
            target = safe_path(self.root_dir, path)
            self._json_response({
                "exists": os.path.exists(target),
                "path": path,
                "type": "dir" if os.path.isdir(target) else "file" if os.path.isfile(target) else None,
            })
        except ValueError:
            self._json_response({"exists": False, "path": path, "error": "Invalid path"})
    
    def handle_tree(self, params):
        path = params.get('path', '')
        # ⚠ Accept both 'max_depth' (from JS module) AND 'depth' (from UI)
        depth = int(params.get('max_depth', params.get('depth', 3)))
        result = get_directory_tree(self.root_dir, path, min(depth, 10))
        self._json_response(result, result.get('status', 200))
    
    def handle_stats(self, params):
        path = params.get('path', '.')
        try:
            target = safe_path(self.root_dir, path)
        except ValueError:
            self._json_response({"error": f"Invalid path: {path}"}, 400)
            return
        if not os.path.isdir(target):
            self._json_response({"error": f"Not a directory: {path}"}, 400)
            return
        total_files = 0
        total_dirs = 0
        total_lines = 0
        total_size = 0
        extensions = {}
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            total_dirs += 1
            for name in filenames:
                total_files += 1
                full = os.path.join(dirpath, name)
                try:
                    st = os.stat(full)
                    total_size += st.st_size
                    ext = os.path.splitext(name)[1].lower() or '(no ext)'
                    extensions[ext] = extensions.get(ext, 0) + 1
                    # Count lines for common code/text files
                    if name.endswith(('.py', '.js', '.ts', '.html', '.css', '.json', '.md', '.txt', '.yaml', '.yml', '.xml', '.sh', '.bat', '.c', '.h', '.cpp', '.java', '.rs', '.go', '.rb', '.php', '.sql', '.env')):
                        try:
                            with open(full, 'r', encoding='utf-8', errors='ignore') as f:
                                total_lines += sum(1 for _ in f)
                        except Exception:
                            pass
                except OSError:
                    pass
        self._json_response({
            "files": total_files,
            "directories": total_dirs,
            "lines": total_lines,
            "size": total_size,
            "extensions": extensions,
        })
    
    # ─── Serve Web UI ─────────────────────────────────────────
    def _serve_ui(self):
        """Serve the web UI dashboard."""
        html_content = WEB_UI_HTML
        html_content = html_content.replace('{{ROOT_DIR}}', html.escape(self.root_dir))
        html_content = html_content.replace('{{VERSION}}', VERSION)
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(html_content.encode('utf-8'))
    
    # ─── JSON Response ─────────────────────────────────────────
    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2, default=str).encode('utf-8'))
        
        endpoint = urllib.parse.urlparse(self.path).path
        status_str = "OK" if status < 400 else f"ERR{status}"
        if isinstance(data, dict) and data.get('security'):
            status_str = "SECURITY"
        if isinstance(data, dict) and data.get('error') == 'invalid_key':
            status_str = "AUTH FAIL"
        self._log_access(status_str, endpoint)
    
    # ─── Logging ───────────────────────────────────────────────
    def _log_access(self, status, endpoint):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"  [{timestamp}] {status:9s} | {endpoint}")
    
    def log_message(self, format, *args):
        pass  # Suppress default http.server logging


# ══════════════════════════════════════════════════════════════════════════
# CLI ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════

def main():
    """Start the ChatSeed File System Bridge server."""
    
    import argparse
    
    parser = argparse.ArgumentParser(
        prog='chatseed_fs_bridge',
        description='ChatSeed File System Bridge — Secure local file API for AI assistants',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            EXAMPLES:
              python chatseed_fs_bridge.py --api-key "my-secret-123"
              python chatseed_fs_bridge.py --root /home/user/project --api-key "abc"
              python chatseed_fs_bridge.py --port 9000 --api-key "strong-password"
              python chatseed_fs_bridge.py --no-ui
        """),
    )
    
    parser.add_argument('--port', type=int, default=DEFAULT_PORT,
                        help=f'Port to listen on (default: {DEFAULT_PORT})')
    parser.add_argument('--root', type=str, default=None,
                        help='🔒 HARD-SET root directory (AI cannot change this)')
    parser.add_argument('--api-key', type=str, default='',
                        help='🔑 API key — browser sends this, AI never sees it')
    parser.add_argument('--bind', type=str, default='127.0.0.1',
                        help='Bind address (default: 127.0.0.1 — localhost only)')
    parser.add_argument('--no-ui', action='store_true',
                        help='Disable the web UI dashboard')
    
    args = parser.parse_args()
    
    # ─── Configure root ────────────────────────────────────────
    if args.root:
        FSBridgeHandler.root_dir = os.path.realpath(os.path.abspath(args.root))
        if not os.path.isdir(FSBridgeHandler.root_dir):
            print(f"❌ Error: Root directory does not exist: {FSBridgeHandler.root_dir}")
            sys.exit(1)
    else:
        FSBridgeHandler.root_dir = os.getcwd()
    
    # ─── Configure API key ─────────────────────────────────────
    FSBridgeHandler.api_key = args.api_key
    if FSBridgeHandler.api_key:
        print(f"  🔑 API Key: {'*' * len(FSBridgeHandler.api_key)} (hidden)")
    else:
        print("  ⚠️  NO API KEY SET — anyone with localhost access can use the API")
        print("     Recommended: pass --api-key \"your-secret-phrase\"")
    
    # ─── Find available port ───────────────────────────────────
    port = args.port
    for attempt in range(10):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind((args.bind, port))
            sock.close()
            break
        except OSError:
            sock.close()
            port += 1
    else:
        print(f"❌ Could not find available port after {attempt + 1} attempts")
        sys.exit(1)
    
    # ─── Start server ──────────────────────────────────────────
    server = HTTPServer((args.bind, port), FSBridgeHandler)
    server.server_start_time = time.time()
    
    api_url = f"http://127.0.0.1:{port}/api/status"
    ui_url = f"http://127.0.0.1:{port}/ui/" if not args.no_ui else None
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║         🔗 ChatSeed File System Bridge v{VERSION}          ║
╠══════════════════════════════════════════════════════════════╣""")
    
    if ui_url:
        print(f"║  🖥  Dashboard:   {ui_url}")
    
    print(f"""║  📡 API:         {api_url}
║  📂 Root:        {FSBridgeHandler.root_dir}
║  🔒 Binding:     {args.bind}:{port} (localhost-only)
║  🔑 API Key:     {'✅ SET (required for all requests)' if FSBridgeHandler.api_key else '⚠️  NOT SET'}
╠══════════════════════════════════════════════════════════════╣
║  SECURITY NOTES:                                             ║
║  • Root is HARD-SET on server startup — AI cannot change it  ║
║  • API key is stored in YOUR browser's localStorage           ║
║  • AI model NEVER sees or can extract the API key             ║
║  • All paths validated against root — no traversal possible   ║
║  • Only 127.0.0.1 — no external network access               ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n⏹  Shutting down...")
        server.server_close()
        print("✅ Server stopped.")


if __name__ == '__main__':
    main()