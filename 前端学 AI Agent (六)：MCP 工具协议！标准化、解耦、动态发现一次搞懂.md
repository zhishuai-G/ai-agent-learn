# 前端学 AI Agent (六)：MCP 工具协议！标准化、解耦、动态发现一次搞懂

## 前言

前五篇文章，我们从零搭建了一个完整的 AI Agent 系统：

- **Phase 1**：LLM 基础聊天
- **Phase 2**：Tool Use / Function Calling，让 AI 自己调 API
- **Phase 3**：LangGraph 状态图，将 Agent 编排为可控的状态机
- **Phase 4**：RAG 检索增强生成
- **Phase 5**：Multi-Agent 多智能体协作

但回头看 Phase 2-5 的代码，有个一直被忽略的问题——**工具和 Agent 是绑死的**。

```typescript
// Phase 2: 工具直接 import，硬编码到 Agent
import { weatherTool, timeTool, searchTool } from '../langchain/tools';
const modelWithTools = model.bindTools([weatherTool, timeTool, searchTool]);
```

这带来三个痛点：

| 痛点 | 表现 |
|---|---|
| 换 Agent 要重新绑定 | 同一个 searchTool，Phase 2 绑一遍、Phase 5 的 Swarm 又绑一遍 |
| 加工具要改代码 | 新增工具必须修改 Agent 源码，重新编译部署 |
| 无法动态发现 | Agent 启动时就知道有哪些工具，运行时不能增减 |

本文介绍的 **MCP（Model Context Protocol）** 就是来解决这三个问题的。

## 一、MCP 是什么

MCP 是 Anthropic 发布的**开放协议**，定义了 LLM 应用与外部工具/数据源之间的标准通信方式。

一句话理解：

> **直接 tool calling = 电器焊死在墙上**
> **MCP = 统一插座标准，任何电器插上就能用**

```
传统方式（Phase 2-5）：
  Agent 代码 → 硬编码 import → 工具实现
  工具和 Agent 绑死，改一个要动另一个

MCP 方式：
  Agent → MCP Client → MCP Server → 工具实现
           ↑ 运行时动态发现工具
           ↑ 标准协议，完全解耦
```

## 二、MCP 架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Host   │     │  MCP Client │     │  MCP Server │
│ (LLM 应用)  │────→│  (协议客户端) │────→│  (工具提供方) │
│             │     │             │     │             │
│ NestJS      │     │ 管理连接     │     │ 注册工具     │
│ Agent 服务   │     │ 翻译协议     │     │ 执行工具     │
│             │     │ 处理响应     │     │ 返回结果     │
└─────────────┘     └─────────────┘     └─────────────┘
```

三个核心角色：

- **MCP Host**：发起连接的 LLM 应用（我们的 NestJS 后端）
- **MCP Client**：与 Server 保持连接，负责协议通信（`MultiServerMCPClient`）
- **MCP Server**：提供工具的服务端（我们创建的 `tools-server.ts`）

## 三、传输方式

MCP 支持两种传输：

| 传输方式 | 适用场景 | 原理 |
|---|---|---|
| **stdio** | 本地进程 | Client 启动 Server 子进程，通过 stdin/stdout 通信 |
| **Streamable HTTP** | 远程服务 | Client 通过 HTTP 连接远程 Server |

本文使用 **stdio** 传输——最简单直观，学习首选。

## 四、实战：创建 MCP Server

### 4.1 安装依赖

```bash
npm install @modelcontextprotocol/sdk @langchain/mcp-adapters --legacy-peer-deps
```

两个核心依赖：
- `@modelcontextprotocol/sdk`：MCP 协议的官方 TypeScript SDK
- `@langchain/mcp-adapters`：将 MCP 工具转为 LangChain 格式的适配器

### 4.2 创建 MCP Server

> 文件：`server/src/mcp/mcp-server/tools-server.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 1. 创建 Server 实例
const server = new McpServer({
  name: 'tools-server',
  version: '1.0.0',
});

// 2. 注册工具（和 Phase 2 的写法对比！）
server.tool(
  'get_weather',                           // 工具名
  '获取指定城市的实时天气信息...',            // 描述
  { city: z.string().describe('城市名称') }, // 参数 schema
  async ({ city }) => {                    // 执行函数
    // ... 调用天气 API ...
    return {
      content: [{ type: 'text', text: result }],
    };
  },
);

// 3. 启动 Server（stdio 传输）
const transport = new StdioServerTransport();
await server.connect(transport);
```

**和 Phase 2 的 `tool()` 函数对比：**

```typescript
// Phase 2: @langchain/core/tools 的 tool() 函数
export const weatherTool = tool(
  async ({ city }) => { /* 实现 */ return result; },
  { name: 'get_weather', description: '...', schema: z.object({...}) },
);

// Phase 6: MCP SDK 的 server.tool() 方法
server.tool(
  'get_weather', '...描述...',
  { city: z.string() },
  async ({ city }) => {
    return { content: [{ type: 'text', text: result }] };
  },
);
```

核心区别：
- Phase 2 返回 LangChain `StructuredTool` 对象，需要手动绑定到 Agent
- Phase 6 注册到 MCP Server，**任何** MCP Client 都能发现并调用

### 4.3 重要：stdio 不能用 console.log

```typescript
// ❌ 错误！stdout 是 MCP 协议通道，console.log 会干扰协议
console.log('Server started');

