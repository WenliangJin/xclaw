/**
 * XClaw 插件注册逻辑
 * 按照 OpenClaw extension 标准结构实现
 *
 * ✅ 核心实现：
 *
 * 【触发回复 + 获取流式输出】dispatchReplyWithBufferedBlockDispatcher
 *   - 通过 dispatcherOptions.deliver 回调获取流式输出
 *   - kind: "partial" - 流式增量
 *   - kind: "final" - 最终结果
 *   - kind: "block" - 块级流式输出
 *
 * 【构建消息上下文】finalizeInboundContext
 *   - 标准化消息上下文对象
 *
 * 【查询接口】使用插件内部 API（非 HTTP）
 *   - api.runtime.subagent.getSessionMessages() - 获取会话历史
 *   - api.runtime.nodes.list() - 获取节点列表
 */

import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/plugin-entry";
import type { XClawConfig, XClawLogger } from "./src/types.js";
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

  const pluginConfig = config.xclaw || config.plugins?.entries?.xclaw?.config || {};

  const defaultConfig: XClawConfig = {
    enabled: true,
    websocketUrl: "",
    reconnectInterval: 5000,
    streams: [],
  };

  return { ...defaultConfig, ...pluginConfig } as XClawConfig;
}

/**
 * 创建 XClaw 插件服务
 * 启动时自动连接 WebSocket
 */
