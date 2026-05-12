/**
 * XClaw 插件注册逻辑
 * 按照 OpenClaw extension 标准结构实现
 */

import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/plugin-entry";
import type { XClawConfig } from "./src/types.js";
import { XClawWebSocketClient } from "./src/websocket-client.js";

export const xclawPluginReload = { restartPrefixes: ["xclaw"] };

/**
 * 获取插件配置
 * 支持两种配置路径：
 * 1. 根路径: api.config.xclaw
 * 2. 插件配置路径: api.config.plugins.entries.xclaw.config
 */
function getXClawConfig(api: OpenClawPluginApi): XClawConfig {
  const config = api.config as {
    xclaw?: Partial<XClawConfig>;
    plugins?: { entries?: { xclaw?: { config?: Partial<XClawConfig> } } };
  };

  // 优先使用根路径配置，其次使用插件配置路径
  const pluginConfig = config.xclaw || config.plugins?.entries?.xclaw?.config || {};

  const defaultConfig: XClawConfig = {
    enabled: true,
    websocketUrl: "",
    reconnectInterval: 5000,
    streams: [
      "assistant",
      "tool",
      "lifecycle",
      "thinking",
      "error",
      "command_output",
      "patch",
      "plan",
      "approval",
      "item",
    ],
  };

  return { ...defaultConfig, ...pluginConfig } as XClawConfig;
}

/**
 * 创建懒加载的 XClaw 插件服务
 */
function createLazyXClawPluginService(
  api: OpenClawPluginApi,
  config: XClawConfig,
  client: XClawWebSocketClient,
): OpenClawPluginService {
  const info = (api.logger?.info || api.logger?.debug || console.log).bind(api.logger || console);

  return {
    id: "xclaw-service",
    start: async (ctx) => {
      info("[XClaw] 启动 XClaw 服务...");
      await client.connect().catch(() => {});
      info("[XClaw] XClaw 服务启动完成");
    },
    stop: async (ctx) => {
      info("[XClaw] 停止 XClaw 服务...");
      client.disconnect();
      info("[XClaw] XClaw 服务已停止");
    },
  };
}

/**
 * 注册 XClaw 插件
 */
export function registerXClawPlugin(api: OpenClawPluginApi) {
  const config = getXClawConfig(api);

  const info = (api.logger?.info || api.logger?.debug || console.log).bind(api.logger || console);
  const warn = (api.logger?.warn || console.warn).bind(api.logger || console);

  if (!config.enabled) {
    info("[XClaw] 插件已禁用");
    return;
  }

  if (!config.websocketUrl) {
    warn("[XClaw] 未配置 websocketUrl，插件将无法转发事件");
    return;
  }

  info(
    `[XClaw] 注册 XClaw 插件，目标: ${config.websocketUrl}, streams: ${JSON.stringify(config.streams)}`,
  );

  // ✅ 同步初始化客户端，避免懒加载时序问题
  const client = new XClawWebSocketClient(config, api.logger || console);

  // ✅ 注册 Agent 事件订阅（核心功能）
  // 确保 handle 是同步函数，使用最简化的实现
  const subscription = {
    id: "xclaw-forwarder",
    description: "XClaw 平台流式输出转发器",
    streams: config.streams,
    handle: (event: any, ctx: any) => {
      try {
        info(`[XClaw] 收到事件: stream=${event.stream}, runId=${event.runId}`);
        client.forwardEvent(event);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        warn(`[XClaw] 处理事件失败: ${errorMsg}`);
      }
    },
  };

  api.registerAgentEventSubscription(subscription);
  info("[XClaw] Agent 事件订阅已注册");

  // ✅ 注册插件服务，启动时自动连接 WebSocket
  api.registerService(createLazyXClawPluginService(api, config, client));

  // 注册 Gateway 方法（用于管理插件）
  api.registerGatewayMethod(
    "xclaw.status",
    async () => {
      return {
        enabled: config.enabled,
        status: client.getStatus(),
        websocketUrl: config.websocketUrl,
        ip: config.ip,
        port: config.port,
        containerId: config.containerId,
        deployType: config.deployType,
        streams: config.streams,
      };
    },
    {
      scope: "operator.admin",
    },
  );

  // 注册 Gateway 方法：手动触发重连
  api.registerGatewayMethod(
    "xclaw.reconnect",
    async () => {
      client.disconnect();
      await client.connect();
      return {
        status: client.getStatus(),
      };
    },
    {
      scope: "operator.admin",
    },
  );

  info("[XClaw] 插件注册完成");
}
