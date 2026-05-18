import fs from "node:fs";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { AppStore } from "./store.js";
import { CodexRpcClient } from "./codex-rpc.js";
import { collectWorkspaceRoot, exportHtml, exportMarkdown, makeExportFileName, normalizeThread, searchSession, summarizeThread } from "./render.js";

const app = express();
const port = Number(process.env.PORT || 4317);
const workspaceRoot = collectWorkspaceRoot(process.env.WORKSPACE_ROOT || "", process.cwd());
const dataDir = path.join(process.cwd(), ".app-data");
const exportsDir = path.join(dataDir, "exports");
fs.mkdirSync(exportsDir, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

const store = new AppStore(dataDir);
const codex = new CodexRpcClient();
const syncTimers = new Map<string, NodeJS.Timeout>();
let lastThreadCache: any[] = [];

function broadcast(wss: WebSocketServer, payload: unknown) {
  const json = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

async function syncThread(threadId: string) {
  const response = await codex.readThread(threadId);
  store.saveThread(response.thread);
  return response.thread;
}

function scheduleSync(threadId: string) {
  clearTimeout(syncTimers.get(threadId));
  syncTimers.set(
    threadId,
    setTimeout(() => {
      syncThread(threadId).catch((error) => {
        console.error(`sync failed for ${threadId}:`, error);
      });
    }, 250)
  );
}

async function refreshThreadList() {
  const response = await codex.listThreads();
  const mappedIds = store.getMappedActiveIds();
  const visible = (response.data as any[]).filter((t) => !mappedIds.has(t.id));
  lastThreadCache = visible;
  for (const thread of response.data) {
    store.saveThread(thread);
  }
  return visible;
}

function parseThreadId(params: any) {
  return params?.threadId || params?.thread?.id || null;
}

async function loadDetail(threadId: string) {
  const activeId = await resolveActiveThreadId(threadId);
  let thread: any;
  try {
    thread = await syncThread(activeId);
  } catch {
    const cached = store.getThread(activeId) ?? store.getThread(threadId);
    if (!cached) throw new Error(`Session ${threadId} not found`);
    thread = JSON.parse(cached.rawThread);
  }
  const recentEvents = store.getRecentEvents(activeId);
  const detail = normalizeThread(thread, recentEvents);
  detail.summary.id = threadId;
  return detail;
}

async function resolveActiveThreadId(originalId: string): Promise<string> {
  const mapped = store.getThreadMapping(originalId);
  return mapped ?? originalId;
}

function getPreferredThreadCwd(originalId: string) {
  const activeId = store.getThreadMapping(originalId);
  const cached = (activeId && store.getThread(activeId)) ?? store.getThread(originalId);
  if (!cached) {
    return workspaceRoot;
  }
  return JSON.parse(cached.rawThread).cwd || workspaceRoot;
}

async function resumeActiveThread(originalId: string, cwd: string) {
  const mapped = store.getThreadMapping(originalId);
  const candidates = mapped && mapped !== originalId
    ? [mapped, originalId]
    : [originalId];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const resumed = await codex.resumeThread(candidate, cwd);
      if (candidate === originalId) {
        store.clearThreadMapping(originalId);
      } else {
        store.setThreadMapping(originalId, candidate);
      }
      return resumed.thread.id;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`failed to resume thread ${originalId}`);
}

async function warmSessionRuntime(originalId: string) {
  const mapped = store.getThreadMapping(originalId);
  const candidates = mapped && mapped !== originalId
    ? [mapped, originalId]
    : [originalId];
  const loaded = await codex.listLoadedThreads();
  const loadedIds = new Set<string>(loaded.data || []);

  if (candidates.some((candidate) => loadedIds.has(candidate))) {
    return;
  }

  await resumeActiveThread(originalId, getPreferredThreadCwd(originalId));
}

function buildTurnInput(text: string, outputFormat: string) {
  if (outputFormat !== "html") {
    return text;
  }

  return [
    "请直接输出可渲染的 HTML 内容，不要输出 Markdown，不要输出解释，不要说“下面是 HTML”，不要使用代码围栏。",
    "要求：",
    "1. 直接输出一个完整的 HTML fragment，可从 <section> / <article> / <main> 开始。",
    "2. 必须内联所需 CSS。",
    "3. 内容必须有真实网页布局，而不是 Markdown 文章排版。",
    "4. 不要返回 ```html 或任何源码说明。",
    "",
    text
  ].join("\n");
}

async function bootstrap() {
  await codex.start();
  await refreshThreadList();
}

const server = app.listen(port, "127.0.0.1", async () => {
  await bootstrap();
  console.log(`codex-browser-mvp listening on http://127.0.0.1:${port}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });

codex.onNotification((method, params) => {
  const rawThreadId = parseThreadId(params);
  if (rawThreadId) {
    store.logEvent(rawThreadId, method, params);
    scheduleSync(rawThreadId);
  }
  if (method === "thread/started" || method === "thread/name/updated" || method === "thread/status/changed") {
    refreshThreadList().catch((error) => console.error("refresh thread list failed:", error));
  }
  // Broadcast using originalId if this is a resurrected thread
  const broadcastId = rawThreadId
    ? (store.getOriginalId(rawThreadId) ?? rawThreadId)
    : rawThreadId;
  broadcast(wss, { type: "codex-event", method, threadId: broadcastId, at: Date.now(), params });
});

wss.on("connection", async (socket) => {
  socket.send(JSON.stringify({ type: "hello", at: Date.now() }));
});

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    workspaceRoot,
    sessions: lastThreadCache.length
  });
});

app.get("/api/bootstrap", async (_req, res) => {
  try {
    const threads = await refreshThreadList();
    res.json({
      workspaceRoot,
      sessions: threads.map(summarizeThread)
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/sessions", async (_req, res) => {
  try {
    const threads = await refreshThreadList();
    res.json(threads.map(summarizeThread));
  } catch (error) {
    const cached = store.getCachedThreads().map((row) => {
      const raw = JSON.parse(row.rawThread);
      return summarizeThread(raw);
    });
    res.json(cached);
  }
});

app.post("/api/sessions", async (req, res) => {
  try {
    const cwd = req.body.cwd ? path.resolve(req.body.cwd) : workspaceRoot;
    const name = typeof req.body.name === "string" ? req.body.name : undefined;
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    const started = await codex.startThread(cwd, name);
    const threadId = started.thread.id;
    await syncThread(threadId);
    if (prompt) {
      await codex.startTurn(threadId, prompt, cwd);
    }
    const detail = await loadDetail(threadId);
    res.status(201).json(detail);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/sessions/:threadId", async (req, res) => {
  try {
    await warmSessionRuntime(req.params.threadId);
    const detail = await loadDetail(req.params.threadId);
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/sessions/:threadId/turns", async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const outputFormat = req.body.outputFormat === "html" ? "html" : "md";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const originalId = req.params.threadId;
    const detail = await loadDetail(originalId);
    let activeId = await resolveActiveThreadId(originalId);
    const turnInput = buildTurnInput(text, outputFormat);

    try {
      await codex.startTurn(activeId, turnInput, detail.context.cwd);
    } catch (turnError) {
      if (!String(turnError).includes("thread not found")) throw turnError;
      activeId = await resumeActiveThread(originalId, detail.context.cwd);
      await syncThread(activeId);
      await codex.startTurn(activeId, turnInput, detail.context.cwd);
    }

    res.status(202).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/sessions/:threadId/interrupt", async (req, res) => {
  try {
    const detail = await loadDetail(req.params.threadId);
    if (!detail.context.activeTurnId) {
      res.status(409).json({ error: "no active turn" });
      return;
    }
    const activeId = await resolveActiveThreadId(req.params.threadId);
    await codex.interruptTurn(activeId, detail.context.activeTurnId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.patch("/api/sessions/:threadId", async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : null;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const activeId = await resolveActiveThreadId(req.params.threadId);
    await codex.renameThread(activeId, name);
    await syncThread(activeId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete("/api/sessions/:threadId", async (req, res) => {
  try {
    await codex.archiveThread(req.params.threadId);
    store.deleteThread(req.params.threadId);
    await refreshThreadList();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/sessions/:threadId/search", async (req, res) => {
  try {
    const detail = await loadDetail(req.params.threadId);
    const results = searchSession(detail, String(req.query.q || ""));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/sessions/:threadId/export/:format", async (req, res) => {
  try {
    const format = req.params.format === "html" ? "html" : "md";
    const detail = await loadDetail(req.params.threadId);
    const output = format === "html" ? exportHtml(detail) : exportMarkdown(detail);
    const fileName = makeExportFileName(detail, format);
    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, output);
    store.recordExport(req.params.threadId, format, filePath);
    res.setHeader("Content-Type", format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(output);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/file", (req, res) => {
  try {
    const filePath = String(req.query.path || "");
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(fs.readFileSync(filePath));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});
