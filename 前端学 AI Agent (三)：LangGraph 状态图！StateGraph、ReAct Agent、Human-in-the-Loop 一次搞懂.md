这个系列记录一个有 React + NestJS 经验的前端开发者，从零学习 AI Agent 的全过程。上一篇我们用 LangChain.js 实现了 Tool Use 循环——AI 自己决定要不要调工具、调哪个、怎么调。这一篇进入 **Phase 3**——

**不再手写 Tool Use 的 while 循环，而是用 LangGraph 的 StateGraph 把 Agent 逻辑建模为"有状态的图"；用 createReactAgent 一行代码创建完整 Agent；用 RedisSaver 实现多轮对话持久化（Redis 生产级方案）；用 interruptBefore 让 AI 在执行敏感操作前"举手报告"。**

全文分为四个部分：

- **Part 1：LangGraph 状态图** —— 是什么、为什么、核心概念
- **Part 2：StateGraph** —— 手动构建 Agent 图的完整流程
- **Part 3：ReAct Agent** —— 一行代码创建 Agent + RedisSaver 持久化
- **Part 4：Human-in-the-Loop** —— 让 AI 学会"举手报告"

---

# Part 1：LangGraph 状态图

## 1.1 从 while 循环到状态图：为什么需要 LangGraph？

Phase 2 的 Tool Use 循环本质是一个 `for` 循环：

```plain
Phase 2（手写循环 · agent.service.ts）：
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    调用 LLM → 有 tool_calls？→ 执行工具 → 结果回传 → continue
                              → 没有 → 返回文本 → break
  }
```

能跑，但有几个痛点：

1. **不可恢复**：循环执行到一半如果服务重启，所有状态丢失，得从头来
2. **不可中断**：无法在某个步骤暂停等待人工确认（比如"AI 想发一封邮件，先让人看看内容对不对"）
3. **不可扩展**：想加一个"搜索结果需要人工审核再继续"的节点？得大改循环逻辑，if/else 越套越深
4. **不可视化**：循环里的执行路径是隐式的，看代码才能理解流程
5. **不可复用**：想把同一套逻辑用在不同场景？得复制粘贴整个循环

LangGraph 的解决方案是：**把 Agent 逻辑建模为一张图**。

```plain
Phase 3（LangGraph 状态图）：
  START → [agent] → shouldContinue? → [tools] → [agent]（循环）
                                    → END（结束）

  每个节点独立，边决定走向，状态自动持久化。
```

**做的事完全一样，但表达方式从"循环控制"变成了"图结构"。**

| 特性 | Phase 2 手写循环 | Phase 3 LangGraph |
|------|-----------------|-------------------|
| 执行流程 | 隐式（写在循环里） | 显式（图结构，看 addEdge 就懂） |
| 循环支持 | 手动 for/while | Edge 自动回环 |
| 状态管理 | 手动维护 messages 数组 | Annotation + reducer 自动合并 |
| 持久化 | 不支持 | RedisSaver（Redis 持久化） |
| 中断恢复 | 不支持 | interruptBefore + checkpointer |
| 多 Agent | 不支持 | 子图原生支持 |
| 可视化 | 不支持 | 图结构天然支持可视化 |

### 安装

```bash
npm install @langchain/langgraph @langchain/langgraph-checkpoint-redis
```

LangGraph 依赖 `@langchain/core`（Phase 2 已安装），不需要额外装。`@langchain/langgraph-checkpoint-redis` 提供 Redis 持久化的 Checkpointer（RedisSaver）。

### 包结构

```
@langchain/langgraph                    - 核心：StateGraph, Annotation, START, END
@langchain/langgraph/prebuilt           - 预构建：createReactAgent（开箱即用的 ReAct Agent）
@langchain/langgraph-checkpoint-redis   - Redis 检查点存储：RedisSaver（生产级持久化）
```

## 1.2 核心概念：State + Node + Edge

LangGraph 的核心思想是三个词：**State（状态）、Node（节点）、Edge（边）**。

```plain
State：图中所有节点共享的数据结构（类似 Redux Store）
  ↓ 传入
Node：执行逻辑的函数（调用 LLM、执行工具、处理数据...）
  ↓ 更新 State
Edge：节点间的连接，决定"下一步走哪"
  ↓ 路由
下一个 Node...
```

### State（状态）

State 是图中所有节点**共享**的数据结构。你可以把它理解成一个全局可访问的对象，每个节点都能读取和写入。

在对话系统中，State 最核心的字段就是 `messages` —— 完整的对话消息列表。

```typescript
// State 长这样：
{
  messages: [
    HumanMessage("北京天气怎么样？"),
    AIMessage({ tool_calls: [{ name: "get_weather", args: { city: "北京" } }] }),
    ToolMessage("北京：晴，28°C"),
    AIMessage("北京今天天气不错，晴天，温度 28°C...")
  ]
}
```

State 的关键特性是 **reducer**——它定义了"当多个节点写入同一字段时如何合并"。这个概念和 Redux 的 reducer 完全一样：

```plain
不用 reducer（默认行为 = 覆盖）：
  agent 返回 { messages: [A] }  → state.messages = [A]     ← 覆盖！
  tools 返回 { messages: [B] }  → state.messages = [B]     ← A 丢了！

用 reducer（追加策略）：
  初始:                          → state.messages = []
  agent 返回 { messages: [A] }  → state.messages = [A]     ← append
  tools 返回 { messages: [B] }  → state.messages = [A, B]  ← append
  agent 返回 { messages: [C] }  → state.messages = [A, B, C]
```

对话系统**几乎都用追加策略**，因为你需要保留完整的消息历史。

### Node（节点）

节点就是**普通的 async 函数**。输入是当前 State，输出是 State 的部分更新（会通过 reducer 合并到全局 State）。

```plain
节点函数的签名：
  (state: State) => Partial<State>

例如 agent 节点：
  输入: state = { messages: [HumanMessage("你好")] }
  处理: 调用 LLM
  输出: { messages: [AIMessage("你好！")] }  ← reducer 会追加到 state.messages
```

和 Phase 2 的区别：Phase 2 把"调 LLM"和"执行工具"混在一个 for 循环里。Phase 3 把它们拆成独立的节点，**各管各的**。agent 节点只管调 LLM，tools 节点只管执行工具。

### Edge（边）

边决定了节点间的执行顺序。LangGraph 有三种边：

```plain
1. 固定边（addEdge）：
   addEdge(START, 'agent')     → 图的入口一定走 agent
   addEdge('tools', 'agent')   → tools 执行完一定走 agent

2. 条件边（addConditionalEdges）：
   addConditionalEdges('agent', shouldContinue, {
     continue: 'tools',        → shouldContinue 返回 'continue' → 走 tools
     end: END,                 → shouldContinue 返回 'end' → 结束
   })

3. 入口/出口：
   START  → 图开始的虚拟节点
   END    → 图结束的虚拟节点
```

条件边就是 Phase 2 中 `if (response.tool_calls?.length > 0) continue; else break;` 的图结构版本。

### 用一张图看它们的关系

```plain
                        State: { messages: [...] }
                              │
                    ┌─────────┴─────────┐
                    ↓                   ↓
               ┌─────────┐        ┌─────────┐
  START ──────→│  agent   │───────→│  tools   │
               │ (调用LLM) │←──────│ (执行工具) │
               └─────────┘  Edge  └─────────┘
                    │
                    │ 条件路由：没有 tool_calls
                    ↓
                   END
```

## 1.3 LangGraph 和 Phase 2 的关系

**LangGraph 不替代 LangChain，而是建立在 LangChain 之上**。Phase 3 复用了 Phase 2 的所有基础设施：

```plain
Phase 2（LangChain 层）：
  ├── LangChainService     → ChatOpenAI 模型封装
  ├── tools/               → 三个工具定义（天气、时间、搜索）
  └── agent.service.ts     → 手写 Tool Use 循环

Phase 3（LangGraph 层）：
  ├── 复用 LangChainService → 获取模型实例
  ├── 复用 tools/           → 工具不用重新定义
  └── langgraph.service.ts → 用图结构替代手写循环
```

工具在 Phase 2 中已经用 LangChain 的 `tool()` + Zod 定义好了。LangGraph 不关心工具怎么定义，只要是符合 LangChain tool 规范的对象就行。这也是分层设计的好处——**工具层（Phase 2）和编排层（Phase 3）完全解耦**。

## 1.4 项目结构

在 Phase 2 的基础上新增 `langgraph/` 模块：

> 新增依赖 `@langchain/langgraph-checkpoint-redis`，用于 Redis 持久化检查点存储（RedisSaver）。

```
server/src/
├── llm/                       # Phase 1（保留）
├── chat/                      # Phase 1（保留）
├── langchain/                 # Phase 2（保留）
│   ├── langchain.service.ts   # ChatOpenAI 封装
│   └── tools/                 # 三个工具（Phase 3 复用）
├── agent/                     # Phase 2（保留）
└── langgraph/                 # Phase 3 🆕
    ├── langgraph.module.ts    # NestJS 模块注册
    ├── langgraph.controller.ts # 4 个 API 端点
    ├── langgraph.service.ts   # 核心：StateGraph + ReAct + HiTL
    └── dto/
        └── langgraph-request.dto.ts  # 请求 DTO
```