// ✅ 正确！stderr 不影响协议
console.error('Server started');
```

## 五、实战：创建 MCP Client（NestJS Service）

> 文件：`server/src/mcp/mcp.service.ts`

```typescript
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private mcpClient!: MultiServerMCPClient;

  async onModuleInit() {
    // 1. 初始化 MCP Client
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        tools: {
          transport: 'stdio',
          command: 'node',
          args: ['dist/mcp/mcp-server/tools-server.js'],
        },
      },
    });
  }

  async *chat(message: string, threadId?: string) {
    // 2. 动态发现工具（核心！）
    const mcpTools = await this.mcpClient.getTools();
    // 返回标准的 LangChain StructuredTool[]

    // 3. 注入 Agent（和 Phase 3 一模一样！）
    const agent = createReactAgent({
      llm: model,
      tools: mcpTools,  // 不再 import 硬编码的工具！
    });

    // 4. 流式执行
    yield* streamMultiAgent(agent, ...);
  }

  async onModuleDestroy() {
    // 5. 清理子进程资源
    await this.mcpClient.close();
  }
}
```

### 5.1 `getTools()` 做了什么

这是 MCP 的核心方法：

1. 通过 MCP 协议向 Server 发送 `tools/list` 请求
2. Server 返回所有已注册工具的元信息（name、description、inputSchema）
3. `@langchain/mcp-adapters` 将 MCP 工具格式转换为 LangChain Tool 格式

返回的是标准的 `StructuredTool[]`，可以直接传给 `createReactAgent` 的 `tools` 参数。

### 5.2 生命周期管理

MCP Client 使用 stdio 传输时，会启动 Server 作为**子进程**。所以：

- `OnModuleInit` → 创建 Client，启动子进程
- `OnModuleDestroy` → 关闭 Client，清理子进程

如果不正确关闭，会导致 zombie 进程。

## 六、API 端点

> 文件：`server/src/mcp/mcp.controller.ts`

提供两个端点：

| 端点 | 方法 | 作用 |
|---|---|---|
| `/mcp/chat` | POST | MCP Agent 聊天（工具动态获取） |
| `/mcp/tools` | GET | 列出 MCP Server 的所有工具 |

### 6.1 聊天端点

```bash
curl -X POST http://localhost:3000/mcp/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "今天北京天气怎么样？"}'
```

SSE 事件流：

```
data: {"type":"tools_discovered","tools":["get_weather","get_current_time","web_search"]}
data: {"type":"agent_start","agent":"agent"}
data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"}}
data: {"type":"tool_result","result":"北京当前天气：晴..."}
data: {"type":"content","content":"根据查询结果，北京今天..."}
data: {"type":"done"}
```

注意第一个事件 `tools_discovered`——这是 MCP 独有的！Agent 在运行时才知道有哪些工具可用。

### 6.2 工具发现端点

```bash
curl http://localhost:3000/mcp/tools
```

```json
{
  "serverName": "tools",
  "toolCount": 3,
  "tools": [
    { "name": "get_weather", "description": "获取指定城市的实时天气信息..." },
    { "name": "get_current_time", "description": "获取当前的日期和时间..." },
    { "name": "web_search", "description": "搜索百科知识..." }
  ]
}
```

## 七、MCP vs 直接 Tool Calling

| 维度 | 直接 Tool Calling（Phase 2-5） | MCP（Phase 6） |
|---|---|---|
| 耦合度 | 工具 `import` 到 Agent 源码 | 工具和 Agent 完全解耦 |
| 发现方式 | 编译时确定（`import`） | 运行时动态发现（`getTools()`） |
| 复用性 | 每个 Agent 单独 import | 同一 Server 给多个 Agent 用 |
| 维护成本 | 改工具要改 Agent 代码 | 改 Server 不影响 Agent |
| 适用规模 | 几个工具、1-2 个 Agent | 大量工具、多 Agent 系统 |

## 八、项目文件结构

```
server/src/mcp/
├── mcp-server/
│   └── tools-server.ts    # MCP Server：注册 3 个工具（从 Phase 2 迁移）
├── dto/
│   └── mcp-request.dto.ts # 请求 DTO
├── mcp.controller.ts      # API 端点（/mcp/chat、/mcp/tools）
├── mcp.module.ts          # NestJS 模块注册
└── mcp.service.ts         # MCP Client 服务（动态发现 + 注入 Agent）
```

## 九、总结

Phase 6 的核心就是一句话：**工具从硬编码 import 变成了 MCP 动态获取**。

```typescript
// Before（Phase 2-5）
import { weatherTool, timeTool, searchTool } from '../langchain/tools';
const agent = createReactAgent({ tools: [weatherTool, timeTool, searchTool] });

// After（Phase 6）
const mcpTools = await mcpClient.getTools(); // 运行时动态获取
const agent = createReactAgent({ tools: mcpTools });
```

Agent 的用法（`createReactAgent`）完全没变！MCP 只改变了"工具从哪来"，不改变"Agent 怎么用工具"。

这就像从"焊接电器"升级到"统一插座标准"——电器还是那些电器，但插拔变得自由了。

---

**下一篇**：Phase 7 全栈整合，把 Phase 1-6 的所有能力集成到一个完整的前后端应用中。
