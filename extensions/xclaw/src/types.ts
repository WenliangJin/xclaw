/**
 * XClaw 插件类型定义
 */

// AgentEventStream 和 AgentEventPayload 在运行时从 OpenClaw 核心导入
// 这里使用类型声明确保编译通过
export type AgentEventStream =
  | "assistant"
  | "tool"
  | "lifecycle"
  | "thinking"
  | "error"
  | "command_output"
  | "patch"
  | "plan"
  | "approval"
  | "item"
  | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

/**
 * 插件配置
 */
export interface XClawConfig {
  enabled: boolean;
  websocketUrl: string;
  ip?: string;
  port?: number;
  containerId?: string;
  reconnectInterval: number;
  streams: AgentEventStream[];
}

/**
 * WebSocket 连接状态
 */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * 兼容的 Logger 接口
 * 支持 OpenClaw api.logger 和标准 console
 */
export interface XClawLogger {
  log?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/**
 * ChatEvent state 类型（与原生 Gateway 兼容）
 */
export type ChatEventState = "delta" | "final" | "aborted" | "error";

/**
 * ✅ 原生 Gateway ChatEvent 兼容格式（转发到外部的消息格式）
 *
 * 👉 与 OpenClaw 原生 Gateway 输出格式 100% 兼容
 * 👉 OpenClaw Web UI 可以直接复用解析逻辑
 * 👉 额外增加 xclaw 字段存放实例元数据（不破坏原生格式）
 */
export interface NativeChatEvent {
  /** ✅ 与原生一致：RPC 帧类型 */
  type: "event";
  /** ✅ 与原生一致：事件类型 */
  event: "chat";
  /** ✅ 与原生一致：全局序列号 */
  seq: number;
  /** ✅ 与原生一致：状态版本号 */
  stateVersion: string;

  /** ✅ 与原生一致：ChatEvent payload */
  payload: {
    runId: string;
    sessionKey: string;
    seq: number;
    state: ChatEventState;
    message?: unknown;
    errorMessage?: string;
    errorKind?: string;
    usage?: unknown;
    stopReason?: string;
  };

  /**
   * 🧩 XClaw 扩展字段（不破坏原生格式兼容性）
   * 存放实例标识信息，XClaw 平台专用
   */
  xclaw?: {
    ip?: string;
    port?: number;
    containerId?: string;
    ts?: number;
    stream?: string;
  };
}