三个阶段的模块并存：

```
AppModule
├── ChatModule → LlmModule（Phase 1：原始 OpenAI SDK）
├── AgentModule → LangChainModule（Phase 2：LangChain.js + 手写 Tool Use）
└── LangGraphModule → LangChainModule（Phase 3：LangGraph 状态图）
```

模块注册：

```typescript
// src/langgraph/langgraph.module.ts
@Module({
  imports: [LangChainModule],  // 复用 Phase 2 的 LangChainService
  controllers: [LangGraphController],
  providers: [LangGraphService],
})
export class LangGraphModule {}

// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,       // Phase 1
    AgentModule,      // Phase 2
    LangGraphModule,  // Phase 3 🆕
  ],
})
export class AppModule {}
```

环境变量配置（`.env`）：

```
# Redis 配置
REDIS_URL=redis://localhost:6379
```

本地开发需要启动 **Redis 8.0+**（内置 RedisJSON + RediSearch 模块），或 Redis Stack。以下提供两种安装方式：

### 方式一：Docker 安装（推荐）

**安装前提**：已安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

```bash
# 拉取并启动 Redis 8（后台运行，映射 6379 端口）
docker run -d --name redis -p 6379:6379 redis:8-alpine

# 验证 Redis 是否正常运行
docker exec redis redis-server --version
# 输出类似：Redis server v=8.0.x ...

# 测试连接
docker exec redis redis-cli ping
# 输出：PONG
```

日常使用：

```bash
# 启动（如果容器已停止）
docker start redis

# 停止（保留数据，下次 start 可恢复）
docker stop redis

# 彻底删除容器和数据（重新来过）
docker rm -f redis

# 查看 Redis 运行状态
docker ps | grep redis

# 查看 Redis 日志
docker logs redis
```

### 方式二：本地安装 Redis Stack

macOS 通过 Homebrew 安装 Redis Stack（包含 RedisJSON + RediSearch 模块）：

```bash
# 安装
brew tap redis-stack/redis-stack
brew install redis-stack

# 启动
redis-stack-server

# 验证（另开一个终端）
redis-cli ping
# 输出：PONG

# 停止（在启动的终端按 Ctrl+C）
```

> **注意**：通过 `brew install redis` 安装的是标准 Redis，版本可能低于 8.0 且不包含 RedisJSON/RediSearch 模块，无法满足 `RedisSaver` 的要求。请使用 `redis-stack` 或 Docker 方式。

Linux 安装参考 [Redis Stack 官方文档](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/)。

## 1.5 SSE 事件格式

Phase 3 的 SSE 事件在 Phase 2 的基础上新增了两种类型：

```plain
Phase 2 事件：
  tool_call   → AI 决定调用工具（工具名 + 参数）
  tool_result → 工具执行结果
  content     → AI 的最终文本回答
  done        → 流结束
  error       → 出错

Phase 3 新增：
  node        → 🆕 当前正在执行的图节点（agent / tools），前端可据此高亮执行路径
  interrupt   → 🆕 Human-in-the-Loop 中断，通知前端 Agent 已暂停等待确认
```

完整的 SSE 事件类型定义：

```typescript
// src/langgraph/langgraph.service.ts
export interface LangGraphEvent {
  type: 'node' | 'tool_call' | 'tool_result' | 'content' | 'interrupt' | 'done' | 'error';
  node?: string;            // type=node 时：当前节点名（"agent" | "tools"）
  name?: string;            // type=tool_call 时：工具名称
  args?: Record<string, unknown>; // type=tool_call 时：工具调用参数
  id?: string;              // type=tool_call/tool_result 时：调用 ID（前端匹配用）
  result?: string;          // type=tool_result 时：工具返回结果
  content?: string;         // type=content 时：LLM 文本回答；type=interrupt 时：中断提示
  error?: string;           // type=error 时：错误信息
  interruptValue?: unknown; // type=interrupt 时：额外的中断上下文数据
}
```

**事件流对比示例：**

```plain
Phase 2（Tool Use - 查天气）：
  data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"}}
  data: {"type":"tool_result","name":"get_weather","result":"北京：晴..."}
  data: {"type":"content","content":"北京今天天气不错..."}
  data: {"type":"done"}

Phase 3（LangGraph - 查天气）：
  data: {"type":"node","node":"agent"}                          ← 🆕 进入 agent 节点
  data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"}}
  data: {"type":"node","node":"tools"}                          ← 🆕 进入 tools 节点
  data: {"type":"tool_result","result":"北京：晴..."}
  data: {"type":"node","node":"agent"}                          ← 🆕 回到 agent 节点
  data: {"type":"content","content":"北京今天天气不错..."}
  data: {"type":"done"}

Phase 3（Human-in-the-Loop - 查天气）：
  data: {"type":"node","node":"agent"}
  data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"}}
  data: {"type":"interrupt","content":"⏸️ 等待人工确认..."}      ← 🆕 中断！
  （等待用户确认后恢复）
```

---

# Part 2：StateGraph —— 手动构建 Agent 图

这是教学价值最高的部分——完整展示了 LangGraph 的六个步骤，帮助理解图的每个组成部分。

## 2.1 六步构建法概览

```plain
Step 1: 定义 State（Annotation + reducer）
Step 2: 定义节点函数（agent / tools）
Step 3: 定义条件路由（shouldContinue）
Step 4: 构建图（addNode + addEdge + addConditionalEdges）
Step 5: 编译图（compile + checkpointer）
Step 6: 流式执行（stream + 解析事件）
```

最终构建的图结构：

```plain
START → [agent] → shouldContinue? ──→ [tools] → [agent]（循环）
                                  └→ END（结束）
```

这和 Phase 2 的 for 循环做的事完全一样：
- agent 节点 = 循环体中的 `modelWithTools.invoke()`
- tools 节点 = 循环体中的 `for (const toolCall of response.tool_calls)`
- shouldContinue = 循环体中的 `if (response.tool_calls?.length > 0) continue; else break;`
- `addEdge('tools', 'agent')` = 循环的 `continue` 语句

但图结构版本更清晰、可扩展、且自动支持持久化和中断恢复。

## 2.2 Step 1：定义 State（Annotation）

State 是图中所有节点共享的数据结构。用 `Annotation.Root()` 定义：

```typescript
// src/langgraph/langgraph.service.ts
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // reducer：定义多个节点写入同一字段时如何合并
    // 这里用追加策略：新消息 append 到数组末尾
    reducer: (current, update) => [...current, ...update],
  }),
});
```

**`Annotation.Root()` 做了什么？**

1. **定义 State 的 TypeScript 类型**：`AgentState.State` 就是 `{ messages: BaseMessage[] }`
2. **注册 reducer**：告诉 LangGraph 当多个节点返回 `{ messages: [...] }` 时怎么合并
3. **生成 schema**：供 `new StateGraph(AgentState)` 使用

**reducer 的执行过程（以一次查天气为例）：**

```plain
初始 State:
  { messages: [] }

用户发送消息，graph.stream({ messages: [HumanMessage("北京天气")] })：
  reducer: [...[], HumanMessage("北京天气")]
  → { messages: [HumanMessage("北京天气")] }

agent 节点返回 { messages: [AIMessage(tool_calls: [...])] }：
  reducer: [...[HumanMessage], AIMessage]
  → { messages: [HumanMessage, AIMessage] }

tools 节点返回 { messages: [ToolMessage("晴天 28°C")] }：
  reducer: [...[HumanMessage, AIMessage], ToolMessage]
  → { messages: [HumanMessage, AIMessage, ToolMessage] }

agent 节点返回 { messages: [AIMessage("北京今天天气不错")] }：
  reducer: [...[HumanMessage, AIMessage, ToolMessage], AIMessage]
  → { messages: [HumanMessage, AIMessage, ToolMessage, AIMessage] }
```

如果你的 State 不只有 `messages`，也可以加更多字段：

```typescript
// 扩展 State 示例（本项目没用到，但展示灵活性）
const ExtendedState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],  // 追加策略
  }),
  toolCallCount: Annotation<number>({
    reducer: (current, update) => current + update,         // 累加策略
  }),
  lastToolName: Annotation<string>(),                       // 无 reducer = 覆盖策略
});
```

## 2.3 Step 2：定义节点函数（Node）

节点就是普通函数，接收 State，返回 State 的部分更新。

### agent 节点：调用 LLM

```typescript
// src/langgraph/langgraph.service.ts

// 先绑定工具到模型——和 Phase 2 的 agent.service.ts 完全一样
// bindTools 不是执行工具，而是"告诉模型有哪些工具可用"
const modelWithTools = model.bindTools(this.tools);

// agent 节点：职责单一——把当前所有消息发给 LLM，拿回回复
const callModel = async (
  state: typeof AgentState.State,  // 输入：当前 State
  config?: RunnableConfig,         // 运行时配置（含 thread_id 等）
) => {
  this.logger.log('Node [agent]: calling LLM...');
  const response = await modelWithTools.invoke(state.messages, config);
  // 返回 { messages: [response] }
  // reducer 会将 response 追加到 state.messages
  return { messages: [response] };
};
```

