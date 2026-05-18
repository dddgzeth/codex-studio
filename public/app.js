const state = {
  sessions: [],
  currentSessionId: localStorage.getItem("currentSessionId"),
  currentDetail: null,
  workspaceRoot: localStorage.getItem("workspaceRoot") || "",
  ws: null,
  outputFormat: localStorage.getItem("outputFormat") || "md"
};

const els = {
  sessionList: document.querySelector("#session-list"),
  sessionTitle: document.querySelector("#session-title"),
  sessionMeta: document.querySelector("#session-meta"),
  sessionContent: document.querySelector("#session-content"),
  workspaceInput: document.querySelector("#workspace-input"),
  composerInput: document.querySelector("#composer-input"),
  contextWorkspace: document.querySelector("#context-workspace"),
  modifiedFiles: document.querySelector("#modified-files"),
  recentEvents: document.querySelector("#recent-events"),
  searchResults: document.querySelector("#search-results"),
  searchInput: document.querySelector("#search-input"),
  contextPanel: document.querySelector("#context-panel"),
  contextToggleButton: document.querySelector("#context-toggle-button"),
  stopButton: document.querySelector("#stop-button"),
  sendButton: document.querySelector("#send-button"),
  fmtMd: document.querySelector("#fmt-md"),
  fmtHtml: document.querySelector("#fmt-html")
};

els.workspaceInput.value = state.workspaceRoot;

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMd(text) {
  return escapeHtml(String(text || ""))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderList(lines, start) {
  const first = lines[start];
  const ordered = /^\s*\d+\.\s+/.test(first);
  const tag = ordered ? "ol" : "ul";
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const markerMatch = ordered
      ? line.match(/^\s*\d+\.\s+(.*)$/)
      : line.match(/^\s*[-*]\s+(.*)$/);
    if (!markerMatch) break;

    const itemLines = [markerMatch[1]];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        i += 1;
        break;
      }
      if ((ordered && /^\s*\d+\.\s+/.test(next)) || (!ordered && /^\s*[-*]\s+/.test(next))) {
        break;
      }
      if (/^\s{2,}\S/.test(next) || !/^\s*([#>|-]|\d+\.)\s+/.test(next)) {
        itemLines.push(next.trim());
        i += 1;
        continue;
      }
      break;
    }

    items.push(`<li>${itemLines.map((part) => inlineMd(part)).join("<br />")}</li>`);
  }

  return {
    html: `<${tag}>${items.join("")}</${tag}>`,
    nextIndex: i
  };
}

function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const chunks = [];

  for (let i = 0; i < lines.length;) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      chunks.push(`<h${level}>${inlineMd(line.replace(/^#{1,3}\s+/, ""))}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      chunks.push(`<blockquote>${quote.map((part) => inlineMd(part)).join("<br />")}</blockquote>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      chunks.push("<hr />");
      i += 1;
      continue;
    }

    if (/^\s*(\d+\.\s+|[-*]\s+)/.test(line)) {
      const list = renderList(lines, i);
      chunks.push(list.html);
      i = list.nextIndex;
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (/^#{1,3}\s+/.test(next.trim()) || /^>\s?/.test(next.trim()) || /^(-{3,}|\*{3,})\s*$/.test(next.trim()) || /^\s*(\d+\.\s+|[-*]\s+)/.test(next)) {
        break;
      }
      paragraph.push(next.trim());
      i += 1;
    }
    chunks.push(`<p>${paragraph.map((part) => inlineMd(part)).join("<br />")}</p>`);
  }

  return chunks.join("");
}

function formatSessionStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function showToast(msg, type = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function setItems(target, items) {
  target.innerHTML = items.length
    ? items.map((item) => `<div class="context-item">${item}</div>`).join("")
    : `<div class="context-item">No data yet</div>`;
}

const HTML_TAG_RE = /<(div|section|article|table|ul|ol|h[1-6]|p|pre|code|span|a|img|style|form|button|input|select|nav|header|footer|main|svg|path|circle|rect|line|polyline)[^>]*>/i;

function looksLikeHtml(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return /<!DOCTYPE html>/i.test(value) || /<html[\s>]/i.test(value) || HTML_TAG_RE.test(value);
}

// 监听 iframe 内部 postMessage 汇报的内容高度
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "iframe-resize") {
    const frame = document.getElementById(e.data.id);
    if (frame) frame.style.height = (e.data.h + 32) + "px";
  }
});

function renderHtmlFragmentBlock(html, filename) {
  const uid = "hf-" + Math.random().toString(36).slice(2, 10);

  // 注入到 iframe 内部：脚本加载后通过 postMessage 上报真实高度，并用 ResizeObserver 持续跟踪
  const resizeScript = `<script>(function(){
    function report(){parent.postMessage({type:'iframe-resize',id:'${uid}',h:document.documentElement.scrollHeight},'*');}
    window.addEventListener('load',function(){report();setTimeout(report,300);});
    if(window.ResizeObserver){new ResizeObserver(report).observe(document.body);}
  })()</script>`;

  const srcdocContent = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 24px 28px; margin: 0;
         color: #18181b; line-height: 1.75; font-size: 14.5px; }
  h1 { font-size: 1.5em; font-weight: 700; margin: 0 0 16px; padding-bottom: 10px;
       border-bottom: 2px solid #e4e4e7; color: #09090b; }
  h2 { font-size: 1.2em; font-weight: 700; margin: 24px 0 10px; color: #6366f1; }
  h3 { font-size: 1.05em; font-weight: 600; margin: 18px 0 8px; color: #3f3f46; }
  p { margin: 0 0 12px; }
  strong { font-weight: 600; color: #09090b; }
  em { color: #52525b; }
  a { color: #6366f1; text-underline-offset: 2px; }
  code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.82em;
         background: #f4f4f5; border-radius: 4px; padding: 2px 6px; color: #6366f1; }
  pre { background: #1e1e2e; border-radius: 10px; padding: 16px 18px; overflow-x: auto; margin: 0 0 14px; }
  pre code { background: none; padding: 0; color: #cdd6f4; font-size: 0.84em; }
  blockquote { border-left: 3px solid #6366f1; margin: 0 0 14px; padding: 10px 16px;
               background: rgba(99,102,241,0.06); border-radius: 0 6px 6px 0; color: #52525b; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 16px; border-radius: 8px; overflow: hidden; }
  thead th { background: #6366f1; color: #fff; font-weight: 600; font-size: 0.8em;
             text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 14px; text-align: left; }
  tbody tr:nth-child(even) { background: #f4f4f5; }
  tbody tr:hover { background: rgba(99,102,241,0.06); }
  td { padding: 9px 14px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  ul, ol { padding-left: 22px; margin: 0 0 12px; }
  li { margin-bottom: 6px; line-height: 1.65; }
  li::marker { color: #6366f1; }
  hr { border: none; border-top: 1px solid #e4e4e7; margin: 20px 0; }
</style>
${resizeScript}
</head><body>${html}</body></html>`;

  const srcdocAttr = srcdocContent.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const labelText = filename ? escapeHtml(filename) : "HTML output";
  return `<section class="block block-html-fragment">
    <div class="html-fragment-label"><i data-lucide="code-2"></i> ${labelText}</div>
    <iframe id="${uid}" class="html-fragment-frame"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
      srcdoc="${srcdocAttr}"></iframe>
  </section>`;
}

function classifyAndRenderMd(text) {
  const hasH2 = /^##\s/m.test(text);
  const hasH3 = /^###\s/m.test(text);
  const lineCount = text.trim().split("\n").length;
  const isShort = text.trim().length < 350 && lineCount < 8;
  const hasList = /^\s*(\d+\.|[-*])\s/m.test(text);

  let cls = "block-assistant md-html";
  if (hasH2) cls += " md-report";
  else if (isShort) cls += " md-answer";
  else if (hasList && !hasH3) cls += " md-listheavy";

  const parsed = window.marked ? window.marked.parse(text) : renderMarkdown(text);
  return `<section class="block ${cls}">${parsed}</section>`;
}

function renderBlock(block) {
  const html = state.outputFormat === "html";

  if (block.type === "markdown") {
    if (block.role === "user") {
      return `<section class="block block-user"><span class="block-role-label">You</span>${renderMarkdown(block.text)}</section>`;
    }
    if (html && looksLikeHtml(block.text)) {
      return renderHtmlFragmentBlock(block.text);
    }
    if (html) {
      return classifyAndRenderMd(block.text);
    }
    return `<section class="block block-assistant markdown">${renderMarkdown(block.text)}</section>`;
  }

  if (block.type === "code") {
    if (html && (/^html?$/i.test(block.language.trim()) || looksLikeHtml(block.code))) {
      return renderHtmlFragmentBlock(block.code);
    }
    return `<section class="block"><div class="kicker">${escapeHtml(block.language)}</div><pre><code>${escapeHtml(block.code)}</code></pre></section>`;
  }

  if (block.type === "log") {
    return `<section class="block"><div class="kicker">${escapeHtml(block.command || "log")}</div><pre><code>${escapeHtml(block.text)}</code></pre></section>`;
  }

  if (block.type === "diff") {
    const lines = block.diff.split("\n").map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return `<div class="diff-line added">${escapeHtml(line)}</div>`;
      if (line.startsWith("-") && !line.startsWith("---")) return `<div class="diff-line removed">${escapeHtml(line)}</div>`;
      if (line.startsWith("@@")) return `<div class="diff-line diff-hunk">${escapeHtml(line)}</div>`;
      return `<div class="diff-line">${escapeHtml(line)}</div>`;
    }).join("");
    return `<section class="block diff"><div class="diff-header"><span class="kicker">diff</span><span class="diff-path">${escapeHtml(block.path)}</span></div><div class="diff-body">${lines}</div></section>`;
  }

  if (block.type === "table") {
    const isSep = (row) => row.every((c) => /^-+:?$/.test(c.trim()));
    const dataRows = block.rows.filter((r) => !isSep(r));
    if (html && dataRows.length >= 2) {
      const header = dataRows[0].map((cell) => `<th>${inlineMd(cell)}</th>`).join("");
      const body = dataRows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join("")}</tr>`).join("");
      return `<section class="block block-table-rich"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></section>`;
    }
    const rows = dataRows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join("")}</tr>`).join("");
    return `<section class="block"><table>${rows}</table></section>`;
  }

  if (block.type === "checklist") {
    if (html) {
      const done = block.items.filter((i) => i.checked).length;
      const pct = Math.round((done / block.items.length) * 100);
      const items = block.items.map((item) => `<div class="check-item ${item.checked ? "checked" : ""}">
        <span class="check-icon">${item.checked ? "✓" : "○"}</span>
        <span class="check-text">${escapeHtml(item.text)}</span>
      </div>`).join("");
      return `<section class="block block-checklist-rich">
        <div class="checklist-progress"><div class="checklist-bar" style="width:${pct}%"></div></div>
        <div class="checklist-meta">${done} / ${block.items.length} 完成</div>
        ${items}
      </section>`;
    }
    return `<section class="block"><ul>${block.items
      .map((item) => `<li>${item.checked ? "✓" : "○"} ${escapeHtml(item.text)}</li>`)
      .join("")}</ul></section>`;
  }

  if (block.type === "timeline") {
    if (html) {
      const steps = block.items.map((item, i) => `<div class="timeline-step">
        <div class="timeline-num">${i + 1}</div>
        <div class="timeline-body">${inlineMd(item)}</div>
      </div>`).join("");
      return `<section class="block block-timeline-rich">${steps}</section>`;
    }
    return `<section class="block markdown"><ol>${block.items.map((item) => `<li>${inlineMd(item)}</li>`).join("")}</ol></section>`;
  }

  if (block.type === "callout") {
    if (html) {
      const icon = block.level === "warning" ? "⚠️" : "ℹ️";
      return `<section class="block block-callout-rich block-callout-${block.level}">
        <span class="callout-icon">${icon}</span>
        <div class="callout-body">${renderMarkdown(block.text)}</div>
      </section>`;
    }
    return `<section class="block callout-${block.level} markdown"><strong>${escapeHtml(block.level)}</strong>${renderMarkdown(block.text)}</section>`;
  }

  if (block.type === "task_status") {
    return `<section class="block"><span class="status-pill">${escapeHtml(block.label)} · ${escapeHtml(block.status)}</span></section>`;
  }

  if (block.type === "file_change_summary") {
    return `<section class="block"><div class="kicker">File changes</div><ul>${block.files
      .map((file) => `<li>${escapeHtml(file.kind)} · ${escapeHtml(file.path)}</li>`)
      .join("")}</ul></section>`;
  }

  if (block.type === "artifact") {
    return `<section class="block"><a href="${escapeHtml(block.href)}" target="_blank" rel="noreferrer">${escapeHtml(block.label)}</a></section>`;
  }

  if (block.type === "html_fragment") {
    return renderHtmlFragmentBlock(block.html);
  }

  return `<section class="block"><pre><code>${escapeHtml(JSON.stringify(block, null, 2))}</code></pre></section>`;
}

function renderSessions() {
  const template = document.querySelector("#session-item-template");
  els.sessionList.innerHTML = "";

  if (!state.sessions.length) {
    els.sessionList.innerHTML = `<div class="context-item">No sessions yet</div>`;
    return;
  }

  state.sessions.forEach((session) => {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector("button");
    button.dataset.id = session.id;
    if (session.id === state.currentSessionId) {
      button.classList.add("active");
    }
    fragment.querySelector(".session-name").textContent = session.name;
    fragment.querySelector(".session-preview").textContent = `${formatSessionStatus(session.status)} · ${session.preview}`;
    button.addEventListener("click", async () => {
      const prevId = state.currentSessionId;
      state.currentSessionId = session.id;
      localStorage.setItem("currentSessionId", session.id);
      renderSessions();
      try {
        await loadSession(session.id);
      } catch (error) {
        state.currentSessionId = prevId;
        if (prevId) {
          localStorage.setItem("currentSessionId", prevId);
        } else {
          localStorage.removeItem("currentSessionId");
        }
        renderSessions();
        els.sessionTitle.textContent = "Session unavailable";
        els.sessionContent.classList.add("empty-state");
        els.sessionContent.innerHTML = `<div class="empty-state-body"><div class="empty-state-icon"><i data-lucide="alert-circle"></i></div><h3>Session unavailable</h3><p class="subtle">Could not load this session: ${escapeHtml(error.message)}</p></div>`;
        if (window.lucide) lucide.createIcons();
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "session-delete-btn";
    deleteBtn.title = "Delete session";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await request(`/api/sessions/${session.id}`, { method: "DELETE" });
      if (state.currentSessionId === session.id) {
        state.currentSessionId = null;
        localStorage.removeItem("currentSessionId");
        els.sessionTitle.textContent = "Select a session";
        els.sessionContent.classList.add("empty-state");
        els.sessionContent.innerHTML = `<div class="empty-state-body"><div class="empty-state-icon"><i data-lucide="zap"></i></div><h3>Start Coding with Codex</h3><p class="subtle">Select or create a session to begin.</p></div>`;
        if (window.lucide) lucide.createIcons();
      }
      await refreshSessions();
    });
    button.appendChild(deleteBtn);

    els.sessionList.appendChild(fragment);
  });
}

function updateStopButton(isActive) {
  if (!els.stopButton || !els.sendButton) return;
  if (isActive) {
    els.stopButton.classList.remove("hidden");
    els.sendButton.classList.add("hidden");
  } else {
    els.stopButton.classList.add("hidden");
    els.sendButton.classList.remove("hidden");
  }
}

function renderDetail(detail) {
  state.currentDetail = detail;
  els.sessionTitle.textContent = detail.summary.name;
  els.sessionMeta.textContent = `${detail.summary.cwd} · ${formatSessionStatus(detail.summary.status)} · ${new Date(
    detail.summary.updatedAt * 1000
  ).toLocaleString()}`;
  updateStopButton(!!detail.context.activeTurnId);

  const turns = detail.turns
    .map((turn) => {
      const blocks = turn.blocks.map(renderBlock).join("");
      return `
        <article class="turn-card" id="turn-${turn.id}">
          <h3>Turn ${turn.id.slice(0, 8)}</h3>
          <div class="turn-meta">${turn.status} · ${turn.startedAt ? new Date(turn.startedAt * 1000).toLocaleString() : "pending"}</div>
          <div class="turn-blocks">${blocks || `<section class="block">Waiting for output…</section>`}</div>
        </article>
      `;
    })
    .join("");

  // 保存滚动位置，防止重渲染时跳回顶部
  const savedScroll = els.sessionContent.scrollTop;
  const wasAtBottom = savedScroll + els.sessionContent.clientHeight >= els.sessionContent.scrollHeight - 60;

  els.sessionContent.classList.remove("empty-state");
  els.sessionContent.innerHTML = turns || `<div class="context-item">No turns yet. Use the composer below.</div>`;

  // 如果之前在底部（正在看新内容），继续跟随到底部；否则恢复原位置
  if (wasAtBottom) {
    els.sessionContent.scrollTop = els.sessionContent.scrollHeight;
  } else {
    els.sessionContent.scrollTop = savedScroll;
  }
  setItems(els.contextWorkspace, [
    `cwd: ${escapeHtml(detail.context.cwd)}`,
    `git: ${escapeHtml(detail.context.gitBranch || "n/a")}`,
    `active turn: ${escapeHtml(detail.context.activeTurnId || "none")}`
  ]);
  setItems(
    els.modifiedFiles,
    detail.context.modifiedFiles.map((file) => escapeHtml(file))
  );
  setItems(
    els.recentEvents,
    detail.context.recentEvents.map((event) => `${new Date(event.createdAt).toLocaleTimeString()} · ${escapeHtml(event.label)}`)
  );
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || response.statusText);
  }
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    return await response.json();
  }
  return await response.text();
}

async function loadBootstrap() {
  const data = await request("/api/bootstrap");
  state.workspaceRoot = data.workspaceRoot;
  if (!els.workspaceInput.value) {
    els.workspaceInput.value = data.workspaceRoot;
    localStorage.setItem("workspaceRoot", data.workspaceRoot);
  }
  state.sessions = data.sessions;
  renderSessions();

  // 尝试按优先级恢复会话：1) 上次使用的  2) 列表第一个
  const candidates = [state.currentSessionId, state.sessions[0]?.id].filter(Boolean);
  for (const target of candidates) {
    state.currentSessionId = target;
    localStorage.setItem("currentSessionId", target);
    try {
      await loadSession(target);
      return; // 成功加载，退出
    } catch {
      // 这个 session 无法加载，试下一个
    }
  }
  // 全部失败，清空
  state.currentSessionId = null;
  localStorage.removeItem("currentSessionId");
}

async function refreshSessions() {
  state.sessions = await request("/api/sessions");
  renderSessions();
}

async function loadSession(threadId) {
  const detail = await request(`/api/sessions/${threadId}`);
  renderDetail(detail);
  await refreshSessions();
  els.composerInput.focus();
}

async function createSession() {
  const cwd = els.workspaceInput.value.trim();
  localStorage.setItem("workspaceRoot", cwd);
  const name = window.prompt("Session name", "") || "";
  const prompt = window.prompt("Optional first message", "") || "";
  const detail = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ cwd, name, prompt })
  });
  state.currentSessionId = detail.summary.id;
  localStorage.setItem("currentSessionId", detail.summary.id);
  await refreshSessions();
  renderDetail(detail);
  renderSessions();
  els.composerInput.focus();
}

async function sendMessage() {
  if (!state.currentSessionId) {
    window.alert("Create or select a session first.");
    return;
  }
  const rawText = els.composerInput.value.trim();
  if (!rawText) {
    return;
  }
  const text = rawText;
  try {
    await request(`/api/sessions/${state.currentSessionId}/turns`, {
      method: "POST",
      body: JSON.stringify({ text, outputFormat: state.outputFormat })
    });
    els.composerInput.value = "";
    await loadSession(state.currentSessionId);
    els.composerInput.focus();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function interruptSession() {
  if (!state.currentSessionId) return;
  const btn = document.querySelector("#interrupt-button");
  try {
    if (btn) btn.disabled = true;
    await request(`/api/sessions/${state.currentSessionId}/interrupt`, {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    if (!error.message.includes("no active turn")) {
      window.alert(error.message);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runSearch() {
  if (!state.currentSessionId) {
    return;
  }
  const q = els.searchInput.value.trim();
  const results = await request(`/api/sessions/${state.currentSessionId}/search?q=${encodeURIComponent(q)}`);
  setItems(
    els.searchResults,
    results.map((item) => `${escapeHtml(item.label)} · ${escapeHtml(item.snippet)}`)
  );
  els.contextPanel.classList.remove("hidden");
  if (results[0]) {
    document.getElementById(`turn-${results[0].turnId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toggleContextPanel() {
  els.contextPanel.classList.toggle("hidden");
}

function download(format) {
  if (!state.currentSessionId) {
    return;
  }
  window.open(`/api/sessions/${state.currentSessionId}/export/${format}`, "_blank");
}

function connectSocket() {
  state.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);

  // 防抖：500ms 内多个事件只触发一次重渲染，避免频繁闪烁
  let reloadTimer = null;
  let pendingSessionReload = false;

  state.ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type !== "codex-event") return;

    if (state.currentSessionId && data.threadId === state.currentSessionId) {
      pendingSessionReload = true;
    }

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      await refreshSessions();
      if (pendingSessionReload) {
        pendingSessionReload = false;
        await loadSession(state.currentSessionId);
      }
    }, 400);
  });
}

function setOutputFormat(fmt) {
  state.outputFormat = fmt;
  localStorage.setItem("outputFormat", fmt);
  els.fmtMd.classList.toggle("active", fmt === "md");
  els.fmtHtml.classList.toggle("active", fmt === "html");
  els.composerInput.placeholder = fmt === "html"
    ? "HTML 模式：表格/步骤/清单等内容以更丰富的视觉呈现"
    : "发消息给 Codex... 切到 HTML 模式可获得更结构化的信息展示";
}

els.fmtMd.addEventListener("click", () => setOutputFormat("md"));
els.fmtHtml.addEventListener("click", () => setOutputFormat("html"));
setOutputFormat(state.outputFormat);

document.querySelector("#new-session-button").addEventListener("click", createSession);
document.querySelector("#refresh-list-button").addEventListener("click", refreshSessions);
document.querySelector("#send-button").addEventListener("click", () => sendMessage().catch((error) => window.alert(error.message)));
document.querySelector("#stop-button").addEventListener("click", interruptSession);
document.querySelector("#interrupt-button").addEventListener("click", interruptSession);
document.querySelector("#search-button").addEventListener("click", runSearch);
document.querySelector("#export-md-button").addEventListener("click", () => download("md"));
document.querySelector("#export-html-button").addEventListener("click", () => download("html"));
els.contextToggleButton.addEventListener("click", toggleContextPanel);

els.composerInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    sendMessage().catch((error) => window.alert(error.message));
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    interruptSession();
  }
});

loadBootstrap().catch((error) => {
  els.sessionContent.innerHTML = `<div class="context-item">Failed to load app: ${escapeHtml(error.message)}</div>`;
});
connectSocket();
