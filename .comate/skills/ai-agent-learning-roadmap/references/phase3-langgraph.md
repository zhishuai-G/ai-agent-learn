# Phase 3: LangGraph - Agent 编排引擎

## 目录

- [3.1 LangGraph 核心概念](#31-langgraph-核心概念)
- [3.2 StateGraph 基础](#32-stategraph-基础)
- [3.3 ReAct Agent](#33-react-agent)
- [3.4 Human-in-the-Loop](#34-human-in-the-loop)
- [3.5 子图与模块化](#35-子图与模块化)
- [3.6 持久化与检查点](#36-持久化与检查点)
- [3.7 练习项目](#37-练习项目)

---

## 3.1 LangGraph 核心概念

LangGraph 是 LangChain 团队的 Agent 编排框架，核心思想是**将 Agent 逻辑建模为有状态的图**。

### 核心三元素

- **State**: 图的全局状态，在节点间传递和更新
- **Node**: 执行逻辑的函数（调用 LLM、执行工具、处理数据等）
- **Edge**: 节点间的连接，支持条件路由

### 为什么选 LangGraph

| 特性 | 普通 Chain | LangGraph |
|------|-----------|-----------|
| 执行流程 | 线性/固定 | 图结构/动态路由 |
| 循环 | 不支持 | 原生支持 |
| 状态管理 | 手动 | 内置 |
| 中断/恢复 | 不支持 | 检查点机制 |
| 多 Agent | 复杂 | 子图原生支持 |

### 安装

```bash
npm install @langchain/langgraph @langchain/core @langchain/openai
```

---

## 3.2 StateGraph 基础

### 定义 State

```typescript
import { Annotation, StateGraph } from '@langchain/langgraph';

// 使用 Annotation 定义状态 schema
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
  }),
  nextStep: Annotation<string>(),
});
```

### 构建图

```typescript
const graph = new StateGraph(AgentState)
  // 添加节点
  .addNode('agent', callModel)
  .addNode('tools', callTools)
  // 设置入口
  .addEdge('__start__', 'agent')
  // 条件路由
  .addConditionalEdges('agent', shouldContinue, {
    continue: 'tools',
    end: '__end__',
  })
  // 工具执行后回到 agent
  .addEdge('tools', 'agent');

// 编译
const app = graph.compile();

// 执行
const result = await app.invoke({
  messages: [new HumanMessage('帮我搜索最新的React 19特性')],
});
```

### 条件路由函数

```typescript
function shouldContinue(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return 'continue'; // 有工具调用，继续循环
  }
  return 'end'; // 没有工具调用，结束
}
```

---

## 3.3 ReAct Agent

LangGraph 提供预构建的 ReAct Agent：

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const agent = createReactAgent({
  llm: new ChatOpenAI({ modelName: 'gpt-4o' }),
  tools: [searchTool, calculatorTool, weatherTool],
});

// 流式执行
const stream = await agent.stream({
  messages: [new HumanMessage('...')],
});

for await (const event of stream) {
  // event 包含每个节点的输出
  console.log(event);
}
```

### 自定义 ReAct Agent

在预构建基础上可自定义：
- 添加 system prompt
- 修改状态 schema
- 添加前/后处理节点
- 自定义路由逻辑

---

## 3.4 Human-in-the-Loop

### 中断机制

```typescript
const app = graph.compile({
  checkpointer, // 需要持久化支持
  interruptBefore: ['tools'], // 在执行工具前中断
});

// 第一次调用 - 会在 tools 节点前暂停
const config = { configurable: { thread_id: 'thread-1' } };
const result1 = await app.invoke({ messages: [...] }, config);

// 用户确认后继续
const result2 = await app.invoke(null, config); // 从中断点恢复
```

### 适用场景

- 敏感操作需人工确认（发邮件、修改数据）
- 工具调用结果需人工审核
- Agent 规划需要人工调整

---

## 3.5 子图与模块化

### 子图 (Subgraph)

```typescript
// 定义子图：专门处理研究任务
const researchGraph = new StateGraph(ResearchState)
  .addNode('search', searchNode)
  .addNode('summarize', summarizeNode)
  .addEdge('__start__', 'search')
  .addEdge('search', 'summarize')
  .addEdge('summarize', '__end__')
  .compile();

// 主图中引用子图
const mainGraph = new StateGraph(MainState)
  .addNode('planner', plannerNode)
  .addNode('researcher', researchGraph) // 子图作为节点
  .addNode('writer', writerNode)
  .addEdge('__start__', 'planner')
  .addEdge('planner', 'researcher')
  .addEdge('researcher', 'writer')
  .addEdge('writer', '__end__');
```

---

## 3.6 持久化与检查点

### MemorySaver (开发用)

```typescript
import { MemorySaver } from '@langchain/langgraph';

const checkpointer = new MemorySaver();
const app = graph.compile({ checkpointer });

// 每次调用指定 thread_id
const config = { configurable: { thread_id: 'user-123' } };
await app.invoke({ messages: [...] }, config);
```

### 生产持久化方案

- PostgreSQL: `@langchain/langgraph-checkpoint-postgres`
- SQLite: `@langchain/langgraph-checkpoint-sqlite`
- 自定义: 实现 `BaseCheckpointSaver` 接口

---

## 3.7 练习项目

### 项目: 研究助手 Agent

**目标**: 用 LangGraph 构建一个可以自主完成研究任务的 Agent

**功能要求**:
1. 用 StateGraph 构建完整的 Agent 图
2. 支持搜索网络、总结内容、生成报告
3. Human-in-the-Loop: 搜索结果需用户确认
4. 对话记忆: 通过 checkpointer 维持多轮对话
5. 流式输出: 实时展示 Agent 的执行过程

**图结构**:
```
Start → Planner → [Router]
                    ├→ Search → Summarize → Planner (循环)
                    └→ Writer → End
```

**技术要点**:
- NestJS: 封装 LangGraph Agent 为 service
- WebSocket/SSE: 推送 Agent 执行状态到前端
- React: 可视化 Agent 图的执行流程（高亮当前节点）