LLM 可能返回两种结果：
1. **带 `tool_calls`**：LLM 认为需要调用工具 → `shouldContinue` 路由到 tools 节点
2. **不带 `tool_calls`**：LLM 直接给出文本回答 → `shouldContinue` 路由到 END

### tools 节点：执行工具调用

```typescript
// src/langgraph/langgraph.service.ts

const callTools = async (state: typeof AgentState.State) => {
  // 最后一条消息一定是 AIMessage（因为 tools 节点只在 agent 之后执行）
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolMessages: ToolMessage[] = [];

  // 遍历 AIMessage 中的每个工具调用请求
  for (const toolCall of lastMessage.tool_calls || []) {
    this.logger.log(`Node [tools]: executing ${toolCall.name}`);
    const toolFn = this.toolMap[toolCall.name];  // 从映射表查找工具实例
    let result: string;

    if (toolFn) {
      try {
        // invoke 调用实际的工具函数（比如 fetch wttr.in API）
        result = await (toolFn as any).invoke(toolCall.args);
      } catch (error) {
        // 工具执行出错时返回错误信息（而不是抛异常）
        // 让 LLM 自己决定怎么处理错误
        result = `工具执行出错: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      result = `未知工具: ${toolCall.name}`;
    }

    // ToolMessage 必须携带 tool_call_id
    // 和 AIMessage 中的 toolCall.id 对应
    // 这样 LLM 才知道"这个结果是哪次工具调用的返回值"
    toolMessages.push(
      new ToolMessage({
        content: result,
        tool_call_id: toolCall.id || '',
      }),
    );
  }

  // 返回所有工具结果，reducer 会追加到 state.messages
  return { messages: toolMessages };
};
```

**对比 Phase 2 的 `agent.service.ts`，逻辑基本一样，但有两个关键区别：**

1. **节点只关心自己的事**：`callModel` 只管调 LLM，`callTools` 只管执行工具。不用在一个函数里处理所有逻辑
2. **状态更新是声明式的**：返回 `{ messages: [...] }` 就行，reducer 自动帮你合并到全局 State。不用手动 `messages.push()`

### 工具映射表

`callTools` 中的 `this.toolMap` 是一个工具名 → 工具实例的映射：

```typescript
// src/langgraph/langgraph.service.ts

// 所有可用工具——直接复用 Phase 2 定义的三个工具
private tools = [weatherTool, timeTool, searchTool];

// 工具名 → 工具实例的映射表
// LLM 返回 tool_calls: [{ name: "get_weather", ... }]
// 我们需要根据 "get_weather" 找到对应的 weatherTool 来执行
private toolMap: Record<string, (typeof this.tools)[number]> = Object.fromEntries(
  this.tools.map((t) => [t.name, t]),
);
// 结果：{ "get_weather": weatherTool, "get_current_time": timeTool, "web_search": searchTool }
```

## 2.4 Step 3：定义条件路由（Conditional Edge）

条件路由函数根据当前 State 返回一个字符串，表示"下一步走哪条边"：

```typescript
// src/langgraph/langgraph.service.ts

const shouldContinue = (state: typeof AgentState.State) => {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'continue';  // 有工具调用 → 走 "continue" 边 → 去 tools 节点
  }
  return 'end';  // 无工具调用 → 走 "end" 边 → 去 END（图结束）
};
```

返回值必须和 `addConditionalEdges` 中的 key 匹配：

```typescript
.addConditionalEdges('agent', shouldContinue, {
  continue: 'tools',   // shouldContinue 返回 'continue' → 走到 tools
  end: END,            // shouldContinue 返回 'end' → 走到 END
})
```

这就是 Phase 2 中 `if (response.tool_calls?.length > 0) continue; else break;` 的图结构版本。逻辑完全一样，但表达方式从"循环控制"变成了"路由决策"。

## 2.5 Step 4：构建图（组装）

把 State、Node、Edge 组装成一张完整的图：

```typescript
// src/langgraph/langgraph.service.ts

const graph = new StateGraph(AgentState)     // 传入 State 类型
  .addNode('agent', callModel)               // 注册 agent 节点
  .addNode('tools', callTools)               // 注册 tools 节点
  .addEdge(START, 'agent')                   // 入口：START → agent
  .addConditionalEdges('agent', shouldContinue, {
    continue: 'tools',                       // 有工具调用 → tools
    end: END,                                // 无工具调用 → 结束
  })
  .addEdge('tools', 'agent');                // tools 执行完 → 回到 agent（形成循环）
```

**这段代码的可读性就是 LangGraph 的核心优势**——看这 6 行就能理解整个 Agent 的执行流程，不用去读循环里的 if/else。

**对比 Phase 2，同样的逻辑，不同的表达：**

```plain
Phase 2（agent.service.ts）：

  for (let i = 0; i < 10; i++) {        // ← 循环
    const response = await model.invoke(messages);
    if (response.tool_calls?.length) {   // ← 条件判断
      for (const tc of response.tool_calls) {
        const result = await tool.invoke(tc.args);
        messages.push(new ToolMessage(result));
      }
      continue;                          // ← 循环控制
    }
    yield { type: 'content', content };
    break;                               // ← 循环退出
  }

Phase 3（langgraph.service.ts）：

  graph
    .addNode('agent', callModel)         // ← 节点：各管各的
    .addNode('tools', callTools)
    .addEdge(START, 'agent')             // ← 入口
    .addConditionalEdges('agent',        // ← 条件路由
      shouldContinue, {
        continue: 'tools',
        end: END,
      })
    .addEdge('tools', 'agent');          // ← 循环回边
```

**做的事情一模一样，但 LangGraph 的版本**：
- 执行流程一目了然（看 addEdge 就知道怎么走）
- 加节点只需 addNode + addEdge（不用改循环逻辑）
- 自动支持持久化（传 checkpointer）
- 自动支持中断恢复（加 interruptBefore）

## 2.6 Step 5：编译图（compile）

`compile()` 把图定义"编译"成可执行的实例，类似 webpack build：

```typescript
// src/langgraph/langgraph.service.ts

const app = graph.compile({
  checkpointer: this.checkpointer,  // 传入检查点存储器（RedisSaver），启用持久化
});
```

编译后得到的 `app` 具备三个核心方法：
- **`app.invoke()`**：一次性执行完返回最终 State
- **`app.stream()`**：流式执行，每个节点完成时 yield 一次
- **`app.getState()`**：获取当前状态（配合 checkpointer 使用）

**传入 `checkpointer` 启用持久化，三个效果：**
1. 每步执行后自动保存 State 快照
2. 同一个 `thread_id` 的请求能读取上次的 State（多轮对话）
3. 支持中断恢复（Human-in-the-Loop 的前提条件）

```typescript
// Checkpointer 是类成员变量，所有方法共享同一个实例
// 在 onModuleInit 中异步初始化
private checkpointer!: RedisSaver;

async onModuleInit() {
  const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
  this.checkpointer = RedisSaver.fromConnString(redisUrl);
  await this.checkpointer.setup();
}
```

`RedisSaver` 来自 `@langchain/langgraph-checkpoint-redis`，需要 Redis 8.0+（内置 RedisJSON + RediSearch 模块）或 Redis Stack。通过 `onModuleInit` 生命周期钩子进行异步初始化，确保服务启动时 Redis 连接已就绪。

### 为什么用 RedisSaver 而不是 MemorySaver？

`MemorySaver` 是内存存储，仅适合本地快速测试——服务重启就丢失所有状态。我们的项目直接使用 `RedisSaver`，这是生产级方案：

```plain
MemorySaver（旧方案，仅本地测试）：
  ✅ 零配置，开箱即用
  ❌ 服务重启丢失所有状态
  ❌ 多实例部署时状态不共享

RedisSaver（本项目使用，生产就绪）：
  ✅ 状态持久化，服务重启不丢失
  ✅ 多实例部署可共享状态
  ✅ 高性能，亚毫秒级读写
  ❌ 需要 Redis 8.0+（或 Redis Stack）
```

## 2.7 Step 6：流式执行（stream）

构建初始消息列表，启动流式执行：

```typescript
// src/langgraph/langgraph.service.ts

// 构建初始消息列表——和 Phase 2 的 agent.service.ts 一样
const messages: BaseMessage[] = [];
if (systemPrompt) {
  messages.push(new SystemMessage(systemPrompt));
}
for (const msg of history) {
  if (msg.role === 'user') messages.push(new HumanMessage(msg.content));
  else if (msg.role === 'assistant') messages.push(new AIMessage(msg.content));
}
messages.push(new HumanMessage(message));

// config 中的 thread_id 是 checkpointer 的"会话 ID"
// 同一个 thread_id → 共享 State（多轮对话）
// 不同 thread_id → 互相隔离
const config = {
  configurable: { thread_id: threadId || `thread-${Date.now()}` },
};

// 开始流式执行
const stream = await app.stream({ messages }, config);
```

### stream 事件格式

`stream()` 返回一个 AsyncIterator，每个节点执行完后 yield 一次。每次 yield 的格式：

```plain
{ [节点名]: { messages: BaseMessage[] } }

例如：
  第 1 次 yield: { agent: { messages: [AIMessage(tool_calls: [...])] } }
  第 2 次 yield: { tools: { messages: [ToolMessage("北京：晴，28°C...")] } }
  第 3 次 yield: { agent: { messages: [AIMessage("北京今天天气不错...")] } }
