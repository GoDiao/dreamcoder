export type AgentMode = "local" | "api";
export type AgentId = "codex" | "kimi" | "claude" | "gemini" | "opencode";
export interface ModelSource {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  protocol: "responses" | "chat";
  credential: "api-key" | "chatgpt";
  apiKeyPresent?: boolean;
  account?: string;
  connected?: boolean;
  planEnabled?: boolean;
  refreshOwner?: "local" | "server";
  hosted?: {
    connectionId: string;
    resourceId: string;
    serverName: string;
    url: string;
  };
}
export interface AgentSettings {
  mode: AgentMode;
  localAgent: AgentId;
  sourceId: string;
  sources: ModelSource[];
}
export interface LocalAgent {
  id: AgentId;
  name: string;
  path: string | null;
  version: string;
  auth: "ready" | "missing" | "unknown";
  detail: string;
  callable: boolean | null;
  testedAt?: string;
}
/** Install step the UI localizes; `progress` keeps the host-language text. */
export type RuntimeStage =
  | "absent"
  | "fetching"
  | "downloading"
  | "verifying"
  | "installed"
  | "upToDate"
  | "failed";
/** Why an SDK install failed, for a localized reason and the right advice. */
export type RuntimeFailureCode =
  | "network"
  | "registry"
  | "integrity"
  | "disk"
  | "verify"
  | "unknown";
export interface RuntimeStatus {
  state: "absent" | "installing" | "ready" | "failed";
  version?: string;
  progress: string;
  root: string;
  error?: string;
  stage?: RuntimeStage;
  /** Bytes received / expected while downloading both packages. */
  received?: number;
  total?: number;
  failure?: RuntimeFailureCode;
}
/**
 * Classified reason a built-in Agent run (or a send) failed. The UI chooses
 * its summary and actions by `code`; `detail` keeps the redacted original
 * text (stderr, provider message) for the collapsed technical details.
 */
export type AgentProblemCode =
  | "no_model_source"
  | "source_removed"
  | "credentials_missing"
  | "invalid_credentials"
  | "rate_limited"
  | "model_missing"
  | "model_not_found"
  | "runtime_missing"
  | "agent_missing"
  | "sign_in_required"
  | "network"
  | "sandbox"
  | "process_exited"
  | "timeout"
  | "provider_error"
  | "unknown";
export interface AgentProblem {
  code: AgentProblemCode;
  /** One sentence in the host language; the UI prefers its own text for `code`. */
  summary: string;
  /** Original text, redacted and truncated. */
  detail?: string;
  exitCode?: number;
  /** Provider HTTP status for gateway failures. */
  status?: number;
  /** The source signs in with a ChatGPT plan rather than an API key. */
  chatgpt?: boolean;
  /** Display name of the source or local Agent involved. */
  name?: string;
}
export interface AgentEvent {
  sequence: number;
  type: "message" | "tool" | "status" | "error";
  text: string;
  itemId?: string;
  state?: "running" | "completed" | "failed";
}
export interface AgentTask {
  id: string;
  projectId: string;
  pageId?: string;
  label: string;
  mode: AgentMode;
  sourceId?: string;
  localAgent?: AgentId;
  state: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  workspace: string;
  threadId?: string;
  events: AgentEvent[];
  approvals?: {
    id: string;
    title: string;
    options: { id: string; name: string; kind: string }[];
  }[];
  /** Summary text kept for older readers; `problem` carries the classification. */
  error?: string;
  problem?: AgentProblem;
}
/** What the user pointed at when sending a turn. Ids are stable page block ids. */
export interface AgentTarget {
  kind: "page" | "text" | "blocks" | "board";
  pageId?: string;
  surfaceId?: string;
  blockIds?: string[];
  text?: string;
  reference?: import("../surface/agent-reference").CanvasReference;
  /** Exploration state components handed to this message; never saved to the page. */
  components?: AgentComponentContext[];
}
/** The model-visible part of a component's onContext snapshot. */
export interface AgentComponentContext {
  blockId: string;
  componentId?: string;
  name: string;
  label?: string;
  model: unknown;
}
/** One user request and the Agent run that answered it. */
export interface AgentTurn extends AgentTask {
  conversationId: string;
  prompt: string;
  target: AgentTarget;
  pageTitle?: string;
  baseHash?: string;
  resultHash?: string;
  /** Whether this turn's MCP actually wrote the focused page. */
  wrotePage?: boolean;
  changedBlockIds?: string[];
  undone?: boolean;
}
/** A project-scoped Agent conversation; execution settings stay fixed for its lifetime. */
export interface AgentConversation {
  id: string;
  projectId: string;
  title: string;
  mode: AgentMode;
  sourceId?: string;
  localAgent?: AgentId;
  threadId?: string;
  catalogRevision?: string;
  workspace: string;
  createdAt: string;
  updatedAt: string;
  turns: AgentTurn[];
  /** Set in responses when the conversation could not be written to disk. */
  persistError?: string;
}
export interface AgentConversationSummary {
  id: string;
  projectId: string;
  title: string;
  mode: AgentMode;
  sourceId?: string;
  localAgent?: AgentId;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  running: boolean;
}
export interface AgentHostStatus {
  executionKind?: "cloud" | "mac" | "device";
  settings: AgentSettings;
  agents: LocalAgent[];
  runtime: RuntimeStatus;
  workspaceRoot: string;
  credentialRoot: string;
  tasks: AgentTask[];
  authorization: {
    state: "idle" | "pending" | "completed" | "failed";
    error?: string;
  };
}
export const sourcePresets = [
  {
    provider: "chatgpt",
    name: "ChatGPT 套餐", // i18n-exempt: default source name saved into settings
    baseUrl: "https://api.openai.com/v1",
    credential: "chatgpt",
    protocol: "responses",
  },
  {
    provider: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    credential: "api-key",
    protocol: "responses",
  },
  {
    provider: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    credential: "api-key",
    protocol: "responses",
  },
  {
    provider: "openai",
    name: "OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    credential: "api-key",
    protocol: "responses",
  },
  {
    provider: "moonshot",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    credential: "api-key",
    protocol: "chat",
  },
  {
    provider: "custom",
    name: "自定义服务", // i18n-exempt: default source name saved into settings
    baseUrl: "",
    credential: "api-key",
    protocol: "responses",
  },
] as const;
