# Codex Studio

[中文](./README.md) | **English**

Move your Codex CLI sessions into the browser. Instead of watching a terminal, you can work with input, output, and session history directly in the browser, with HTML rendering for higher information density and cleaner presentation.

## Preview

![Codex Studio main UI](images/1.png)

![HTML rendering - report](images/2.png)

![HTML rendering - guide](images/3.png)

![HTML rendering - long-form content](images/4.jpg)

## Requirements

- Node.js 20+
- [Codex CLI](https://github.com/openai/codex)

## Install

```bash
npm install
```

## Start

```bash
npm run dev
```

Open `http://127.0.0.1:4317` in your browser.

## Configuration

Copy `.env.example` to `.env` and edit as needed:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `4317` |
| `WORKSPACE_ROOT` | Default workspace path | Current directory |
| `CODEX_MODEL` | Override default model | Codex default |
| `CODEX_SANDBOX` | Sandbox mode | `workspace-write` |
| `CODEX_APPROVAL_POLICY` | Approval policy | `on-request` |

## Usage

1. Enter your workspace path in the top-left input
2. Click **New Session** to start a session
3. Type in the bottom composer, `⌘ + Enter` to send and `Esc` to interrupt
4. Switch to **HTML** mode for structured, high-density rendering
5. Export the current session as Markdown or HTML from the top-right controls

## How Chinese becomes the default on GitHub

GitHub renders the repository root `README.md` by default on the project homepage. It does not auto-switch README language based on the viewer's locale, so the practical setup is:

1. Keep Chinese in the root `README.md`
2. Put English in `README.en.md`
3. Add cross-links at the top of both files

That makes Chinese the default landing README, while English stays one click away.