```

### 解析事件并 yield 给前端

```typescript
// src/langgraph/langgraph.service.ts

for await (const event of stream) {
  for (const [nodeName, output] of Object.entries(event)) {
    // 告诉前端"当前正在执行哪个节点"
    yield { type: 'node', node: nodeName };

    const nodeOutput = output as { messages: BaseMessage[] };
    if (!nodeOutput.messages) continue;

    for (const msg of nodeOutput.messages) {
      if (msg instanceof AIMessage) {
        // AIMessage 有两种情况：
        // 1. 带 tool_calls → LLM 想调用工具
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            yield {
              type: 'tool_call',
              name: tc.name,
              args: tc.args as Record<string, unknown>,
              id: tc.id,
            };
          }
        }
        // 2. 带 content → LLM 的最终文本回答
        if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
          yield { type: 'content', content: msg.content };
        }
      } else if (msg instanceof ToolMessage) {
        // ToolMessage → 工具执行结果
        yield {
          type: 'tool_result',
          result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          id: msg.tool_call_id,
        };
      }
    }
  }
}

yield { type: 'done' };
```

## 2.8 完整执行链路（以"北京天气怎么样？"为例）

```plain
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 用户发送请求                                                       │
│                                                                      │
│    POST /langgraph/chat                                              │
│    { message: "北京天气怎么样？", threadId: "thread-001" }              │
│                                                                      │
│    LangGraphController.stateGraphChat()                              │
│      ├── setupSSE(res)  ← 设置 SSE 响应头                              │
│      └── langGraphService.chatWithStateGraph(...)                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌──────────────────────────────┴──────────────────────────────────────┐
│ 2. 构建图并执行                                                       │
│                                                                      │
│    chatWithStateGraph()                                              │
│      ├── Annotation.Root({ messages: ... })        ← 定义 State      │
│      ├── model.bindTools(tools)                    ← 绑定工具         │
│      ├── new StateGraph(AgentState)                                  │
│      │     .addNode('agent', callModel)                              │
│      │     .addNode('tools', callTools)                              │
│      │     .addEdge(START, 'agent')                                  │
│      │     .addConditionalEdges(...)                                 │
│      │     .addEdge('tools', 'agent')                                │
│      ├── graph.compile({ checkpointer })           ← 编译            │
│      └── app.stream({ messages }, config)          ← 流式执行         │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ stream 第 1 次 yield
┌──────────────────────────────┴──────────────────────────────────────┐
│ 3. agent 节点执行（第 1 次迭代）                                        │
│                                                                      │
│    callModel(state)                                                  │
│      ├── state.messages = [HumanMessage("北京天气怎么样？")]             │
│      ├── modelWithTools.invoke(state.messages)                       │
│      │     ↓ HTTP 请求到 LLM API                                      │
│      │     ↓ LLM 返回: AIMessage({                                    │
│      │     ↓   tool_calls: [{ name: "get_weather",                   │
│      │     ↓                  args: { city: "北京" },                  │
│      │     ↓                  id: "call_xxx" }]                      │
│      │     ↓ })                                                      │
│      └── return { messages: [response] }                             │
│                                                                      │
│    shouldContinue(state) → 有 tool_calls → 返回 'continue' → tools   │
│                                                                      │
│    [SSE] data: {"type":"node","node":"agent"}                        │
│    [SSE] data: {"type":"tool_call","name":"get_weather",             │
│                 "args":{"city":"北京"},"id":"call_xxx"}               │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ stream 第 2 次 yield
┌──────────────────────────────┴──────────────────────────────────────┐
│ 4. tools 节点执行                                                     │
│                                                                      │
│    callTools(state)                                                  │
│      ├── lastMessage.tool_calls → [{ name: "get_weather", ... }]     │
│      ├── weatherTool.invoke({ city: "北京" })                         │
│      │     ↓ fetch("https://wttr.in/北京?format=j1")                 │
│      │     ↓ 返回: "北京当前天气：晴，温度：28°C，湿度 45%..."            │
│      └── return { messages: [ToolMessage(...)] }                     │
│                                                                      │
│    addEdge('tools', 'agent') → 回到 agent 节点                        │
│                                                                      │
│    [SSE] data: {"type":"node","node":"tools"}                        │
│    [SSE] data: {"type":"tool_result","result":"北京当前天气：晴..."}    │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ stream 第 3 次 yield
┌──────────────────────────────┴──────────────────────────────────────┐
│ 5. agent 节点执行（第 2 次迭代）                                        │
│                                                                      │
│    callModel(state)                                                  │
│      ├── state.messages = [HumanMessage, AIMessage(tool_calls),      │
│      │                     ToolMessage("晴，28°C...")]               │
│      ├── modelWithTools.invoke(state.messages)                       │
│      │     ↓ LLM 看到工具结果后，不再调工具                              │
│      │     ↓ 返回: AIMessage({ content: "北京今天天气不错..." })        │
│      └── return { messages: [response] }                             │
│                                                                      │
│    shouldContinue(state) → 无 tool_calls → 返回 'end' → END          │
│                                                                      │
│    [SSE] data: {"type":"node","node":"agent"}                        │
│    [SSE] data: {"type":"content","content":"北京今天天气不错..."}       │
│    [SSE] data: {"type":"done"}                                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌──────────────────────────────┴──────────────────────────────────────┐
│ 6. Controller 关闭连接                                                │
│                                                                      │
│    for await 循环结束 → res.end()                                     │
│    checkpointer 已保存完整 State，下次同一 threadId 可继续对话           │
└─────────────────────────────────────────────────────────────────────┘
```

## 2.9 Controller 层

```typescript
// src/langgraph/langgraph.controller.ts

@Post('chat')
@SkipTransform()
@HttpCode(HttpStatus.OK)
async stateGraphChat(@Body() body: LangGraphRequestDto, @Res() res: Response) {
  const { message, threadId, history, systemPrompt } = body;
  this.setupSSE(res);  // 设置 SSE 响应头

  try {
    const stream = this.langGraphService.chatWithStateGraph(
      message, threadId, history, systemPrompt,
    );
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);  // SSE 格式
    }
  } catch (error) {
    this.writeError(res, error);
  } finally {
    res.end();
  }
}

// SSE 响应头设置——和 Phase 1、Phase 2 完全一样
private setupSSE(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}
```

### DTO 设计

```typescript
// src/langgraph/dto/langgraph-request.dto.ts

export class LangGraphRequestDto {
  @IsString()
  @IsNotEmpty()
  message: string;              // 用户消息

  @IsOptional()
  @IsString()
  threadId?: string;            // 🆕 线程 ID（多轮对话 + HiTL 恢复）

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  history?: MessageDto[];       // 对话历史

  @IsOptional()
  @IsString()
  systemPrompt?: string;        // 系统提示词
}
```

相比 Phase 2 的 `AgentRequestDto`，多了 `threadId` 字段——这是 checkpointer 的"会话 ID"，也是 Human-in-the-Loop 恢复执行的关键。

## 2.10 测试

```bash
# 测试 StateGraph Agent
curl -X POST http://localhost:3500/langgraph/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "北京今天天气怎么样？", "threadId": "test-001"}'
```

预期输出：

```
data: {"type":"node","node":"agent"}
data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"},"id":"call_xxx"}
data: {"type":"node","node":"tools"}
data: {"type":"tool_result","result":"北京当前天气：晴，温度：28°C...","id":"call_xxx"}
data: {"type":"node","node":"agent"}
data: {"type":"content","content":"北京今天天气晴朗，温度 28°C..."}
data: {"type":"done"}
```

---

# Part 3：ReAct Agent —— 一行代码创建 Agent

## 3.1 为什么需要 createReactAgent？

手写 StateGraph 很有教育价值，但日常开发中，**标准的 ReAct 模式（推理 → 行动 → 观察 → 推理...）不需要每次都从零搭图**。LangGraph 提供了预构建的 `createReactAgent`，帮你省去所有样板代码。

### 什么是 ReAct？

ReAct（Reasoning + Acting）是 2022 年提出的 Agent 模式：

```plain
ReAct 循环：
  1. Reasoning（推理）：LLM 分析问题，决定需要什么信息
  2. Acting（行动）：调用工具获取信息
  3. Observing（观察）：查看工具返回的结果
  4. 回到 1，直到 LLM 认为信息足够，给出最终回答

例如：
  用户: "对比北京和上海的天气"
  → [Reasoning] 需要查两个城市的天气
  → [Acting]    调用 get_weather("北京")
  → [Observing] 北京：晴，28°C
  → [Reasoning] 还需要上海的
  → [Acting]    调用 get_weather("上海")
  → [Observing] 上海：阴，24°C
  → [Reasoning] 两个城市的天气都有了，可以回答了
  → "北京晴天 28°C，上海阴天 24°C，北京比上海暖和一些..."
