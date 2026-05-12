/**
 * XClaw 插件注册逻辑
 * 按照 OpenClaw extension 标准结构实现
 */

import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/plugin-entry";
import type { XClawConfig } from "./src/types.js";

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
function createLazyXClawPluginService(api: OpenClawPluginApi): OpenClawPluginService {
  let service: OpenClawPluginService | null = null;

  const loadService = async () => {
    if (!service) {
      const config = getXClawConfig(api);

      // 如果未启用，创建空服务
      if (!config.enabled || !config.websocketUrl) {
        const info = (api.logger?.info || api.logger?.debug || console.log).bind(
          api.logger || console,
        );
        info("[XClaw] 插件未启用或未配置 WebSocket URL，跳过服务启动");
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

  // 提前初始化客户端，避免每次事件都动态 import
  let clientPromise: Promise<ReturnType<typeof import("./src/runtime.js").getXClawClient>> | null =
    null;
  const getClient = async () => {
    if (!clientPromise) {
      const { getXClawClient } = await import("./src/runtime.js");
      clientPromise = Promise.resolve(getXClawClient(config, api.logger || console));
    }
    return clientPromise;
  };

  // 提前初始化
  getClient().catch(() => {});

  // 注册 Agent 事件订阅（核心功能）
  api.registerAgentEventSubscription({
    id: "xclaw-forwarder",
    description: "XClaw 平台流式输出转发器",
    streams: config.streams,
    handle: async (event, ctx) => {
      try {
        const client = await getClient();
        info(`[XClaw] 事件回调触发: stream=${event.stream}, runId=${event.runId}`);

        // 如果未连接，尝试连接
        if (client.getStatus() !== "connected") {
          await client.connect().catch(() => {});
        }

        client.forwardEvent(event);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        api.logger?.error?.(`[XClaw] 处理事件失败: ${errorMsg}`);
      }
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

  // ✅ 插件注册时立即初始化连接（启动即连接，无需等待第一个事件）
  import("./src/runtime.js").then(({ getXClawClient }) => {
    const logger = api.logger || console;
    const client = getXClawClient(config, logger);
    client.connect().catch((err) => {
      const warnFn = logger.warn ? logger.warn.bind(logger) : console.warn;
      warnFn(`[XClaw] 首次连接失败，后续会自动重试: ${err.message}`);
    });
  });

  info("[XClaw] 插件注册完成");
}
