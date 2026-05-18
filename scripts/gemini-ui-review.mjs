import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const files = [
  ["public/index.html", 12000],
  ["public/styles.css", 20000],
  ["public/app.js", 18000]
];

const visualSnapshot = `
Current browser screenshot summary for http://127.0.0.1:4317:

- Three-column desktop layout.
- Left sidebar is a tall cream panel with brand, New Session button, workspace input, and a long sessions list.
- Center column contains current session header, one completed turn card, then the composer near the bottom.
- Right rail contains project context, modified files, recent events, and search results.
- The input area is visible now, but it still reads like a secondary footer under existing content rather than the primary action.
- The strongest visual masses are the left session column and the current-session/result blocks above.
- The Send button is relatively small compared with the overall canvas.
- The search/export controls in the top-right compete with the main task of entering a prompt.
- The page feels like a dashboard first and a prompt-first workbench second.
- The session list previews are dense and visually noisy, especially with long Chinese prompts and paths.
- The right rail consumes width even when its data value is low.
`.trim();

const systemPrompt = `
You are a senior product designer and front-end design critic.
You are reviewing an early browser-based coding-agent workbench.

Your job:
1. Independently identify the UI/UX problems from the provided screenshot summary and code.
2. Explain specifically why the prompt input still does not feel like the obvious primary action.
3. Propose a stronger MVP layout with concrete hierarchy changes.
4. Provide practical implementation guidance for HTML/CSS/JS.

Constraints:
- This is an existing browser shell around a Codex-like coding agent.
- The browser is the primary interface, not the terminal.
- Multi-session history matters, but prompt entry must feel first-class.
- Keep the answer concrete and implementation-oriented.
- Be direct. Do not give generic praise.
`.trim();

function buildUserPrompt(codeChunks) {
  return `
Please review this UI and give a concrete redesign recommendation.

Output format:
1. Problems
2. Why prompt entry is still weak
3. Recommended layout hierarchy
4. Specific component changes
5. Visual direction
6. Implementation checklist

Visual snapshot:
${visualSnapshot}

Relevant code:

${codeChunks}
`.trim();
}

async function main() {
  const model = process.env.GEMINI_MODEL;
  const baseUrl = process.env.GEMINI_BASE_URL;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!model || !baseUrl || !apiKey) {
    throw new Error("Missing GEMINI_MODEL, GEMINI_BASE_URL, or GEMINI_API_KEY");
  }

  const codeChunks = [];
  for (const [relativePath, maxChars] of files) {
    const absPath = path.join(root, relativePath);
    const content = await fs.readFile(absPath, "utf8");
    codeChunks.push(`--- ${relativePath} ---\n${content.slice(0, maxChars)}`);
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: buildUserPrompt(codeChunks.join("\n\n"))
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const message = payload.choices?.[0]?.message?.content;

  if (!message) {
    throw new Error(`Unexpected response: ${JSON.stringify(payload, null, 2)}`);
  }

  process.stdout.write(typeof message === "string" ? message : JSON.stringify(message, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
