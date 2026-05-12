/**
 * XClaw 插件运行时代码
 * 懒加载的核心逻辑
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { XClawConfig } from "./types.js";
import { XClawWebSocketClient } from "./websocket-client.js";

let client: XClawWebSocketClient | null = null;

/**
 * 获取或创建 XClaw 客户端
 */
export function getXClawClient(config: XClawConfig, logger: Console = console): XClawWebSocketClient {
  if (!client) {
    client = new XClawWebSocketClient(config, logger);
  } else {
    client.updateConfig(config);
  }
  return client;
}

/**
 * 事件处理器
 */
export function createXClawEventHandler(config: XClawConfig, logger: Console = console) {
  const client = getXClawClient(config, logger);

  return {
    handleEvent: (event: Parameters<Parameters<OpenClawPluginApi["registerAgentEventSubscription"]>[0]["handle"]>[0]) => {
      client.forwardEvent(event);
    },
    start: async () => {
      await client.connect();
    },
    stop: () => {
      client.disconnect();
    },
    getClient: () => client,
  };
}

/**
 * 注册 XClaw Agent 事件订阅
 */
export function registerXClawAgentEventSubscription(api: OpenClawPluginApi, config: XClawConfig) {
  const handler = createXClawEventHandler(config);

  api.registerAgentEventSubscription({
    id: "xclaw-forwarder",
    description: "XClaw 平台流式输出转发器",
    streams: config.streams,
    handle: (event) => {
      handler.handleEvent(event);
    },
  });

  return handler;
}

/**
 * 创建 XClaw 插件服务
 */
export function createXClawPluginService(config: XClawConfig) {
  let handler: ReturnType<typeof createXClawEventHandler> | null = null;

  return {
    id: "xclaw-service",
    start: async (ctx: { logger?: Console } = {}) => {
      const logger = ctx.logger || console;
      logger.log("[XClaw] 启动 XClaw 服务...");

      handler = createXClawEventHandler(config, logger);
      await handler.start();

      logger.log("[XClaw] XClaw 服务启动完成");
    },
    stop: async (ctx: { logger?: Console } = {}) => {
      const logger = ctx.logger || console;
      logger.log("[XClaw] 停止 XClaw 服务...");

      if (handler) {
        handler.stop();
        handler = null;
      }

      logger.log("[XClaw] XClaw 服务已停止");
    },
  };
}
