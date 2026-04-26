# Phase 6: MCP - 工具协议与标准化

## 前置知识

- Phase 2: Tool Use / Function Calling（直接绑定工具到 Agent）
- Phase 5: Multi-Agent（多个 Agent 各自绑定工具）

## 核心问题

Phase 2-5 的工具调用方式是**硬编码**：

```typescript
// 工具定义和 Agent 耦合在一起
const searchTool = tool({ name: 'search', func: () => {...} });
const agent = createReactAgent({ tools: [searchTool] });
```

问题：
1. **换 Agent 要重新绑定**：同一个搜索工具，每个 Agent 都要写一遍
2. **加工具要改代码**：新增工具必须修改 Agent 源码
3. **无法动态发现**：Agent 启动时就知道有哪些工具，运行时不能增减

MCP（Model Context Protocol）解决的就是工具的**标准化、解耦、动态发现**。

## 知识点

### 6.1 MCP 协议原理

MCP 是 Anthropic 发布的开放协议，定义了 LLM 应用与外部工具/数据源之间的标准通信方式。

```
传统方式（Phase 2-5）：
  Agent 代码 → 硬编码工具 → 工具实现
  工具和 Agent 绑死

MCP 方式：
  Agent → MCP Client → MCP Server → 工具实现
           ↑ 运行时动态发现工具
           ↑ 标准协议，解耦
```

类比：
- 直接 tool calling = 电器焊死在墙上
- MCP = 统一插座标准，任何电器插上就能用

### 6.2 MCP 架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Host   │     │  MCP Client │     │  MCP Server │
│ (LLM 应用)  │────→│  (协议客户端) │────→│  (工具提供方) │
│             │     │             │     │             │
│ Claude/     │     │ 管理连接     │     │ 注册工具     │
│ ChatGPT/    │     │ 翻译协议     │     │ 执行工具     │
│ 自定义 Agent │     │ 处理响应     │     │ 返回结果     │
└─────────────┘     └─────────────┘     └─────────────┘
```

核心概念：
- **MCP Host**：发起连接的 LLM 应用（如 Claude Desktop、自定义 Agent）
- **MCP Client**：与 Server 保持 1:1 连接，负责协议通信
- **MCP Server**：提供工具（Tools）、资源（Resources）、提示词（Prompts）

### 6.3 传输方式

MCP 支持两种传输：

| 传输方式 | 适用场景 | 原理 |
|---|---|---|
| **stdio** | 本地进程 | Client 启动 Server 子进程，通过 stdin/stdout 通信 |
| **SSE** | 远程服务 | Client 通过 HTTP 连接远程 Server，SSE 接收消息 |

### 6.4 MCP Server 开发

使用 `@modelcontextprotocol/sdk` 创建 Server：

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 1. 创建 Server
const server = new McpServer({
  name: 'search-server',
  version: '1.0.0',
});

// 2. 注册工具（和 Phase 2 的 tool() 写法类似，但走 MCP 协议）
server.tool(
  'search',                                    // 工具名
  '搜索产品信息',                                // 描述
  { query: z.string().describe('搜索关键词') },  // 参数 schema
  async ({ query }) => {                        // 执行函数
    const results = await doSearch(query);
    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
    };
  },
);

// 3. 启动 Server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 6.5 MCP Client 开发

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 1. 创建 Client
const client = new Client({ name: 'my-agent', version: '1.0.0' });

// 2. 连接 Server
const transport = new StdioClientTransport({
  command: 'node',
  args: ['search-server.js'],
});
await client.connect(transport);

// 3. 动态发现工具
const tools = await client.listTools();
// 返回: [{ name: 'search', description: '搜索产品信息', inputSchema: {...} }]

// 4. 调用工具
const result = await client.callTool({
  name: 'search',
  arguments: { query: '贪吃蛇游戏' },
});
```

### 6.6 MCP 与 LangGraph 集成

将 MCP Server 的工具动态注入 LangGraph Agent：

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';

// 1. 通过 MCP Client 获取工具
const mcpClient = new Client({ name: 'my-agent', version: '1.0.0' });
await mcpClient.connect(transport);

// 2. 将 MCP 工具转为 LangChain Tool 格式
const mcpTools = await loadMcpTools(mcpClient);

// 3. 注入 Agent（和 Phase 3 用法一致！）
const agent = createReactAgent({
  llm: model,
  tools: [...localTools, ...mcpTools],  // 本地工具 + MCP 远程工具
  checkpointer: redisSaver,
});
```

### 6.7 MCP vs 直接 Tool Calling

| 维度 | 直接 Tool Calling | MCP |
|---|---|---|
| 耦合度 | 工具和 Agent 绑死 | 工具和 Agent 解耦 |
| 发现方式 | 编译时确定 | 运行时动态发现 |
| 复用性 | 每个 Agent 单独绑定 | 同一 Server 给多个 Agent 用 |
| 维护成本 | 改工具要改 Agent 代码 | 改 Server 不影响 Agent |
| 适用规模 | 几个工具、1-2 个 Agent | 大量工具、多 Agent 系统 |

### 6.8 MCP 三大能力

MCP Server 不只提供工具，还有两种额外能力：

| 能力 | 作用 | 类比 |
|---|---|---|
| **Tools** | 可调用的函数 | Phase 2 的 tool() |
| **Resources** | 可读取的数据源 | Phase 4 的 RAG 文档 |
| **Prompts** | 可复用的提示词模板 | 预设 prompt 模板 |

## 练习项目

**将 Phase 2-5 的硬编码工具改造为 MCP Server**

1. 把 `searchTool`、`calculatorTool` 提取为独立的 MCP Server
2. Agent 通过 MCP Client 动态连接和发现工具
3. 多个 Agent（Phase 5 的 pm、architect 等）共享同一个 MCP Server
4. 体会：加工具不用改 Agent 代码，只需启动新的 MCP Server

## 学习资源

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [LangChain MCP Adapters](https://github.com/langchain-ai/langchain-mcp-adapters)
