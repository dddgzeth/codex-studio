import path from "node:path";
import type { RenderBlock, SearchResult, SessionDetail, SessionSummary, ThreadStatusView } from "./types.js";

const HTML_MODE_PROMPT_PREFIX = [
  "请直接输出可渲染的 HTML 内容，不要输出 Markdown，不要输出解释，不要说“下面是 HTML”，不要使用代码围栏。",
  "要求：",
  "1. 直接输出一个完整的 HTML fragment，可从 <section> / <article> / <main> 开始。",
  "2. 必须内联所需 CSS。",
  "3. 内容必须有真实网页布局，而不是 Markdown 文章排版。",
  "4. 不要返回 ```html 或任何源码说明。"
].join("\n");

function blockId(prefix: string, index: number) {
  return `${prefix}-${index}`;
}

function normalizeStatus(status: any): ThreadStatusView {
  if (!status || typeof status !== "object" || !("type" in status)) {
    return "unknown";
  }
  if (status.type === "active") {
    return "active";
  }
  if (status.type === "notLoaded") {
    return "idle";
  }
  if (status.type === "systemError") {
    return "error";
  }
  if (status.type === "idle") {
    return "idle";
  }
  return "unknown";
}

function extractTextFromUserContent(content: any[]): string {
  const text = content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item?.type === "text") {
        return item.text ?? "";
      }
      return "";
    })
    .join("\n")
    .trim();

  return stripInjectedHtmlPrompt(text);
}

function stripInjectedHtmlPrompt(text: string) {
  const normalized = String(text || "").trim();
  if (!normalized.startsWith(HTML_MODE_PROMPT_PREFIX)) {
    return normalized;
  }

  const stripped = normalized.slice(HTML_MODE_PROMPT_PREFIX.length).trim();
  return stripped || normalized;
}

function parseMarkdownish(text: string, prefix: string): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  const parts = text.split(/```/g);
  let index = 0;

  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) {
      const plain = parts[i].trim();
      if (!plain) {
        continue;
      }

      if (plain.includes("<div") || plain.includes("<section") || plain.includes("<article")) {
        blocks.push({ id: blockId(prefix, index++), type: "html_fragment", html: plain });
        continue;
      }

      const checklist = plain
        .split("\n")
        .filter((line) => /^[-*]\s\[[ xX]\]\s/.test(line.trim()))
        .map((line) => ({
          checked: /\[[xX]\]/.test(line),
          text: line.replace(/^[-*]\s\[[ xX]\]\s/, "").trim()
        }));
      if (checklist.length >= 2) {
        blocks.push({ id: blockId(prefix, index++), type: "checklist", items: checklist });
        continue;
      }

      const rows = plain
        .split("\n")
        .filter((line) => /^\|.+\|$/.test(line.trim()))
        .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
      if (rows.length >= 2) {
        blocks.push({ id: blockId(prefix, index++), type: "table", rows });
        continue;
      }

      if (/^(warning|risk|note|caution):/im.test(plain)) {
        blocks.push({
          id: blockId(prefix, index++),
          type: "callout",
          level: /warning|risk|caution/i.test(plain) ? "warning" : "info",
          text: plain
        });
        continue;
      }

      blocks.push({ id: blockId(prefix, index++), type: "markdown", text: plain });
    } else {
      const codeChunk = parts[i].replace(/^\n/, "");
      const firstLineBreak = codeChunk.indexOf("\n");
      const language = firstLineBreak === -1 ? "text" : codeChunk.slice(0, firstLineBreak).trim() || "text";
      const code = firstLineBreak === -1 ? "" : codeChunk.slice(firstLineBreak + 1).trimEnd();
      blocks.push({ id: blockId(prefix, index++), type: "code", language, code });
    }
  }

  if (blocks.length === 0 && text.trim()) {
    blocks.push({ id: blockId(prefix, index++), type: "markdown", text: text.trim() });
  }

  return blocks;
}

export function summarizeThread(thread: any): SessionSummary {
  return {
    id: thread.id,
    name: thread.name || stripInjectedHtmlPrompt(thread.preview) || "Untitled session",
    preview: stripInjectedHtmlPrompt(thread.preview) || "New session",
    cwd: thread.cwd,
    updatedAt: thread.updatedAt,
    status: normalizeStatus(thread.status)
  };
}

export function normalizeThread(thread: any, recentEvents: Array<{ method: string; createdAt: number; payload: string }>): SessionDetail {
  const modifiedFiles = new Set<string>();
  const relatedFiles = new Set<string>();

  const turns = (thread.turns || []).map((turn: any) => {
    const blocks: RenderBlock[] = [];
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        blocks.push({
          id: `${turn.id}-${item.id}`,
          type: "markdown",
          role: "user",
          text: extractTextFromUserContent(item.content)
        });
      } else if (item.type === "agentMessage") {
        blocks.push(...parseMarkdownish(item.text || "", `${turn.id}-${item.id}`));
      } else if (item.type === "plan") {
        blocks.push({
          id: `${turn.id}-${item.id}`,
          type: "timeline",
          items: item.text.split("\n").filter(Boolean)
        });
      } else if (item.type === "reasoning") {
        blocks.push({
          id: `${turn.id}-${item.id}`,
          type: "callout",
          level: "info",
          text: [...(item.summary || []), ...(item.content || [])].join("\n")
        });
      } else if (item.type === "commandExecution") {
        blocks.push({
          id: `${turn.id}-${item.id}`,
          type: "log",
          command: item.command,
          text: item.aggregatedOutput || ""
        });
      } else if (item.type === "fileChange") {
        const insertAt = blocks.length;
        const files = (item.changes || []).map((change: any) => {
          modifiedFiles.add(change.path);
          relatedFiles.add(change.path);
          blocks.push({
            id: `${turn.id}-${item.id}-${change.path}`,
            type: "diff",
            path: change.path,
            diff: change.diff
          });
          return {
            path: change.path,
            kind: change.kind?.type || "update"
          };
        });
        blocks.splice(insertAt, 0, {
          id: `${turn.id}-${item.id}-summary`,
          type: "file_change_summary",
          files
        });
      } else if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") {
        blocks.push({
          id: `${turn.id}-${item.id}`,
          type: "task_status",
          status: item.status,
          label: `${item.type === "dynamicToolCall" ? "Tool" : "MCP"}: ${item.tool}`
        });
      } else if (item.type === "webSearch") {
        blocks.push({
          id: `${turn.id}-${item.id}`,
          type: "artifact",
          label: `Web search: ${item.query}`,
          href: `https://www.google.com/search?q=${encodeURIComponent(item.query)}`
        });
      }
    }

    return {
      id: turn.id,
      status: turn.status,
      startedAt: turn.startedAt ?? null,
      completedAt: turn.completedAt ?? null,
      blocks
    };
  });

  return {
    summary: summarizeThread(thread),
    turns,
    context: {
      cwd: thread.cwd,
      gitBranch: thread.gitInfo?.branch ?? null,
      modifiedFiles: [...modifiedFiles],
      relatedFiles: [...relatedFiles],
      recentEvents: recentEvents.map((event) => ({
        method: event.method,
        createdAt: event.createdAt,
        label: event.method.replaceAll("/", " / ")
      })),
      activeTurnId:
        turns.findLast((turn: { id: string; status: string }) => turn.status === "inProgress" || turn.status === "running")?.id ?? null
    }
  };
}