function createXClawPluginService(
  api: OpenClawPluginApi,
  config: XClawConfig,
  client: XClawWebSocketClient,
  logger: Required<XClawLogger>,
): OpenClawPluginService {
  const info = logger.info;

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
export function registerXClawPlugin(api: OpenClawPluginApi): void {
  const config = getXClawConfig(api);

  const wrappedLogger = {
    log: (api.logger as any)?.log || api.logger?.info || console.log,
    info: api.logger?.info || (api.logger as any)?.debug || console.log,
    debug: (api.logger as any)?.debug || console.log,
    warn: api.logger?.warn || console.warn,
    error: api.logger?.error || console.error,
  };

  const info = wrappedLogger.info;
  const warn = wrappedLogger.warn;
  const error = wrappedLogger.error;

  if (!config.enabled) {
    info("[XClaw] 插件已禁用");
    return;
  }

  if (!config.websocketUrl) {
    warn("[XClaw] 未配置 websocketUrl，插件将无法转发事件");
    return;
  }

  info(
    `[XClaw] 注册 XClaw 插件，目标: ${config.websocketUrl}`,
  );

  // ✅ 创建 WebSocket 客户端
  const client = new XClawWebSocketClient(config, wrappedLogger);

  // ✅ 注册 WebSocket 消息监听器
  // 接收后端转发的用户消息和查询请求
  client.addMessageHandler(async (msg: Record<string, unknown>) => {
    try {
      const type = msg.type as string;
      const action = msg.action as string;

      info(`[XClaw] 收到后端消息: type=${type}, action=${action}`);

      // 用户消息 → 触发 OpenClaw 回复并获取流式输出
      if (type === "message" && action === "send" && msg.content) {
        const content = msg.content as string;
        const sessionKey = (msg.sessionKey as string) || "default";
        const containerId = config.containerId || "xclaw-container";

        info(
          `[XClaw] 发送消息到 OpenClaw: sessionKey=${sessionKey}, content=${content.substring(0, 50)}...`,
        );

        // ✅ 【构建消息上下文】finalizeInboundContext
        const rawCtx = {
          Surface: "xclaw",
          Provider: "xclaw",
          Channel: "xclaw",
          SessionKey: sessionKey,
          Body: content,
          BodyForAgent: content,
          BodyForCommands: content,
          ChatType: "dm",
          ConversationLabel: "XClaw Web Interface",
          CommandAuthorized: true,
          AccountId: containerId,
          UserId: "xclaw-user",
          ServerId: "xclaw-server",
        };

        const finalizedCtx = api.runtime.channel.reply.finalizeInboundContext(rawCtx);

        // 全局序列号
        let seq = 0;

        // ✅ 【触发回复 + 获取流式输出】dispatchReplyWithBufferedBlockDispatcher
        // 通过 dispatcherOptions.deliver 回调获取流式输出
        await api.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: finalizedCtx,
          cfg: api.config,
          dispatcherOptions: {
            // ✅ 核心流式回调函数
            deliver: async (payload: { text?: string }, info: { kind: string }) => {
              const kind = info.kind; // "partial" | "final" | "block"

              if (!payload.text) {
                return;
              }

              seq++;
              wrappedLogger.info(`[XClaw] 收到流式输出: kind=${kind}, length=${payload.text.length}`);

              // 转发流式输出到后端
              client.send({
                type: "stream",
                event: "xclaw_reply",
                seq,
                payload: {
                  kind,
                  text: payload.text,
                  sessionKey,
                  containerId,
                },
                xclaw: {
                  ip: config.ip,
                  port: config.port,
                  containerId,
                  deployType: config.deployType,
                },
                timestamp: Date.now(),
              });
            },

            // 错误处理
            onError: (err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              error(`[XClaw] 流式分发错误: ${errorMsg}`);
              client.send({
                type: "error",
                error: errorMsg,
                xclaw: {
                  ip: config.ip,
                  port: config.port,
                  containerId,
                },
              });
            },

            // 空闲回调
            onIdle: () => {
              info("[XClaw] 流式分发完成");
            },
          },
        });

        info("[XClaw] 消息处理完成");
      }

      // Agent 列表查询 - ✅ 使用插件内部 API
      if (type === "request" && action === "agent_list") {
        try {
          // TODO: 检查是否有获取 Agent 列表的内部 API
          // 目前暂时使用 HTTP API，后续发现内部 API 后替换
          const response = await fetch("http://127.0.0.1:18789/api/agents");
          if (response.ok) {
            const data = await response.json();
            client.send({
              type: "response",
              action: "agent_list",
              data,
              xclaw: {
                ip: config.ip,
                port: config.port,
                containerId: config.containerId,
              },
            });
            info("[XClaw] Agent 列表已返回");
          }
        } catch (err) {
          error(`[XClaw] 获取 Agent 列表失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Session 历史查询 - ✅ 使用插件内部 API（非 HTTP）
      if (type === "request" && action === "session_history") {
        const sessionKey = (msg.sessionKey as string) || "default";
        try {
          // ✅ 使用插件内部 API，不走 HTTP！
          const result = await api.runtime.subagent.getSessionMessages({
            sessionKey,
            limit: 100, // 可选，默认返回最近的消息
          });
          
          client.send({
            type: "response",
            action: "session_history",
            data: result,
            xclaw: {
              ip: config.ip,
              port: config.port,
              containerId: config.containerId,
            },
          });
          info("[XClaw] Session 历史已返回（使用内部 API）");
        } catch (err) {
          error(`[XClaw] 获取 Session 历史失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 节点列表查询 - ✅ 使用插件内部 API（非 HTTP）
      if (type === "request" && action === "node_list") {
        try {
          // ✅ 使用插件内部 API，不走 HTTP！
          const result = await api.runtime.nodes.list();
          
          client.send({
            type: "response",
            action: "node_list",
            data: result,
            xclaw: {
              ip: config.ip,
              port: config.port,
              containerId: config.containerId,
            },
          });
          info("[XClaw] 节点列表已返回（使用内部 API）");
        } catch (err) {
          error(`[XClaw] 获取节点列表失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      error(`[XClaw] 处理后端消息失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ✅ 注册插件服务（启动时自动连接 WebSocket）
  api.registerService(createXClawPluginService(api, config, client, wrappedLogger as Required<XClawLogger>));

  // ✅ 注册 Gateway 管理方法
  (api as any).registerGatewayMethod?.(
    "xclaw.status",
    async ({ respond }: any) => {
      respond({
        enabled: config.enabled,
        status: client.getStatus(),
        websocketUrl: config.websocketUrl,
        ip: config.ip,
        port: config.port,
        containerId: config.containerId,
        deployType: config.deployType,
        implementation: "dispatchReplyWithBufferedBlockDispatcher + deliver callback",
        note: "Using internal plugin APIs: subagent.getSessionMessages, nodes.list",
      });
    },
    { scope: "operator.admin" },
  );

  (api as any).registerGatewayMethod?.(
    "xclaw.reconnect",
    async ({ respond }: any) => {
      client.disconnect();
      await client.connect();
      respond({ status: client.getStatus() });
    },
    { scope: "operator.admin" },
  );

  info("[XClaw] 插件注册完成");
  info("[XClaw] ✅ 使用官方流式分发 API: dispatchReplyWithBufferedBlockDispatcher");
  info("[XClaw] ✅ 通过 dispatcherOptions.deliver 回调获取流式输出（partial/final/block）");
  info("[XClaw] ✅ 使用 finalizeInboundContext 构建标准化消息上下文");
  info("[XClaw] ✅ 使用插件内部 API: subagent.getSessionMessages()（不走 HTTP）");
  info("[XClaw] ✅ 使用插件内部 API: nodes.list()（不走 HTTP）");
}