```

我们在 Part 2 手写的 StateGraph 就是一个 ReAct Agent——`agent` 节点负责推理，`tools` 节点负责行动，循环就是 ReAct 的核心。

## 3.2 createReactAgent 用法

```typescript
// src/langgraph/langgraph.service.ts
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const agent = createReactAgent({
  llm: model,                              // 模型实例（ChatOpenAI）
  tools: this.tools,                       // 工具数组（自动 bindTools）
  ...(systemPrompt ? { prompt: systemPrompt } : {}),  // 可选：系统提示词
  checkpointSaver: this.checkpointer,      // 可选：检查点存储
});
```

**一行代码，等效于 Part 2 手写的整个 StateGraph。**

`createReactAgent` 内部自动构建了和手写完全相同的图结构：

```plain
createReactAgent 内部结构：
  ┌─────────────────────────────────────┐
  │ Annotation.Root({ messages })       │  ← 自动定义 State
  │ addNode('agent', callModel)         │  ← 自动创建 agent 节点
  │ addNode('tools', callTools)         │  ← 自动创建 tools 节点
  │ addEdge(START, 'agent')             │  ← 自动设置入口
  │ addConditionalEdges(...)            │  ← 自动设置条件路由
  │ addEdge('tools', 'agent')           │  ← 自动设置循环回边
  │ compile({ checkpointer })           │  ← 自动编译
  └─────────────────────────────────────┘

  结果图：
  START → agent → shouldContinue → tools → agent（循环）
                                → END
```

### createReactAgent 的配置项

```typescript
createReactAgent({
  llm: model,              // 必填：LLM 模型
  tools: [...],            // 必填：工具数组
  prompt: '...',           // 可选：system prompt（字符串形式，自动包装成 SystemMessage）
  checkpointSaver: ...,    // 可选：检查点存储（启用多轮对话）
  interruptBefore: [...],  // 可选：在哪些节点前中断（Part 4 用到）
  interruptAfter: [...],   // 可选：在哪些节点后中断
});
```

## 3.3 stream 用法

用法和手写 StateGraph 完全一样：

```typescript
// src/langgraph/langgraph.service.ts

const config = {
  configurable: { thread_id: threadId || `react-${Date.now()}` },
};

const stream = await agent.stream(
  { messages: [new HumanMessage(message)] },
  config,
);

// 事件格式也完全一样：{ [节点名]: { messages: BaseMessage[] } }
for await (const event of stream) {
  for (const [nodeName, output] of Object.entries(event)) {
    yield { type: 'node', node: nodeName };
    // ... 和 chatWithStateGraph 中的事件解析完全一样
  }
}

yield { type: 'done' };
```

因为 `createReactAgent` 内部构建的图结构就和手写的一样，所以 stream 返回的事件格式也一样。**前端不需要做任何区分**——无论后端用 StateGraph 还是 createReactAgent，前端收到的 SSE 事件完全相同。

## 3.4 什么时候用手写 StateGraph vs createReactAgent？

```plain
用 createReactAgent：
  ✅ 标准的 ReAct 模式（推理 → 行动 → 观察）
  ✅ 快速原型开发
  ✅ 不需要自定义图结构
  ✅ 大多数日常 Agent 需求

用手写 StateGraph：
  ✅ 需要在 agent 和 tools 之间插入额外节点（审核、日志、缓存等）
  ✅ 需要更复杂的条件路由（多分支，而不是简单的 continue/end）
  ✅ 需要子图嵌套（多 Agent 协作，Phase 5 会用到）
  ✅ 需要自定义 State schema（不止 messages 一个字段，比如加 step_count、current_plan 等）
  ✅ 需要非标准的执行流程（比如 agent → verifier → tools 三节点模式）
```

简单说：**先用 `createReactAgent`，不够用再切手写 `StateGraph`**。

## 3.5 RedisSaver：让 Agent 记住上下文（Redis 持久化）

Phase 2 的 Agent 是无状态的——每次请求都从零开始，不记得上一轮对话。Phase 3 通过 **Checkpointer（检查点存储器）** 机制解决这个问题。

### 核心原理

```plain
第 1 次请求（thread_id: "user-123"）：
  用户: "北京天气怎么样？"
  → Agent 调工具查天气，返回 "北京晴天 28°C"
  → Checkpointer 保存完整 State 到内存（以 thread_id 为 key）

  Checkpointer 快照：
  {
    "user-123": {
      messages: [
        HumanMessage("北京天气怎么样？"),
        AIMessage(tool_calls: [...]),
        ToolMessage("北京：晴天，28°C"),
        AIMessage("北京今天天气不错...")
      ]
    }
  }

第 2 次请求（同一个 thread_id: "user-123"）：
  用户: "那上海呢？"
  → Checkpointer 读取之前的 State（包含第 1 轮的完整对话）
  → Agent 看到上下文，知道"那"指的是"天气"
  → 调工具查上海天气，返回结果
  → Checkpointer 更新 State

第 3 次请求（不同的 thread_id: "user-456"）：
  用户: "东京呢？"
  → Checkpointer 找不到 "user-456" 的 State
  → Agent 不知道"东京呢？"的上下文，可能会问"您想了解东京的什么？"
  → 不同 thread_id 的状态完全隔离
```

### 使用方式

```typescript
// 创建 checkpointer（RedisSaver，在 onModuleInit 中异步初始化）
// this.checkpointer = RedisSaver.fromConnString(redisUrl);
// await this.checkpointer.setup();

// 方式一：手写 StateGraph 编译时传入
const app = graph.compile({ checkpointer: this.checkpointer });

// 方式二：createReactAgent 创建时传入
const agent = createReactAgent({
  llm: model,
  tools: this.tools,
  checkpointSaver: this.checkpointer,
});

// 每次请求指定 thread_id
const config = { configurable: { thread_id: 'user-123' } };
await app.stream({ messages: [...] }, config);
```

**`thread_id` 就是"对话 ID"**。同一个 `thread_id` 的请求共享 State，不同 `thread_id` 的请求互相隔离。

### Checkpointer 在类中的位置

```typescript
// src/langgraph/langgraph.service.ts

@Injectable()
export class LangGraphService implements OnModuleInit {
  // 用类成员变量持有单例
  // 所有方法（chatWithStateGraph、chatWithReactAgent、chatWithHumanInTheLoop、resumeExecution）
  // 共享同一个 checkpointer
  // 这样 HiTL 的"暂停 → 恢复"能找到之前的状态
  private checkpointer!: RedisSaver;

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.checkpointer = RedisSaver.fromConnString(redisUrl);
    await this.checkpointer.setup();
  }
}
```

本地开发需要启动 Redis 8.0+（内置 RedisJSON + RediSearch）或 Redis Stack，安装和启动方式详见 [1.4 节 Redis 安装指南](#14-环境准备)。

```bash
# Docker 快速启动（已安装 Docker 的话一行搞定）
docker run -d --name redis -p 6379:6379 redis:8-alpine

# 停止
docker stop redis

# 重新启动
docker start redis
```

并在 `.env` 中配置：

```
REDIS_URL=redis://localhost:6379
```

### 生产环境方案

本项目直接使用 `RedisSaver` 作为 Checkpointer，这已经是生产就绪的方案。`MemorySaver` 仅适合本地快速测试（零配置、无需外部依赖），但服务重启就丢失所有状态。

```plain
本项目方案：RedisSaver（@langchain/langgraph-checkpoint-redis）
  ✅ 持久化存储，服务重启不丢失
  ✅ 高性能，适合生产环境
  ✅ 多实例部署可共享状态
  ⚠️ 需要 Redis 8.0+（或 Redis Stack）

其他可选方案：
  - @langchain/langgraph-checkpoint-postgres（PostgreSQL）
  - @langchain/langgraph-checkpoint-sqlite（SQLite，轻量）
  - 自定义：实现 BaseCheckpointSaver 接口

仅本地测试用：
  - MemorySaver（内存，重启丢失，零配置）
```

## 3.6 Controller 层

```typescript
// src/langgraph/langgraph.controller.ts

@Post('react')
@SkipTransform()
@HttpCode(HttpStatus.OK)
async reactAgentChat(@Body() body: LangGraphRequestDto, @Res() res: Response) {
  const { message, threadId, systemPrompt } = body;
  this.setupSSE(res);

  try {
    const stream = this.langGraphService.chatWithReactAgent(
      message, threadId, systemPrompt,
    );
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    this.writeError(res, error);
  } finally {
    res.end();
  }
}
```

和 StateGraph 的 Controller 完全一样的模式——都是 SSE 流式响应。

## 3.7 测试

```bash
# 第一轮
curl -X POST http://localhost:3500/langgraph/react \
  -H "Content-Type: application/json" \
  -d '{"message": "北京天气怎么样？", "threadId": "memory-test"}'

# 第二轮（同一个 threadId，Agent 记住了上下文）
curl -X POST http://localhost:3500/langgraph/react \
  -H "Content-Type: application/json" \
  -d '{"message": "那上海呢？", "threadId": "memory-test"}'
```

第二轮 Agent 应该能理解"那"指的是"天气"，自动查询上海天气。这就是 RedisSaver + thread_id 的效果。

---

# Part 4：Human-in-the-Loop —— 让 AI 学会"举手报告"

## 4.1 为什么需要 Human-in-the-Loop？

这是 Phase 3 最实用的特性。在某些场景下，AI 不应该自己直接执行操作：

```plain
❌ AI 直接发邮件给客户（万一内容不对呢？）
❌ AI 直接修改数据库（万一改错了呢？）
❌ AI 直接调用付费 API（万一浪费钱呢？）
❌ AI 直接执行 shell 命令（万一 rm -rf 了呢？）