export function searchSession(detail: SessionDetail, query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }

  const results: SearchResult[] = [];
  for (const turn of detail.turns) {
    for (const block of turn.blocks) {
      const haystacks: string[] = [];
      if ("text" in block) {
        haystacks.push(block.text);
      }
      if (block.type === "code") {
        haystacks.push(block.code);
      }
      if (block.type === "log") {
        haystacks.push(block.text);
      }
      if (block.type === "diff") {
        haystacks.push(block.diff);
      }
      if (block.type === "file_change_summary") {
        haystacks.push(block.files.map((file) => file.path).join("\n"));
      }
      if (block.type === "timeline") {
        haystacks.push(block.items.join("\n"));
      }

      const found = haystacks.find((entry) => entry.toLowerCase().includes(q));
      if (found) {
        const lower = found.toLowerCase();
        const index = lower.indexOf(q);
        const snippet = found.slice(Math.max(0, index - 60), Math.min(found.length, index + q.length + 90));
        results.push({
          turnId: turn.id,
          blockId: block.id,
          label: block.type,
          snippet
        });
      }
    }
  }

  return results;
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownToHtml(text: string) {
  return escapeHtml(text)
    .replace(/^###\s(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s(.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />");
}

export function exportMarkdown(detail: SessionDetail) {
  const lines: string[] = [`# ${detail.summary.name}`, "", `- Session ID: ${detail.summary.id}`, `- Workspace: ${detail.context.cwd}`, ""];
  for (const turn of detail.turns) {
    lines.push(`## Turn ${turn.id}`);
    lines.push(`Status: ${turn.status}`);
    lines.push("");
    for (const block of turn.blocks) {
      if (block.type === "markdown") {
        lines.push(block.text);
      } else if (block.type === "code") {
        lines.push(`\`\`\`${block.language}`);
        lines.push(block.code);
        lines.push("```");
      } else if (block.type === "log") {
        lines.push("```text");
        if (block.command) {
          lines.push(`$ ${block.command}`);
        }
        lines.push(block.text);
        lines.push("```");
      } else if (block.type === "diff") {
        lines.push(`### Diff: ${block.path}`);
        lines.push("```diff");
        lines.push(block.diff);
        lines.push("```");
      } else if (block.type === "timeline") {
        lines.push(...block.items.map((item, index) => `${index + 1}. ${item}`));
      } else if (block.type === "checklist") {
        lines.push(...block.items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`));
      } else if (block.type === "table") {
        block.rows.forEach((row) => lines.push(`| ${row.join(" | ")} |`));
      } else if (block.type === "callout") {
        lines.push(`> ${block.text.replaceAll("\n", "\n> ")}`);
      } else if (block.type === "task_status") {
        lines.push(`- ${block.label}: ${block.status}`);
      } else if (block.type === "file_change_summary") {
        lines.push(...block.files.map((file) => `- ${file.kind}: ${file.path}`));
      } else if (block.type === "artifact") {
        lines.push(`- [${block.label}](${block.href})`);
      } else if (block.type === "html_fragment") {
        lines.push(block.html);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function exportHtml(detail: SessionDetail) {
  const sections = detail.turns
    .map((turn) => {
      const content = turn.blocks
        .map((block) => {
          if (block.type === "markdown") {
            return `<section class="card">${markdownToHtml(block.text)}</section>`;
          }
          if (block.type === "code") {
            return `<section class="card"><div class="eyebrow">${escapeHtml(block.language)}</div><pre><code>${escapeHtml(block.code)}</code></pre></section>`;
          }
          if (block.type === "log") {
            return `<section class="card"><div class="eyebrow">${escapeHtml(block.command || "log")}</div><pre><code>${escapeHtml(block.text)}</code></pre></section>`;
          }
          if (block.type === "diff") {
            return `<section class="card"><div class="eyebrow">${escapeHtml(block.path)}</div><pre><code>${escapeHtml(block.diff)}</code></pre></section>`;
          }
          if (block.type === "checklist") {
            return `<section class="card"><ul>${block.items
              .map((item) => `<li>${item.checked ? "done" : "todo"} · ${escapeHtml(item.text)}</li>`)
              .join("")}</ul></section>`;
          }
          if (block.type === "table") {
            const rows = block.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
              .join("");
            return `<section class="card"><table>${rows}</table></section>`;
          }
          if (block.type === "timeline") {
            return `<section class="card"><ol>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section>`;
          }
          if (block.type === "callout") {
            return `<section class="card"><strong>${block.level}</strong><p>${markdownToHtml(block.text)}</p></section>`;
          }
          if (block.type === "task_status") {
            return `<section class="card"><strong>${escapeHtml(block.label)}</strong><p>${escapeHtml(block.status)}</p></section>`;
          }
          if (block.type === "file_change_summary") {
            return `<section class="card"><ul>${block.files
              .map((file) => `<li>${escapeHtml(file.kind)} · ${escapeHtml(file.path)}</li>`)
              .join("")}</ul></section>`;
          }
          if (block.type === "artifact") {
            return `<section class="card"><a href="${escapeHtml(block.href)}">${escapeHtml(block.label)}</a></section>`;
          }
          return `<section class="card">${block.html}</section>`;
        })
        .join("");
      return `<article class="turn"><h2>Turn ${escapeHtml(turn.id)}</h2>${content}</article>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(detail.summary.name)}</title>
    <style>
      body { font-family: "IBM Plex Sans", Arial, sans-serif; margin: 0; padding: 32px; background: #f3f0e8; color: #17130f; }
      h1, h2, h3 { margin: 0 0 12px; }
      .meta { margin-bottom: 24px; color: #5b524b; }
      .turn { margin-bottom: 32px; }
      .card { background: #fffdf8; border: 1px solid #d9d0c5; border-radius: 16px; padding: 16px; margin-bottom: 12px; box-shadow: 0 12px 30px rgba(23, 19, 15, 0.06); }
      .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b4d38; margin-bottom: 8px; }
      pre { overflow: auto; background: #211a14; color: #f7f3ed; padding: 14px; border-radius: 12px; }
      table { width: 100%; border-collapse: collapse; }
      td { border: 1px solid #d9d0c5; padding: 8px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(detail.summary.name)}</h1>
    <div class="meta">Workspace: ${escapeHtml(detail.context.cwd)} · Updated ${new Date(detail.summary.updatedAt * 1000).toLocaleString()}</div>
    ${sections}
  </body>
</html>`;
}

export function makeExportFileName(detail: SessionDetail, format: "md" | "html") {
  const safe = detail.summary.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
  return `${safe}-${detail.summary.id.slice(0, 8)}.${format}`;
}

export function collectWorkspaceRoot(candidate: string, fallback: string) {
  return candidate && candidate.trim() ? path.resolve(candidate) : fallback;
}
