import net from "node:net";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { WebSocket } from "ws";

type NotificationHandler = (method: string, params: any) => void;

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export class CodexRpcClient {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private socket: WebSocket | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>();
  private readonly listeners = new Set<NotificationHandler>();

  async start() {
    const port = await getFreePort();
    this.process = spawn(
      "codex",
      ["app-server", "--listen", `ws://127.0.0.1:${port}`],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const child = this.process;
    if (!child) {
      throw new Error("failed to launch codex app-server");
    }

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        console.error(text.trim());
      }
    });

    await this.connect(`ws://127.0.0.1:${port}`);
    await this.request("initialize", {
      clientInfo: {
        name: "codex-browser-mvp",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
  }

  private async connect(url: string) {
    const deadline = Date.now() + 12000;

    while (Date.now() < deadline) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(url);
          const timer = setTimeout(() => {
            socket.close();
            reject(new Error("connection timed out"));
          }, 2000);

          socket.once("open", () => {
            clearTimeout(timer);
            this.socket = socket;
            socket.on("message", (data) => this.handleMessage(data.toString()));
            socket.on("close", () => {
              this.socket = null;
            });
            resolve();
          });
          socket.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    throw new Error("failed to connect to codex app-server");
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw);
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "rpc error"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const listener of this.listeners) {
        listener(message.method, message.params);
      }
    }
  }

  onNotification(listener: NotificationHandler) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  request(method: string, params: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("codex app-server is not connected");
    }

    const id = ++this.requestId;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.send(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async listThreads(cwd?: string) {
    return await this.request("thread/list", {
      cwd: cwd || null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc"
    });
  }

  async readThread(threadId: string) {
    return await this.request("thread/read", {
      threadId,
      includeTurns: true
    });
  }

  async listLoadedThreads() {
    return await this.request("thread/loaded/list", {
      limit: 1000
    });
  }

  async startThread(cwd: string, name?: string) {
    const response = await this.request("thread/start", {
      cwd,
      sandbox: process.env.CODEX_SANDBOX || "workspace-write",
      approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "on-request",
      model: process.env.CODEX_MODEL || null
    });

    if (name) {
      await this.request("thread/name/set", { threadId: response.thread.id, name });
    }
    return response;
  }

  async resumeThread(threadId: string, cwd?: string) {
    return await this.request("thread/resume", {
      threadId,
      cwd: cwd || null,
      sandbox: process.env.CODEX_SANDBOX || "workspace-write",
      approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "on-request",
      model: process.env.CODEX_MODEL || null
    });
  }

  async startTurn(threadId: string, text: string, cwd?: string) {
    return await this.request("turn/start", {
      threadId,
      cwd: cwd || null,
      model: process.env.CODEX_MODEL || null,
      input: [{ type: "text", text }]
    });
  }

  async interruptTurn(threadId: string, turnId: string) {
    return await this.request("turn/interrupt", {
      threadId,
      turnId
    });
  }

  async archiveThread(threadId: string) {
    return await this.request("thread/archive", { threadId });
  }
}