✅ AI 告诉你"我想做这件事"，你确认后再执行
```

Human-in-the-Loop（HiTL）让 Agent 在执行敏感操作前**自动暂停**，等人类确认后再继续。就像实习生执行重要操作前要先和导师确认一样。

## 4.2 核心机制：interruptBefore

LangGraph 通过 `interruptBefore` 实现 HiTL：在指定节点**执行前**自动暂停。

```typescript
// src/langgraph/langgraph.service.ts

// 构建与 Part 2 相同的 StateGraph，但在 compile 时加入 interruptBefore
const app = graph.compile({
  checkpointer: this.checkpointer,       // HiTL 必须有 checkpointer！
  // ⭐ 关键：在 tools 节点执行前中断
  interruptBefore: ['tools'],
});
```

**两个必要条件：**
1. **必须有 `checkpointer`**：没有它就无法保存暂停时的 State，也就无法恢复
2. **`interruptBefore` 指定在哪个节点前暂停**：这里是 `['tools']`，即工具执行前

**为什么是 `interruptBefore: ['tools']` 而不是别的？**

因为我们要审核的是"AI 要调用什么工具、用什么参数"。在 tools 节点执行前暂停，此时：
- `agent` 节点已经执行完了 → AIMessage 中已经有 `tool_calls`（工具名 + 参数）
- `tools` 节点还没执行 → 工具还没被真正调用

这正好是人工审核的最佳时机——你能看到 AI 要调什么工具、参数是什么，然后决定是否让它执行。

## 4.3 完整工作流程

```plain
┌─── 第一次请求：发送消息 ─────────────────────────────────────┐
│                                                               │
│  POST /langgraph/hitl { message: "北京天气怎么样？",           │
│                         threadId: "hitl-001" }                │
│    ↓                                                          │
│  [START] → [agent] → LLM 返回 tool_calls: [get_weather]      │
│    ↓                                                          │
│  即将进入 [tools] 节点 → interruptBefore 触发！⏸️ 冻结！        │
│    ↓                                                          │
│  ← SSE 事件流：                                                │
│     data: {"type":"node","node":"agent"}                      │
│     data: {"type":"tool_call","name":"get_weather",           │
│            "args":{"city":"北京"}}                             │
│     data: {"type":"interrupt",                                │
│            "content":"⏸️ Agent 想要执行工具调用，等待人工确认..."}│
│                                                               │
│  State 已存入 checkpointer（key: "hitl-001"），等待恢复         │
└───────────────────────────────────────────────────────────────┘
                         ↓ 用户在前端看到工具调用详情，点击"确认执行"
┌─── 第二次请求：恢复执行 ──────────────────────────────────────┐
│                                                               │
│  POST /langgraph/hitl/resume { threadId: "hitl-001" }         │
│    ↓                                                          │
│  从 checkpointer 读取 "hitl-001" 的 State 快照                 │
│  恢复到 tools 节点                                             │
│    ↓                                                          │
│  [tools] → 执行 get_weather("北京") → "北京：晴天，28°C"       │
│    ↓                                                          │
│  [agent] → LLM 看到天气结果，生成最终回答                       │
│    ↓                                                          │
│  ← SSE 事件流：                                                │
│     data: {"type":"node","node":"tools"}                      │
│     data: {"type":"tool_result","result":"北京：晴天，28°C..."} │
│     data: {"type":"node","node":"agent"}                      │
│     data: {"type":"content","content":"北京今天天气不错..."}     │
│     data: {"type":"done"}                                     │
└───────────────────────────────────────────────────────────────┘
```

**特殊情况：如果用户的问题不需要工具呢？**

```plain
POST /langgraph/hitl { message: "你好", threadId: "hitl-002" }
  ↓
[START] → [agent] → LLM 直接返回文本（没有 tool_calls）
  ↓
shouldContinue 返回 'end' → 直接走到 END，不会经过 tools 节点
  ↓
interruptBefore 没有触发（因为根本没走到 tools 节点）
  ↓
← SSE：
  data: {"type":"node","node":"agent"}
  data: {"type":"content","content":"你好！有什么可以帮助你的？"}
  data: {"type":"done"}

→ 正常结束，没有 interrupt。只有 AI 决定调用工具时才会暂停。
```

## 4.4 实现代码：chatWithHumanInTheLoop

```typescript
// src/langgraph/langgraph.service.ts

async *chatWithHumanInTheLoop(
  message: string,
  threadId: string,      // 必填！恢复执行时需要用同一个 threadId
  systemPrompt?: string,
): AsyncGenerator<LangGraphEvent> {
  // ⭐ 使用 buildHitlGraph() 私有方法构建带 interruptBefore 的 StateGraph
  // buildHitlGraph 内部构建与 Part 2 相同的 StateGraph，
  // 但在 compile 时加入 interruptBefore: ['tools']
  const app = this.buildHitlGraph(systemPrompt);

  const config = {
    configurable: { thread_id: threadId },
  };

  // 第一次执行：图会跑到 tools 节点前暂停
  // stream 会正常 yield agent 节点的输出（包含 tool_calls），然后结束
  const stream = await app.stream(
    { messages: [new HumanMessage(message)] },
    config,
  );

  // 消费流式事件（只会产出 agent 节点的输出）
  for await (const event of stream) {
    for (const [nodeName, output] of Object.entries(event)) {
      yield { type: 'node', node: nodeName };

      const nodeOutput = output as { messages: BaseMessage[] };
      if (!nodeOutput.messages) continue;

      for (const msg of nodeOutput.messages) {
        if (msg instanceof AIMessage) {
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              yield {
                type: 'tool_call',
                name: tc.name,
                args: tc.args as Record<string, unknown>,
                id: tc.id,
              };
            }
          }
          if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
            yield { type: 'content', content: msg.content };
          }
        }
        // 注意：这里不处理 ToolMessage，因为 tools 节点还没执行（被 interrupt 了）
      }
    }
  }

  // ⭐ 检查图是否被中断
  const state = await app.getState(config);
  if (state.next && state.next.length > 0) {
    // state.next 不为空 → 图被暂停了（还有节点没执行完）
    yield {
      type: 'interrupt',
      content: '⏸️ Agent 想要执行工具调用，等待人工确认...',
      interruptValue: { nextNodes: state.next },
    };
  } else {
    // state.next 为空 → 图正常执行到了 END（不需要工具的情况）
    yield { type: 'done' };
  }
}
```

`buildHitlGraph()` 是一个私有方法，封装了 HiTL 图的构建逻辑（与 Part 2 的 StateGraph 构建过程相同，额外在 `compile()` 时传入 `interruptBefore: ['tools']`）。`chatWithHumanInTheLoop` 和 `resumeExecution` 都调用它，确保图结构一致。

### agent.getState() 详解

```typescript
const state = await agent.getState(config);
```

`getState()` 返回当前 State 快照，关键字段：

```plain
state.values:  当前的 State 值（messages 等）
state.next:    图接下来要执行的节点数组

如果 next = ['tools']  → 图在 tools 节点前被暂停了
如果 next = []         → 图已正常执行到 END

例如：
  LLM 判断不需要工具（用户说"你好"）
  → shouldContinue 直接路由到 END
  → state.next = []
  → 正常结束，不需要中断

  LLM 判断需要调工具（用户问天气）
  → shouldContinue 路由到 tools
  → interruptBefore 触发
  → state.next = ['tools']
  → 图被中断了
```

## 4.5 实现代码：resumeExecution

```typescript
// src/langgraph/langgraph.service.ts

async *resumeExecution(threadId: string): AsyncGenerator<LangGraphEvent> {
  // 重新构建相同配置的图
  // 虽然是"重新构建"，但 checkpointer 是同一个实例（类成员变量），
  // 所以之前保存的 State 还在（存在 Redis 中）
  const app = this.buildHitlGraph();

  const config = {
    configurable: { thread_id: threadId },  // 同一个 threadId
  };

  // ⭐ stream(null, config) 是恢复执行的关键！
  //
  // null 告诉 LangGraph："不传新输入，从上次 checkpointer 保存的状态继续"
  // LangGraph 会：
  //   1. 根据 thread_id 从 checkpointer（Redis）读取 State 快照
  //   2. 找到 state.next 指向的节点（本例中是 'tools'）
  //   3. 从该节点开始继续执行
  const stream = await app.stream(null, config);

  // 解析恢复后的事件流
  for await (const event of stream) {
    for (const [nodeName, output] of Object.entries(event)) {
      yield { type: 'node', node: nodeName };

      const nodeOutput = output as { messages: BaseMessage[] };
      if (!nodeOutput.messages) continue;

      for (const msg of nodeOutput.messages) {
        if (msg instanceof AIMessage) {
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              yield {
                type: 'tool_call',
                name: tc.name,
                args: tc.args as Record<string, unknown>,
                id: tc.id,
              };
            }
          }
          if (msg.content && typeof msg.content === 'string' && msg.content.length > 0) {
            yield { type: 'content', content: msg.content };
          }
        } else if (msg instanceof ToolMessage) {
          yield {
            type: 'tool_result',
            result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            id: msg.tool_call_id,
          };
        }
      }
    }
  }

  // 检查恢复执行后是否又遇到了新的中断
  // 场景：Agent 第一次工具调用后，LLM 又决定调用另一个工具
  // → tools 执行完 → agent 又返回 tool_calls → 再次到达 interruptBefore → 又暂停
  // → 前端再次展示确认面板 → 实现"逐个审核"的效果
  const state = await app.getState(config);
  if (state.next && state.next.length > 0) {
    yield {
      type: 'interrupt',
      content: '⏸️ Agent 想要执行更多工具调用，等待人工确认...',
      interruptValue: { nextNodes: state.next },
    };
  } else {
    yield { type: 'done' };
  }
}
```

### stream(null, config) 详解

```plain
stream(null, config)  vs  stream({ messages: [...] }, config)

