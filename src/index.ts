/**
 * XClaw 插件主入口
 * 
 * 通过 OpenClaw 官方 Agent Event API 获取原生流式输出，
 * 转发到外部 WebSocket 服务
 */

import type { OpenClawPluginApi } from "openclaw/dist/plugins/types.js";
import type { XClawConfig } from "./types";
import { XClawWebSocketClient } from "./websocket-client";

// 默认配置
const DEFAULT_CONFIG: Partial<XClawConfig> = {
  enabled: true,
  reconnectInterval: 5000,
  streams: ["assistant", "tool", "lifecycle", "thinking", "error", "command_output", "patch", "plan", "approval"],
};

let client: XClawWebSocketClient | null = null;

/**
 * 插件入口函数
 */
export default function xclawPlugin(api: OpenClawPluginApi) {
  console.log("[XClaw] 插件加载中...");

  // 获取配置
  const config = api.config as XClawConfig;
  const mergedConfig = { ...DEFAULT_CONFIG, ...config } as XClawConfig;

  // 如果未启用，直接返回
  if (!mergedConfig.enabled) {
    console.log("[XClaw] 插件未启用");
    return;
  }

  // 检查必要配置
  if (!mergedConfig.websocketUrl) {
    console.error("[XClaw] 缺少 websocketUrl 配置，插件无法启动");
    return;
  }

  // 创建 WebSocket 客户端
  client = new XClawWebSocketClient(mergedConfig);

  // 启动连接
  client.connect().catch((e) => {
    console.error("[XClaw] 初始连接失败:", e);
  });

  // 注册 Agent Event 订阅 - 这是核心！
  api.registerAgentEventSubscription({
    id: "xclaw-forwarder",
    description: "XClaw 流式输出转发器",
    streams: mergedConfig.streams,
    handle: (event, ctx) => {
      if (!client) return;
      
      // 转发事件
      client.forwardEvent(event);
    },
  });

  // 注册配置变更钩子（可选）
  api.on?.("before_agent_start", () => {
    // 可以在这里做一些钩子逻辑
  });

  // 注册 Gateway 启动钩子
  api.on?.("gateway_start", (evt) => {
    console.log(`[XClaw] Gateway 启动，端口: ${evt.port}`);
  });

  // 注册 Gateway 停止钩子
  api.on?.("gateway_stop", () => {
    console.log("[XClaw] Gateway 停止，断开连接");
    if (client) {
      client.disconnect();
    }
  });

  console.log("[XClaw] 插件加载完成！");
  console.log(`[XClaw] 目标 WebSocket: ${mergedConfig.websocketUrl}`);
  console.log(`[XClaw] 订阅流: ${mergedConfig.streams.join(", ")}`);
  if (mergedConfig.ip) console.log(`[XClaw] 本机 IP: ${mergedConfig.ip}`);
  if (mergedConfig.port) console.log(`[XClaw] 本机端口: ${mergedConfig.port}`);
  if (mergedConfig.containerId) console.log(`[XClaw] 容器 ID: ${mergedConfig.containerId}`);
}

/**
 * 获取客户端实例（用于测试和调试）
 */
export function getClient() {
  return client;
}

// 导出类型
export type { XClawConfig, ConnectionStatus, ForwardedMessage, AgentEventPayload, AgentEventStream } from "./types";
export { XClawWebSocketClient } from "./websocket-client";
