# Codex Studio

**中文** | [English](#english)

把 Codex CLI 会话搬到浏览器里。不用盯着终端，所有输入、输出、历史会话都在浏览器中完成，以 HTML 模式渲染输出，信息密度更高、展示更直观。

![Codex Studio 界面](images/1.png)

![HTML 渲染效果 - 报告](images/2.png)

![HTML 渲染效果 - 指南](images/3.png)

---

## 环境要求

- Node.js 20+
- [Codex CLI](https://github.com/openai/codex)

## 安装

```bash
npm install
```

## 启动

```bash
npm run dev
```

浏览器打开 `http://127.0.0.1:4317`

## 配置

复制 `.env.example` 为 `.env`，按需修改：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `4317` |
| `WORKSPACE_ROOT` | 默认工作目录 | 当前目录 |
| `CODEX_MODEL` | 覆盖默认模型 | Codex 默认 |
| `CODEX_SANDBOX` | 沙箱模式 | `workspace-write` |
| `CODEX_APPROVAL_POLICY` | 审批策略 | `on-request` |

## 使用

1. 在左上角输入工作目录路径
2. 点击 **New Session** 新建会话
3. 底部输入框发消息，`⌘ + Enter` 发送，`Esc` 中断
4. 切换底部 **HTML** 模式获得更结构化的渲染输出
5. 右上角可导出当前会话为 Markdown 或 HTML 文件

---

<a name="english"></a>

# Codex Studio

Move your Codex CLI sessions into the browser. No more watching the terminal — all input, output, and session history live in the browser, with HTML rendering for higher information density and cleaner presentation.

![Codex Studio UI](images/1.png)

![HTML rendering - report](images/2.png)

![HTML rendering - guide](images/3.png)

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
3. Type in the bottom composer, `⌘ + Enter` to send, `Esc` to interrupt
4. Switch to **HTML** mode for structured, high-density rendering
5. Export the current session as Markdown or HTML from the top-right buttons
