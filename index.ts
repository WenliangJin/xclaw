/**
 * XClaw OpenClaw 插件
 * 功能：将 OpenClaw 的流式输出转发到 XClaw 后端服务
 *
 * ✅ 核心实现：
 * - dispatchReplyWithBufferedBlockDispatcher (官方流式分发 API)
 * - deliver 回调接收流式输出 (partial/final/block)
 * - finalizeInboundContext 构建标准化消息上下文
 */

import { registerXClawPlugin, xclawPluginReload } from "./plugin-registration.js";

// ✅ OpenClaw 插件必须导出 register 函数！
export const register = registerXClawPlugin;
export const reload = xclawPluginReload;
