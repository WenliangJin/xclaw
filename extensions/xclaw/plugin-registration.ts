/**
 * XClaw 插件注册逻辑
 * 按照 OpenClaw extension 标准结构实现
 */

import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/plugin-entry";
import type { XClawConfig } from "./src/types.js";

export const xclawPluginReload = { restartPrefixes: ["xclaw"] };

/**
 * 获取插件配置
 */
function getXClawConfig(api: OpenClawPluginApi): XClawConfig {
  const pluginConfig = (api.config as { xclaw?: Partial<XClawConfig> })?.xclaw || {};

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
function createLazyXClawPluginService(api: OpenClawPluginApi): OpenClawPluginService {
  let service: OpenClawPluginService | null = null;

  const loadService = async () => {
    if (!service) {
      const config = getXClawConfig(api);

      // 如果未启用，创建空服务
      if (!config.enabled || !config.websocketUrl) {
        api.logger?.log("[XClaw] 插件未启用或未配置 WebSocket URL，跳过服务启动");
        service = {
          id: "xclaw-service",
          start: async () => {},
          stop: async () => {},
        };
        return service;
      }

      const { createXClawPluginService } = await import("./src/runtime.js");
      service = createXClawPluginService(config);
    }
    return service;
  };

  return {
    id: "xclaw-service",
    start: async (ctx) => {
      const loaded = await loadService();
      await loaded.start(ctx);
    },
    stop: async (ctx) => {
      if (!service?.stop) {
        return;
      }
      await service.stop(ctx);
    },
  };
}

/**
 * 注册 XClaw 插件
 */
export function registerXClawPlugin(api: OpenClawPluginApi) {
  const config = getXClawConfig(api);

  if (!config.enabled) {
    api.logger?.log("[XClaw] 插件已禁用");
    return;
  }

  if (!config.websocketUrl) {
    api.logger?.warn("[XClaw] 未配置 websocketUrl，插件将无法转发事件");
    return;
  }

  api.logger?.log(`[XClaw] 注册 XClaw 插件，目标: ${config.websocketUrl}`);

  // 注册 Agent 事件订阅（核心功能）
  api.registerAgentEventSubscription({
    id: "xclaw-forwarder",
    description: "XClaw 平台流式输出转发器",
    streams: config.streams,
    handle: async (event, ctx) => {
      // 懒加载运行时代码
      const { getXClawClient } = await import("./src/runtime.js");
      const client = getXClawClient(config, api.logger || console);

      // 如果未连接，尝试连接
      if (client.getStatus() !== "connected") {
        await client.connect().catch(() => {});
      }

      client.forwardEvent(event);
    },
  });

  // 注册插件服务
  api.registerService(createLazyXClawPluginService(api));

  // 注册 Gateway 方法（用于管理插件）
  api.registerGatewayMethod(
    "xclaw.status",
    async () => {
      const { getXClawClient } = await import("./src/runtime.js");
      const client = getXClawClient(config, api.logger || console);
      return {
        enabled: config.enabled,
        status: client.getStatus(),
        websocketUrl: config.websocketUrl,
        ip: config.ip,
        port: config.port,
        containerId: config.containerId,
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
      const { getXClawClient } = await import("./src/runtime.js");
      const client = getXClawClient(config, api.logger || console);
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

  api.logger?.log("[XClaw] 插件注册完成");
}