stream({ messages: [...] }, config)：
  → 传入新消息作为输入
  → 从 START 开始执行

stream(null, config)：
  → 不传新输入
  → 从 checkpointer 中读取 thread_id 对应的 State 快照
  → 从 state.next 指向的节点开始执行
  → 等于"从上次暂停的地方继续"

执行流程：
  checkpointer.get("hitl-001")
    → 读到 State 和 next = ['tools']
    → [tools] 执行工具
    → [agent] LLM 生成回答
    → 如果 shouldContinue → 'end' → END
    → 如果 shouldContinue → 'continue' → 又到 tools 前 → interruptBefore → 再次暂停
```

## 4.6 Controller 层

HiTL 需要两个 API 端点——一个发送消息（可能暂停），一个恢复执行：

```typescript
// src/langgraph/langgraph.controller.ts

// 端点 1：发送消息（Agent 可能在调用工具前暂停）
@Post('hitl')
@SkipTransform()
@HttpCode(HttpStatus.OK)
async hitlChat(@Body() body: LangGraphRequestDto, @Res() res: Response) {
  const { message, threadId, systemPrompt } = body;
  this.setupSSE(res);

  try {
    const stream = this.langGraphService.chatWithHumanInTheLoop(
      message, threadId || `hitl-${Date.now()}`, systemPrompt,
    );
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    this.writeError(res, error);
  } finally {
    res.end();
  }
}

// 端点 2：恢复执行（用户确认后调用）
@Post('hitl/resume')
@SkipTransform()
@HttpCode(HttpStatus.OK)
async hitlResume(@Body() body: LangGraphResumeDto, @Res() res: Response) {
  this.setupSSE(res);

  try {
    const stream = this.langGraphService.resumeExecution(body.threadId);
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    this.writeError(res, error);
  } finally {
    res.end();
  }
}
```

恢复请求的 DTO：

```typescript
// src/langgraph/dto/langgraph-request.dto.ts

export class LangGraphResumeDto {
  @IsString()
  @IsNotEmpty()
  threadId: string;       // 必须和之前暂停时的 threadId 一致

  @IsOptional()
  @IsString()
  humanInput?: string;    // 可选：人工输入（本项目暂未使用）
}
```

## 4.7 HiTL 完整链路图

```plain
前端                              Server                            外部服务
──────                            ──────                            ────────

1. POST /langgraph/hitl
   { message: "北京天气",
     threadId: "hitl-001" }
        │
        │                    LangGraphController.hitlChat()
        │                         ↓
        │                    LangGraphService
        │                    .chatWithHumanInTheLoop()
        │                         ↓
        │                    this.buildHitlGraph()
        │                    → StateGraph + compile({
        │                        checkpointer,
        │                        interruptBefore: ['tools']
        │                      })
        │                         ↓
        │                    agent.stream(message, config)
        │                         ↓
        │                    [agent 节点执行]  ─────→   LLM API
        │                         ↓              ←─   AIMessage(tool_calls)
        │                    即将进入 [tools]
        │                    → interruptBefore ⏸️
        │                         ↓
        │  ←── SSE ────     agent.getState(config)
        │  node + tool_call      → state.next = ['tools']
        │  + interrupt 事件       ↓
        │                    yield { type: 'interrupt' }
        │
        ↓
   展示待执行的工具调用
   + 黄色确认面板
   输入框被禁用
   用户点击"✅ 确认执行"
        │
        │
2. POST /langgraph/hitl/resume
   { threadId: "hitl-001" }
        │
        │                    LangGraphService.resumeExecution()
        │                         ↓
        │                    agent.stream(null, config)  ← null = 从检查点恢复
        │                         ↓
        │                    [tools 节点执行]  ─────→   wttr.in API
        │                         ↓              ←─   天气数据
        │                    [agent 节点执行]  ─────→   LLM API
        │                         ↓              ←─   最终回答
        │  ←── SSE ────     tool_result + content + done
        │
        ↓
   渲染工具结果 + 最终回答
```

## 4.8 interruptBefore vs interruptAfter vs interrupt()

LangGraph 提供了三种中断方式，适用不同场景：

```plain
1. interruptBefore: ['tools']
   → 在 tools 节点执行前自动暂停
   → 适合"审核工具调用参数"（AI 想调什么工具、用什么参数）
   → 恢复：stream(null, config)
   → 本项目使用的方式

2. interruptAfter: ['tools']
   → 在 tools 节点执行后自动暂停
   → 适合"审核工具执行结果"（工具返回了什么，要不要给 AI 看）
   → 恢复：stream(null, config)

3. interrupt(payload)
   → 在节点函数内部手动调用
   → 可以传自定义数据给前端（payload）
   → 适合"根据条件决定是否暂停"（不是每次都暂停，而是满足某条件才暂停）
   → 恢复：stream(Command({ resume: value }), config)
   → value 成为 interrupt() 的返回值

示例对比：
  interruptBefore:  每次工具调用都暂停（无条件）
  interrupt():      只有调用"高危"工具时才暂停（有条件）
```

本项目用的是 `interruptBefore`，更简洁，适合学习。

## 4.9 多次中断场景

Agent 可能需要调用多个工具。使用 `interruptBefore` 时，每次到达 tools 节点前都会暂停：

```plain
用户: "对比北京和纽约的天气和时间"

第 1 次请求（chatWithHumanInTheLoop）：
  [agent] → LLM 返回 tool_calls: [get_weather("北京"), get_current_time("纽约")]
  → interruptBefore → ⏸️ 暂停
  → SSE: tool_call + tool_call + interrupt

第 2 次请求（resumeExecution）：
  → [tools] 执行两个工具调用
  → [agent] LLM 看到结果，可能还想调更多工具
  → 如果 LLM 又返回 tool_calls → 再次到达 interruptBefore → ⏸️ 再暂停
  → SSE: tool_result + tool_result + (可能的新 tool_call) + interrupt 或 done

第 N 次请求（如果需要的话）：
  → 继续恢复执行，直到 LLM 不再调用工具 → done
```

这就是 `resumeExecution` 最后也要检查 `state.next` 的原因——恢复后可能又被中断。

## 4.10 测试

```bash
# 第一步：发送消息（Agent 会在调用工具前暂停）
curl -X POST http://localhost:3500/langgraph/hitl \
  -H "Content-Type: application/json" \
  -d '{"message": "纽约现在几点？", "threadId": "hitl-test-001"}'
```

输出：

```
data: {"type":"node","node":"agent"}
data: {"type":"tool_call","name":"get_current_time","args":{"timezone":"America/New_York"},"id":"call_xxx"}
data: {"type":"interrupt","content":"⏸️ Agent 想要执行工具调用，等待人工确认..."}
```

注意没有 `tool_result` 和 `content`——Agent 在执行工具前被暂停了。

```bash
# 第二步：确认执行（传同一个 threadId）
curl -X POST http://localhost:3500/langgraph/hitl/resume \
  -H "Content-Type: application/json" \
  -d '{"threadId": "hitl-test-001"}'
```

输出：

```
data: {"type":"node","node":"tools"}
data: {"type":"tool_result","result":"纽约当前时间：2025-07-15 10:30:45..."}
data: {"type":"node","node":"agent"}
data: {"type":"content","content":"纽约现在是上午 10:30..."}
data: {"type":"done"}
```

Agent 从中断点恢复，继续执行工具调用并返回最终回答。

```bash
# 测试不需要工具的问题
curl -X POST http://localhost:3500/langgraph/hitl \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "threadId": "hitl-test-002"}'
```

输出：

```
data: {"type":"node","node":"agent"}
data: {"type":"content","content":"你好！我是智能助手..."}
data: {"type":"done"}
```

不需要工具时，Agent 直接返回回答，没有 interrupt。**只有 Agent 决定调用工具时才会暂停。**

---

# 前端实现

Phase 3 前端的核心改动。

## 新增数据结构

```typescript
// web/src/App.tsx

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  // Phase 3 新增字段
  activeNode?: string           // 🆕 当前正在执行的图节点（agent / tools）
  interrupted?: boolean         // 🆕 是否被 HiTL 中断
  interruptContent?: string     // 🆕 中断提示信息
}

