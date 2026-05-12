# XClaw - OpenClaw Gateway 流式输出转发插件

**V2 版本 - 可直接集成到 OpenClaw 源码 extension 目录**

通过 OpenClaw 官方 Agent Event API 获取最原生的 Gateway 流式输出，转发到 XClaw 平台。

## 特性

- ✅ **官方 API** - 使用 `registerAgentEventSubscription` 标准接口
- ✅ **源码集成** - 直接放到 `extensions/xclaw` 目录即可编译
- ✅ **完整的事件流支持** - 10+ 种不同的事件流
- ✅ **自动重连** - WebSocket 断开自动重连
- ✅ **消息缓冲** - 连接未就绪时消息缓存
- ✅ **心跳保活** - 30秒自动心跳
- ✅ **Query 参数** - 支持 ip/port/containerId 参数传递
- ✅ **管理 API** - 提供 Gateway 方法查询状态和手动重连

## 安装

### 方式一：源码集成（推荐）

```bash
# 1. 将 xclaw 目录复制到 OpenClaw 源码的 extensions 目录下
cp -r xclaw /path/to/openclaw/extensions/

# 2. 安装依赖
cd /path/to/openclaw
pnpm install

# 3. 编译 OpenClaw
pnpm build

# 4. 启动 OpenClaw
openclaw start
```

### 方式二：作为独立插件

参考 xclaw-v1 版本的安装方式。

## 配置

编辑 OpenClaw 配置文件：

```json
{
  "xclaw": {
    "enabled": true,
    "websocketUrl": "ws://127.0.0.1:8081/api/ws/instance",
    "ip": "192.168.1.100",
    "port": 10887,
    "containerId": "openclaw-instance-abc123",
    "reconnectInterval": 5000,
    "streams": [
      "assistant",
      "tool",
      "lifecycle",
      "thinking",
      "error",
      "command_output",
      "patch",
      "plan",
      "approval",
      "item"
    ]
  }
}
```

### 配置参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | - | `true` | 是否启用插件 |
| `websocketUrl` | string | ✅ | - | XClaw 平台 WebSocket 地址 |
| `ip` | string | - | - | 本机 IP，连接时通过 query 传递 |
| `port` | number | - | - | 本机端口，连接时通过 query 传递 |
| `containerId` | string | - | - | 容器/实例 ID，连接时通过 query 传递 |
| `reconnectInterval` | number | - | `5000` | 自动重连间隔（毫秒） |
| `streams` | string[] | - | 全部 | 需要转发的事件流 |

## 连接 URL 示例

插件启动时会自动拼接 query 参数：

```
ws://127.0.0.1:8081/api/ws/instance?ip=192.168.1.100&port=10887&containerId=openclaw-instance-abc123
```

## 事件流说明

| 流名称 | 说明 | 典型数据 |
|--------|------|---------|
| `assistant` | ✅ 助手文本流式输出 | `{ text: "...", delta: "..." }` |
| `tool` | 工具调用事件 | `{ phase: "start"/"end", name: "...", params }` |
| `lifecycle` | 运行生命周期 | `{ phase: "start"/"end"/"error" }` |
| `thinking` | 思考过程（Claude） | `{ text: "...", delta: "..." }` |
| `error` | 错误信息 | `{ message: "...", kind: "..." }` |
| `command_output` | Shell 命令输出 | `{ output: "...", exitCode }` |
| `patch` | 文件变更 | `{ added: [], modified: [], deleted: [] }` |
| `plan` | 计划更新 | `{ phase: "update", steps: [] }` |
| `approval` | 审批请求 | `{ phase: "requested", title: "..." }` |
| `item` | 工作项事件 | `{ itemId, phase, kind, status }` |

## 转发消息格式

```typescript
{
  type: "event" | "status" | "ping" | "pong",
  source: "xclaw-openclaw-plugin",
  instance: {
    ip?: string,
    port?: number,
    containerId?: string
  },
  timestamp: 1715458800000,
  runId?: string,           // 运行 ID
  sessionKey?: string,      // 会话 Key
  event?: {                 // type = event 时
    runId: string,
    seq: number,
    stream: string,
    ts: number,
    sessionKey?: string,
    data: Record<string, unknown>
  },
  status?: {                // type = status 时
    status: "disconnected" | "connecting" | "connected" | "error",
    message?: string
  }
}
```

## Gateway 管理 API

插件注册了两个 Gateway 方法，需要 `operator.admin` 权限调用：

### 1. 查询状态

```javascript
// Gateway 方法: xclaw.status
// 返回:
{
  enabled: true,
  status: "connected",
  websocketUrl: "ws://...",
  ip: "...",
  port: ...,
  containerId: "...",
  streams: [...]
}
```

### 2. 手动重连

```javascript
// Gateway 方法: xclaw.reconnect
// 返回:
{
  status: "connecting" | "connected"
}
```

## 文件结构

```
extensions/xclaw/
├── README.md              # 本文件
├── package.json           # npm 包配置
├── openclaw.plugin.json   # OpenClaw 插件配置
├── tsconfig.json          # TypeScript 配置
├── index.ts               # 插件入口
├── plugin-registration.ts # 插件注册逻辑
└── src/
    ├── types.ts           # 类型定义
    ├── websocket-client.ts # WebSocket 客户端
    └── runtime.ts         # 运行时代码
```

## 开发调试

```bash
# 编译
pnpm build

# 查看日志
tail -f ~/.openclaw/logs/openclaw.log | grep XClaw

# 或启动时查看
openclaw start --verbose
```

## 架构

```
OpenClaw Gateway
      ↓
Agent Event Bus (核心事件总线)
      ↓
registerAgentEventSubscription (官方 API)
      ↓
XClaw Plugin Service (懒加载服务)
      ↓
WebSocket 消息队列
      ↓
XClaw 平台 WebSocket 服务
```

## License

MIT
