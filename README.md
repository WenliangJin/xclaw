# XClaw OpenClaw 插件

将 OpenClaw 的流式输出转发到 XClaw 后端服务的 OpenClaw 扩展插件。

## ✅ 核心实现

**流式分发 API:** `dispatchReplyWithBufferedBlockDispatcher` (官方 plugin-sdk 提供)

**流式回调:** `dispatcherOptions.deliver` - 接收三种流式输出：
- `partial` - 流式增量文本
- `final` - 最终完整文本
- `block` - 块级流式输出

**消息上下文:** `finalizeInboundContext` - 构建标准化消息上下文

## 功能特性

- ✅ **官方流式分发 API** - `dispatchReplyWithBufferedBlockDispatcher`
- ✅ **三种流式输出类型** - partial / final / block
- ✅ **WebSocket 双向通信** - 自动连接、自动重连、心跳保活
- ✅ **消息缓冲队列** - 断连后自动补发
- ✅ **Agent 列表查询**
- ✅ **Session 历史查询**

## 安装

### 方式一：源码集成（推荐）

将插件目录复制到 OpenClaw 的 `extensions/xclaw` 目录，随 OpenClaw 源码一起编译启动。

```bash
cp -r xclaw-plugin /path/to/openclaw/extensions/xclaw
```

## 配置

在 OpenClaw 配置文件中添加：

```json
{
  "xclaw": {
    "enabled": true,
    "websocketUrl": "ws://your-xclaw-backend:8080/xclaw/ws/openclaw",
    "ip": "127.0.0.1",
    "port": "18789",
    "containerId": "xclaw-instance-001",
    "deployType": "native",
    "reconnectInterval": 5000
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用插件 |
| `websocketUrl` | string | `""` | XClaw 后端 WebSocket 地址（必填） |
| `ip` | string | `""` | 实例 IP 地址 |
| `port` | string | `""` | 实例端口 |
| `containerId` | string | `""` | 容器 ID |
| `deployType` | string | `""` | 部署类型 |
| `reconnectInterval` | number | `5000` | 重连间隔（毫秒） |

## 消息协议

### 流式输出转发

```typescript
{
  type: "stream",
  event: "xclaw_reply",
  seq: number,           // 全局序列号
  payload: {
    kind: "partial" | "final" | "block",  // 流式类型
    text: string,                         // 文本内容
    sessionKey: string,
    containerId: string,
  },
  xclaw: {
    ip: string,
    port: string,
    containerId: string,
    deployType: string,
  },
  timestamp: number,
}
```

### 后端发送消息

```typescript
{
  type: "message",
  action: "send",
  content: string,         // 用户消息内容
  sessionKey: string,      // 会话标识
}
```

### Agent 列表查询

```typescript
// 请求
{
  type: "request",
  action: "agent_list",
}

// 响应
{
  type: "response",
  action: "agent_list",
  data: [...],
}
```

### Session 历史查询

```typescript
// 请求
{
  type: "request",
  action: "session_history",
  sessionKey: string,
}

// 响应
{
  type: "response",
  action: "session_history",
  data: [...],
}
```

## 核心 API

### dispatchReplyWithBufferedBlockDispatcher

触发 OpenClaw 回复并获取流式输出的官方高级 API：

```typescript
await api.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
  ctx: finalizedCtx,      // 标准化消息上下文
  cfg: api.config,        // OpenClaw 配置
  dispatcherOptions: {
    deliver: async (payload, info) => {
      // info.kind: "partial" | "final" | "block"
      // payload.text: 回复文本
    },
    onError: (err) => {
      // 错误处理
    },
    onIdle: () => {
      // 回复完成回调
    },
  },
});
```

### finalizeInboundContext

构建标准化消息上下文：

```typescript
const finalizedCtx = api.runtime.channel.reply.finalizeInboundContext({
  Surface: "xclaw",
  Provider: "xclaw",
  Channel: "xclaw",
  SessionKey: sessionKey,
  Body: content,
  BodyForAgent: content,
  BodyForCommands: content,
  ChatType: "dm",
  CommandAuthorized: true,
});
```

## 开发

```bash
# 安装依赖
npm install

# 类型检查
npx tsc --noEmit
```

## 许可证

MIT