type ChatMode = 'chat' | 'agent' | 'langgraph'     // 🆕 新增 langgraph
type LangGraphSubMode = 'chat' | 'react' | 'hitl'  // 🆕 LangGraph 三种子模式
```

## 新增状态

```typescript
const [mode, setMode] = useState<ChatMode>('langgraph')
const [lgSubMode, setLgSubMode] = useState<LangGraphSubMode>('react')
const [threadId, setThreadId] = useState<string>(`thread-${Date.now()}`)
const [pendingResume, setPendingResume] = useState<string | null>(null) // 待恢复的 threadId
```

## SSE 事件处理

```typescript
const handleLangGraphChat = async () => {
  // 根据子模式选择 API 端点
  const endpoint = lgSubMode === 'chat'
    ? '/langgraph/chat'       // 自定义 StateGraph
    : lgSubMode === 'react'
      ? '/langgraph/react'    // createReactAgent
      : '/langgraph/hitl'     // Human-in-the-Loop

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: JSON.stringify({ message, threadId, history, systemPrompt }),
  })

  // SSE 事件处理（比 Phase 2 多了 node 和 interrupt）
  // type === 'node'      → 更新 activeNode，显示蓝色节点标签
  // type === 'tool_call' → 和 Phase 2 一样，工具卡片出现
  // type === 'tool_result' → 和 Phase 2 一样，工具卡片更新
  // type === 'content'   → 更新消息文本
  // type === 'interrupt' → 🆕 设置中断状态，显示黄色确认面板，禁用输入框
  // type === 'done'      → 清除 activeNode
}
```

## 恢复执行

```typescript
const handleResume = async () => {
  if (!pendingResume || loading) return

  // 更新 UI：去掉中断状态，设置 activeNode 为 tools（恢复后第一个执行的节点）
  setMessages(prev => {
    const last = prev[prev.length - 1]
    last.interrupted = false
    last.activeNode = 'tools'
    return [...prev]
  })

  // 调用恢复接口
  const res = await fetch(`${API_BASE}/langgraph/hitl/resume`, {
    method: 'POST',
    body: JSON.stringify({ threadId: pendingResume }),
  })

  // 处理恢复后的 SSE 事件流（和 handleLangGraphChat 的事件处理一样）
}
```

## UI 组件

### 图节点指示器

当 Agent 执行到某个节点时，在消息气泡顶部显示一个带脉冲动画的蓝色标签：

```tsx
{msg.activeNode && (
  <div className="graph-node-indicator">
    <span className="graph-node-icon">
      {msg.activeNode === 'agent' ? '🧠' : '🔧'}
    </span>
    <span className="graph-node-label">
      {msg.activeNode === 'agent' ? 'Agent 推理' : '工具执行'}
    </span>
    <span className="graph-node-dot" />  {/* 蓝色脉冲圆点 */}
  </div>
)}
```

### HiTL 中断确认面板

Agent 被 `interruptBefore` 暂停时，在工具调用卡片下方显示黄色确认面板：

```tsx
{msg.interrupted && (
  <div className="hitl-interrupt-panel">
    <div className="hitl-interrupt-header">
      <span>⏸️</span>
      <span>等待确认</span>
    </div>
    <p>Agent 想要执行上述工具调用，请确认是否继续执行。</p>
    <button className="hitl-btn-approve" onClick={handleResume}>
      ✅ 确认执行
    </button>
  </div>
)}
```

### 模式切换

底部工具栏从两个按钮升级为三个，LangGraph 模式还有子模式选择器：

```tsx
<div className="input-tools">
  {/* 三个主模式 */}
  <button onClick={() => setMode('chat')}>💬 聊天</button>
  <button onClick={() => setMode('agent')}>🛠️ Agent</button>
  <button onClick={() => setMode('langgraph')}>📊 LangGraph</button>

  {/* LangGraph 子模式 */}
  {mode === 'langgraph' && (
    <>
      <span className="divider">|</span>
      <button onClick={() => setLgSubMode('chat')}>StateGraph</button>
      <button onClick={() => setLgSubMode('react')}>ReAct</button>
      <button onClick={() => setLgSubMode('hitl')}>HiTL</button>
    </>
  )}
</div>
```

### Thread ID 管理

设置面板中新增 Thread ID 输入框，支持手动编辑和自动生成：

```tsx
{mode === 'langgraph' && (
  <div className="settings-thread">
    <label>Thread ID（对话线程）</label>
    <div className="thread-id-row">
      <input value={threadId} onChange={e => setThreadId(e.target.value)} />
      <button onClick={() => setThreadId(`thread-${Date.now()}`)}>🔄</button>
    </div>
    <span className="settings-hint">同一个 Thread ID 共享对话记忆</span>
  </div>
)}
```

## SSE 事件 → UI 映射表

```
SSE 事件 type     state 变化                 UI 效果
─────────────     ──────────                 ───────
node              activeNode = 'agent'       蓝色节点标签出现
                  / 'tools'                  + 脉冲动画

tool_call         toolCalls: [{              工具卡片出现
                    status: 'calling'          状态: "调用中..."
                  }]

tool_result       tc.result = '...'          工具卡片更新
                  tc.status = 'done'          状态: "已完成"

content           content = '...'            消息气泡显示文本

interrupt         interrupted = true          黄色确认面板出现
                  pendingResume = threadId    输入框禁用

done              activeNode = undefined      节点标签消失

── 用户点确认 ──   interrupted = false         确认面板消失
                  fetch /hitl/resume         工具结果 + 回答出现
```

---

# 启动与测试

## 启动

```bash
cd server && npm run start:dev
cd web && npm run dev
```

打开 `http://localhost:5173`，底部工具栏切换到 **📊 LangGraph** 模式。

看到这些路由就说明 Phase 3 成功注册了：

```
Mapped {/langgraph/chat, POST} route
Mapped {/langgraph/react, POST} route
Mapped {/langgraph/hitl, POST} route
Mapped {/langgraph/hitl/resume, POST} route
```

## 前端 UI 操作指南

1. **切换模式**：底部工具栏点击 `📊 LangGraph`，右侧出现三个子模式按钮
2. **StateGraph 模式**：点击 `StateGraph`，发消息后观察蓝色节点标签的切换（agent → tools → agent）
3. **ReAct 模式**：点击 `ReAct`，功能和 StateGraph 一样，但后端用 `createReactAgent` 一行代码实现
4. **HiTL 模式**：点击 `HiTL`，发送"北京天气怎么样？"，观察：
   - Agent 返回工具调用卡片后出现黄色确认面板
   - 输入框被禁用（等待确认）
   - 点击 `✅ 确认执行` 后，Agent 恢复执行，显示工具结果和最终回答
5. **多轮对话**：使用同一个 Thread ID，Agent 能记住上下文（"那上海呢？"能理解指代"天气"）
6. **新对话**：点击 🗑 清空聊天，Thread ID 自动重置

---

# 小结

## 概念速查表

| 概念 | 作用 | 类比 |
| --- | --- | --- |
| LangGraph | Agent 编排框架，用图结构表达 Agent 逻辑 | React Router 之于页面导航 |
| StateGraph | 有状态的图，节点间共享 State | Redux Store + 状态机 |
| Annotation | 定义 State schema 和 reducer | Redux 的 reducer |
| Node | 执行逻辑的函数（调 LLM、执行工具等） | 流程图中的处理框 |
| Edge | 节点间的连接 | 流程图中的箭头 |
| ConditionalEdges | 根据 State 决定走向 | if/else 路由 |
| compile() | 把图定义编译为可执行实例 | webpack build |
| stream() | 流式执行图，每个节点 yield 一次 | 逐帧播放 |
| createReactAgent | 预构建的 ReAct Agent，省去手动建图 | create-react-app |
| RedisSaver | Redis 检查点存储，保存每步快照 | 游戏存档（存盘到硬盘） |
| thread_id | 会话 ID，同 ID 共享 State | localStorage 的 key |
| interruptBefore | 在指定节点执行前自动暂停 | 断点调试 |
| getState() | 获取当前 State（检查是否被中断） | 读取存档 |
| stream(null) | 从检查点恢复执行 | 加载存档继续游戏 |

## 核心要点

1. **LangGraph 把 Agent 逻辑从"代码控制流"提升为"图结构"**：Phase 2 的 while 循环和 Phase 3 的 StateGraph 做的事完全一样，但图结构更清晰、更可扩展、更可维护

2. **Annotation 的 reducer 是关键**：它决定了多个节点写入同一字段时如何合并。对话系统用追加策略（`[...current, ...update]`），其他场景可能用覆盖、去重等策略

3. **`createReactAgent` 适合快速原型**：标准的 ReAct 模式不需要手写图，`createReactAgent` 一行搞定。复杂场景再用自定义 StateGraph

4. **Checkpointer 是持久化和中断恢复的基础**：本项目使用 RedisSaver（Redis 持久化），服务重启不丢失状态，多实例部署可共享——没有 checkpointer，就没有多轮对话记忆，也没有 Human-in-the-Loop

5. **`interruptBefore` 实现了"AI 举手报告"**：Agent 想执行敏感操作时自动暂停，等人类确认后再继续。这是生产环境中 AI 安全的关键机制

6. **Phase 1 / 2 / 3 可以共存**：简单聊天用原始 SDK，工具调用用 LangChain，复杂编排用 LangGraph——选择合适的抽象层级

下一篇，我们将进入 **Phase 4：RAG 检索增强生成**——让 AI 不止能调 API，还能查询你自己的文档库，实现"基于私有知识的问答"。
