export type ThreadStatusView = "idle" | "active" | "error" | "unknown";

export type RenderBlock =
  | { id: string; type: "markdown"; role?: "user" | "assistant"; text: string }
  | { id: string; type: "code"; language: string; code: string }
  | { id: string; type: "table"; rows: string[][] }
  | { id: string; type: "checklist"; items: Array<{ checked: boolean; text: string }> }
  | { id: string; type: "callout"; level: "info" | "warning" | "danger"; text: string }
  | { id: string; type: "timeline"; items: string[] }
  | { id: string; type: "task_status"; status: string; label: string }
  | { id: string; type: "log"; command?: string; text: string }
  | { id: string; type: "diff"; path: string; diff: string }
  | { id: string; type: "file_change_summary"; files: Array<{ path: string; kind: string }> }
  | { id: string; type: "artifact"; label: string; href: string }
  | { id: string; type: "html_fragment"; html: string };

export type SessionSummary = {
  id: string;
  name: string;
  preview: string;
  cwd: string;
  updatedAt: number;
  status: ThreadStatusView;
};

export type SessionDetail = {
  summary: SessionSummary;
  turns: Array<{
    id: string;
    status: string;
    startedAt: number | null;
    completedAt: number | null;
    blocks: RenderBlock[];
  }>;
  context: {
    cwd: string;
    gitBranch: string | null;
    modifiedFiles: string[];
    relatedFiles: string[];
    recentEvents: Array<{ method: string; createdAt: number; label: string }>;
    activeTurnId: string | null;
  };
};

export type SearchResult = {
  turnId: string;
  blockId: string;
  label: string;
  snippet: string;
};
