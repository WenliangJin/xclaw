/**
 * XClaw - OpenClaw Gateway 原生流式输出转发插件
 *
 * 按照 OpenClaw extension 标准结构实现
 * 可以直接集成到 OpenClaw 源码中编译启动
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { xclawPluginReload, registerXClawPlugin } from "./plugin-registration.js";

export default definePluginEntry({
  id: "xclaw",
  name: "XClaw Stream Forwarder",
  description: "OpenClaw Gateway 原生流式输出转发到 XClaw 平台",
  reload: xclawPluginReload,
  register: registerXClawPlugin,
});

// 导出类型供外部使用
export type {
  XClawConfig,
  ConnectionStatus,
  ForwardedMessage,
  AgentEventPayload,
  AgentEventStream,
} from "./src/types.js";
export { XClawWebSocketClient } from "./src/websocket-client.js";
export {
  createXClawEventHandler,
  registerXClawAgentEventSubscription,
  createXClawPluginService,
} from "./src/runtime.js";
