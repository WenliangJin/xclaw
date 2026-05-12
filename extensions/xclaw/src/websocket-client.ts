/**
 * XClaw WebSocket 客户端
 * 负责连接 XClaw 平台 WebSocket 服务并转发事件
 */

import { WebSocket } from "ws";
import type {
  XClawConfig,
  ConnectionStatus,
  NativeChatEvent,
  AgentEventPayload,
  XClawLogger,
} from "./types.js";

export class XClawWebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private status: ConnectionStatus = "disconnected";
  private config: XClawConfig;
  private messageQueue: AgentEventPayload[] = [];
  private maxQueueSize = 1000;
  private logger: XClawLogger;
  /** 全局事件序列号（模拟原生 Gateway 的全局 seq） */
  private globalSeq: number = 0;

  constructor(config: XClawConfig, logger: XClawLogger = console) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * 安全的日志输出方法
   */
  private log(...args: unknown[]): void {
    if (this.logger.log) {
      this.logger.log(...args);
    } else if (this.logger.info) {
      this.logger.info(...args);
    } else if (this.logger.debug) {
      this.logger.debug(...args);
    }
  }

  private error(...args: unknown[]): void {
    if (this.logger.error) {
      this.logger.error(...args);
    } else if (this.logger.warn) {
      this.logger.warn(...args);
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<XClawConfig>) {
    const needReconnect =
      config.websocketUrl !== undefined && config.websocketUrl !== this.config.websocketUrl;

    this.config = { ...this.config, ...config };

    if (needReconnect && this.ws) {
      this.log("[XClaw] 配置变更，重新连接...");
      this.disconnect();
      this.connect().catch(() => {});
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 构建连接 URL（带 query 参数）
   */
  private buildConnectUrl(): string {
    const url = new URL(this.config.websocketUrl);

    if (this.config.ip) {
      url.searchParams.set("ip", this.config.ip);
    }
    if (this.config.port) {
      url.searchParams.set("port", String(this.config.port));
    }
    if (this.config.containerId) {
      url.searchParams.set("containerId", this.config.containerId);
    }

    return url.toString();
  }

  /**
   * 连接到 XClaw 平台 WebSocket 服务
   */
  async connect(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.status = "connecting";
    const url = this.buildConnectUrl();
    this.log(`[XClaw] 正在连接 WebSocket: ${url}`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.on("open", () => {
          this.status = "connected";
          this.log("[XClaw] WebSocket 连接成功");

          // 发送连接状态通知
          this.sendStatus("connected", "连接成功");

          // 启动心跳
          this.startPing();

          // 处理队列中的消息
          this.flushQueue();

          resolve();
        });

        this.ws.on("close", (code, reason) => {
          this.status = "disconnected";
          this.log(`[XClaw] WebSocket 断开: ${code} ${reason}`);
          this.stopPing();
          this.scheduleReconnect();
        });

        this.ws.on("error", (error) => {
          this.status = "error";
          this.error("[XClaw] WebSocket 错误:", error.message);
          this.sendStatus("error", error.message);
          reject(error);
        });

        this.ws.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString()) as { type?: string };
            this.handleServerMessage(message);
          } catch (e) {
            // 忽略非 JSON 消息
          }
        });
      } catch (error) {
        this.status = "error";
        this.error("[XClaw] 连接失败:", error);
        reject(error);
      }
    });
  }

  /**
   * 处理服务端消息
   */
  private handleServerMessage(message: { type?: string }) {
    this.log(`[XClaw] 收到服务端消息: ${message.type}`);

    if (message.type === "pong") {
      // 心跳响应，不需要处理
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.log("[XClaw] 尝试重新连接...");
      this.connect().catch(() => {
        // 错误已经在 connect 中处理
      });
    }, this.config.reconnectInterval);
  }

  /**
   * 启动心跳
   */
  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const msg = {
          type: "ping",
          source: "xclaw-openclaw-plugin",
          instance: {
            ip: this.config.ip,
            port: this.config.port,
            containerId: this.config.containerId,
          },
          timestamp: Date.now(),
        };
        this.send(msg);
      }
    }, 30000); // 30秒心跳
  }

  /**
   * 停止心跳
   */
  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * 发送消息
   */
  private send(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (e) {
      this.error("[XClaw] 发送消息失败:", e);
      return false;
    }
  }

  /**
   * 发送状态消息
   */
  private sendStatus(status: ConnectionStatus, message?: string) {
    const msg = {
      type: "status",
      source: "xclaw-openclaw-plugin",
      instance: {
        ip: this.config.ip,
        port: this.config.port,
        containerId: this.config.containerId,
      },
      timestamp: Date.now(),
      status: {
        status,
        message,
      },
    };
    this.send(msg);
  }

  /**
   * 将 AgentEvent stream 映射为 ChatEvent state
   */
  private mapStreamToState(
    stream: AgentEventStream,
    data?: Record<string, unknown>,
  ): "delta" | "final" | "aborted" | "error" {
    switch (stream) {
      case "assistant":
        // 如果是 assistant 流且有 phase = end，标记为 final
        if (data && data.phase === "end") {
          return "final";
        }
        return "delta";
      case "error":
        return "error";
      case "lifecycle":
        // 生命周期结束事件标记为 final
        if (data && (data.phase === "end" || data.phase === "completed")) {
          return "final";
        }
        return "delta";
      default:
        return "delta";
    }
  }

  /**
   * 转换为原生 Gateway ChatEvent 兼容格式
   */
  private toNativeChatEvent(event: AgentEventPayload): {
    type: "event";
    event: "chat";
    seq: number;
    stateVersion: string;
    payload: {
      runId: string;
      sessionKey: string;
      seq: number;
      state: "delta" | "final" | "aborted" | "error";
      message?: unknown;
      errorMessage?: string;
      errorKind?: string;
    };
    // 附加 XClaw 实例信息（不破坏原生格式兼容性）
    xclaw?: {
      ip?: string;
      port?: number;
      containerId?: string;
      ts?: number;
      stream?: string;
    };
  } {
    const data = event.data as Record<string, unknown>;
    const state = this.mapStreamToState(event.stream, data);

    // 构建标准 ChatEvent payload
    const payload: {
      runId: string;
      sessionKey: string;
      seq: number;
      state: "delta" | "final" | "aborted" | "error";
      message?: unknown;
      errorMessage?: string;
      errorKind?: string;
    } = {
      runId: event.runId,
      sessionKey: event.sessionKey || "",
      seq: event.seq,
      state,
    };

    // assistant 流：转换为标准 message 格式
    if (event.stream === "assistant" && data) {
      payload.message = {
        content: [
          {
            type: "text",
            text: data.text || "",
          },
        ],
        delta: data.delta || "",
      };
    }
    // error 流：转换为标准 error 格式
    else if (event.stream === "error" && data) {
      payload.errorMessage = (data.message as string) || "";
      payload.errorKind = (data.kind as string) || "unknown";
    }
    // 其他流：原样放在 message 中
    else if (data) {
      payload.message = data;
    }

    // 递增全局序列号（模拟原生 Gateway 的全局 seq）
    this.globalSeq++;

    // ✅ 返回原生 Gateway 100% 兼容格式
    // XClaw 实例信息放在 xclaw 字段中，不破坏原生格式
    return {
      type: "event",
      event: "chat",
      seq: this.globalSeq, // ✅ 外层：全局序列号（与原生一致）
      stateVersion: "1", // ✅ 状态版本号（与原生一致）
      payload, // ✅ payload: 标准 ChatEvent 格式
      // 🧩 XClaw 扩展字段（不破坏原生格式解析，可选忽略）
      xclaw: {
        ip: this.config.ip,
        port: this.config.port,
        containerId: this.config.containerId,
        ts: event.ts,
        stream: event.stream,
        runSeq: event.seq, // 保留 run 内序列号供参考
      },
    };
  }

  /**
   * 转发 Agent 事件（原生 Gateway ChatEvent 兼容格式）
   */
  forwardEvent(event: AgentEventPayload): boolean {
    // 检查是否需要转发该流
    if (this.config.streams.length > 0 && !this.config.streams.includes(event.stream)) {
      return false;
    }

    // ✅ 转换为原生 Gateway 兼容格式
    const nativeChatEvent = this.toNativeChatEvent(event);

    if (!this.send(nativeChatEvent)) {
      // 连接未就绪，加入队列
      this.enqueue(event);
      return false;
    }

    return true;
  }

  /**
   * 消息入队
   */
  private enqueue(event: AgentEventPayload) {
    if (this.messageQueue.length >= this.maxQueueSize) {
      // 队列满了，丢弃最旧的
      this.messageQueue.shift();
    }
    this.messageQueue.push(event);
  }

  /**
   * 刷新队列，发送所有待发送消息
   */
  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const event = this.messageQueue.shift();
      if (event) {
        this.forwardEvent(event);
      }
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.sendStatus("disconnected", "插件关闭");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.status = "disconnected";
    this.messageQueue = [];
    this.log("[XClaw] WebSocket 已断开");
  }
}
