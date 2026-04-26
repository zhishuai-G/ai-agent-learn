这个系列记录一个有 React + NestJS 经验的前端开发者，从零学习 AI Agent 的全过程。上一篇我们用 RAG 让 AI 基于私有文档回答问题，不再"胡说八道"。这一篇进入 **Phase 5**——

**让多个 AI Agent 协作完成复杂任务。用 Supervisor 模式让"项目经理"编排专业 Agent 团队；用 Swarm 模式让 Agent 之间自动交接控制权；用 SSE 流式推送实时展示每个 Agent 的思考、工具调用和交接过程。**

全文分为四个部分：

- **Part 1：Multi-Agent 核心原理** —— 为什么需要多 Agent、三种架构模式、和 Phase 1-4 的关系
- **Part 2：Supervisor 模式实战** —— AI 开发团队（PM → Architect → Developer → Reviewer）
- **Part 3：Swarm 模式实战** —— 智能客服（Sales ↔ Tech Support 自动交接）
- **Part 4：前端可视化** —— Agent 协作流程面板 + 多 Agent 消息展示 + SSE 事件过滤

---

# Part 1：Multi-Agent 核心原理

## 1.1 单 Agent 的局限：为什么需要 Multi-Agent？

Phase 1-4 我们一直在用一个 Agent 完成任务，但单个 Agent 在复杂场景下有三个致命局限：

1. **工具过多导致选择困难**：给一个 Agent 塞 20 个工具，它经常调错
2. **上下文窗口被占满**：不同任务的信息混在一起，Agent 抓不住重点
3. **缺乏专业化分工**：让一个 Agent 同时做产品分析、架构设计、写代码、代码审查——每个都做得不精

```plain
用户：帮我开发一个用户登录功能

单 Agent（一个人干所有事）：
  → 分析需求...（还行）
  → 设计架构...（不太专业）
  → 写代码...（能用但不够好）
  → 审查代码...（自己审自己的代码？）
  → 结果：每个环节都做了，但每个都不精

Multi-Agent（专业分工 + 协作）：
  PM Agent     → 分析需求，拆分任务 ✅ 专业
  Architect    → 设计技术方案 ✅ 专业
  Developer    → 编写代码 ✅ 专业
  Reviewer     → 代码审查 ✅ 专业（还能打回重写！）
  → 结果：每个环节都由专家完成
```

**类比现实团队**：你不会让一个全栈工程师同时当产品经理、架构师、开发、测试——你会组建一个团队，让每个人做最擅长的事。Multi-Agent 就是让 AI 也这么做。

## 1.2 三种核心架构

```plain
1. Supervisor（主管模式）
   ┌───────────┐
   │ Supervisor │ ← 中心调度者，决定任务分配给谁
   └─────┬─────┘
     ┌───┼───┐
     ↓   ↓   ↓
   [PM] [Dev] [QA]  ← 专业 Agent，只做自己的事

   特点：中心化控制，Supervisor 全局视角
   适合：流水线式工作流（需求→设计→开发→审查）

2. Swarm（对等协作）
   [Sales]  ⇄  [Tech Support]
   
   Agent 之间直接交接控制权，没有中心调度者
   Sales 遇到技术问题 → 自动交给 Tech Support
   Tech Support 遇到价格问题 → 自动交给 Sales

   特点：去中心化，Agent 自主决定交接
   适合：客服系统、角色切换场景

3. Hierarchical（层级模式）
   ┌──────────┐
   │ Top Boss  │
   └────┬─────┘
     ┌──┼──┐
     ↓  ↓  ↓
   [子主管][子主管]  ← 每个子主管再管自己的团队
     ↓
   [Worker Agents]

   特点：多级管理
   适合：超大规模系统（本项目不涉及）
```

**本项目实现前两种：**

| 模式 | 场景 | Agent 角色 | 编排方式 |
|------|------|-----------|---------|
| Supervisor | AI 开发团队 | PM、Architect、Developer、Reviewer | Supervisor 中心调度 |
| Swarm | 智能客服 | Sales、Tech Support | Agent 自主交接 |

## 1.3 Multi-Agent 和 Phase 1-4 的关系

**Multi-Agent 不替代前四个 Phase，而是在 LangGraph 基础上新增了"协作编排"能力。**

```plain
Phase 1（原始 SDK）：
  └── 直接调 OpenAI SDK → 纯对话

Phase 2（LangChain + Tool Use）：
  ├── ChatOpenAI → 模型封装
  ├── tools/     → 工具定义
  └── 手写 Tool Use 循环

Phase 3（LangGraph 状态图）：
  ├── 复用 ChatOpenAI + tools
  ├── StateGraph → 手动构建图
  └── createReactAgent → 一行创建 Agent

Phase 4（RAG）：
  ├── 新增 Embedding 模型 + Vector Store
  └── 知识管线：加载→分块→向量化→检索→生成

Phase 5（Multi-Agent）：              ← 🆕
  ├── 复用 ChatOpenAI + createReactAgent
  ├── 🆕 createSupervisor → Supervisor 编排
  ├── 🆕 createSwarm → Swarm 协作
  └── 🆕 streamMultiAgent → 多 Agent SSE 流式推送
```

关键递进关系：

```plain
Phase 2：一个 Agent + 几个工具 → 能调 API 了
Phase 3：一个 Agent + LangGraph → 能编排多轮工具调用了
Phase 4：一个 Agent + RAG      → 能查私有文档了
Phase 5：多个 Agent + 编排     → 能分工协作了！

Phase 3 的 createReactAgent 是 Phase 5 的基础：
  每个"专业 Agent"本质上就是一个 Phase 3 的 ReAct Agent
  Supervisor/Swarm 负责把这些 Agent 串联起来
```

## 1.4 项目结构

在 Phase 4 的基础上新增 `multi-agent/` 模块：

```
server/src/
├── llm/                       # Phase 1
├── chat/                      # Phase 1
├── langchain/                 # Phase 2
├── agent/                     # Phase 2
├── langgraph/                 # Phase 3
├── rag/                       # Phase 4
└── multi-agent/               # Phase 5 🆕
    ├── multi-agent.module.ts  # NestJS 模块注册
    ├── multi-agent.controller.ts  # 2 个 SSE 端点
    ├── multi-agent.service.ts     # 核心：Supervisor + Swarm 编排
    ├── multi-agent-stream.util.ts # 多 Agent SSE 事件流工具
    ├── agents/
    │   ├── prompts.ts         # 7 个 Agent 的系统提示词
    │   └── tools.ts           # 4 个语义标记工具
    └── dto/
        └── multi-agent-request.dto.ts  # 请求 DTO
```

前端新增：

```
web/src/
├── hooks/
│   └── use-multi-agent.ts     # Phase 5 🆕 多 Agent SSE hook
├── components/
│   └── agent-flow.tsx         # Phase 5 🆕 Agent 协作流程面板
├── styles/
│   └── multi-agent.css        # Phase 5 🆕 样式
└── types/chat.ts              # 更新：新增 Multi-Agent 类型
```

### 安装依赖

```bash
# Supervisor 和 Swarm 是独立的 npm 包
yarn add @langchain/langgraph-supervisor @langchain/langgraph-swarm
```

```plain
包名                              用途
────────────────────────────────  ──────────────────────────
@langchain/langgraph-supervisor   createSupervisor — Supervisor 编排
@langchain/langgraph-swarm        createSwarm — Swarm 对等协作

依赖关系：
  @langchain/langgraph-supervisor
    └── @langchain/langgraph（Phase 3 已安装）

  @langchain/langgraph-swarm
    └── @langchain/langgraph（Phase 3 已安装）
```

### 模块注册

```typescript
// src/multi-agent/multi-agent.module.ts
@Module({
  imports: [LangChainModule],  // 复用 Phase 2 的 ChatOpenAI
  controllers: [MultiAgentController],
  providers: [MultiAgentService],
  exports: [MultiAgentService],
})
export class MultiAgentModule {}

// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,       // Phase 1
    AgentModule,      // Phase 2
    LangGraphModule,  // Phase 3
    RagModule,        // Phase 4
    MultiAgentModule, // Phase 5 🆕
  ],
})
export class AppModule {}
```

---

# Part 2：Supervisor 模式实战

## 2.1 场景：AI 开发团队

想象你是一个技术负责人，接到一个需求："开发一个用户登录功能"。你会怎么做？

```plain
1. 把需求交给产品经理（PM）     → 分析需求，拆分任务
2. 把任务交给架构师（Architect） → 设计技术方案
3. 把方案交给开发者（Developer） → 编写代码
4. 把代码交给审查者（Reviewer）  → 代码审查
   └── 审查不通过？打回给 Developer 重写！
```

Supervisor 模式就是让一个"主管 Agent"自动完成上述调度。

## 2.2 Agent 定义：提示词 + 工具

### 系统提示词

每个 Agent 需要两个东西：**提示词**（告诉它做什么）和**工具**（让它能做事）。

```typescript
// src/multi-agent/agents/prompts.ts

export const SUPERVISOR_PROMPT = `你是一个 AI 开发团队的 Supervisor（项目经理）。
你的职责是根据用户需求，将任务分配给合适的专业 Agent。

团队成员：
- pm：产品经理，负责需求分析和任务拆分
- architect：架构师，负责技术方案设计
- developer：开发者，负责编写代码
- reviewer：审查者，负责代码审查

工作流程：
1. 先让 pm 分析需求
2. 再让 architect 设计方案
3. 然后让 developer 编写代码
4. 最后让 reviewer 审查代码
5. 如果审查不通过，让 developer 修改后重新审查

注意：每次只分配给一个 Agent，等它完成后再分配下一个。`;

export const PM_PROMPT = `你是产品经理（PM），负责需求分析和任务拆分。
当收到一个需求时，你需要：
1. 分析需求的核心功能点
2. 拆分为具体的子任务
3. 定义每个子任务的验收标准
请使用 analyze_requirement 工具记录你的分析结果。`;

// architect、developer、reviewer 的提示词类似，篇幅所限省略
```

**提示词设计要点**：

```plain
1. 角色明确：告诉 Agent "你是谁"，负责什么
2. 工作流程：告诉 Agent 应该怎么做，步骤是什么
3. 工具引导：告诉 Agent 使用哪个工具（"请使用 analyze_requirement 工具"）
4. 输出格式：告诉 Agent 输出什么格式的结果

Supervisor 的提示词最关键——它定义了整个团队的工作流程！
```

### 语义标记工具

本项目用的工具不是"真正"的工具（不会真的去查天气或写代码），而是**语义标记工具**——让 Agent 用工具调用来标记自己完成了某一步，方便前端展示流程进度。

```typescript
// src/multi-agent/agents/tools.ts

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// PM 的工具：标记需求分析完成
export const analyzeRequirementTool = tool({
  name: 'analyze_requirement',
  description: '分析需求并记录结果',
  parameters: z.object({
    requirement: z.string().describe('需求描述'),
    tasks: z.array(z.string()).describe('拆分的子任务列表'),
    acceptance: z.array(z.string()).describe('验收标准列表'),
  }),
  func: async ({ requirement, tasks, acceptance }) => {
    // 不做真正的事，只是返回一个标记
    return `需求分析完成。\n需求: ${requirement}\n子任务: ${tasks.join(', ')}\n验收标准: ${acceptance.join(', ')}`;
  },
});

// Architect、Developer、Reviewer 的工具类似
// designArchitectureTool、writeCodeTool、reviewCodeTool
```

**为什么用语义标记工具而不是真实工具？**

```plain
真实场景：Agent 调用 GitHub API 创建 PR、调用测试框架运行测试...
学习场景：Agent 调用工具只是为了"标记"流程进度

好处：
1. 不需要配置外部服务（GitHub、数据库等）
2. 专注于 Multi-Agent 编排逻辑，不被工具实现干扰
3. 前端可以看到清晰的工具调用链路

后续可以替换为真实工具，只需要改 func 的实现，Agent 编排逻辑不变。
```

## 2.3 创建 Supervisor 编排图

```typescript
// src/multi-agent/multi-agent.service.ts

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createSupervisor } from '@langchain/langgraph-supervisor';

async *runDevTeam(requirement: string, threadId?: string) {
  const model = this.langchainService.getModel();

  // 1️⃣ 创建四个专业 Agent（每个都是 Phase 3 学过的 ReAct Agent）
  const pmAgent = createReactAgent({
    llm: model,
    tools: [analyzeRequirementTool],   // PM 只用需求分析工具
    prompt: PM_PROMPT,
    name: 'pm',                        // ⚠️ name 很重要！Supervisor 靠它路由
  });

  const architectAgent = createReactAgent({
    llm: model,
    tools: [designArchitectureTool],
    prompt: ARCHITECT_PROMPT,
    name: 'architect',
  });

  const developerAgent = createReactAgent({
    llm: model,
    tools: [writeCodeTool],
    prompt: DEVELOPER_PROMPT,
    name: 'developer',
  });

  const reviewerAgent = createReactAgent({
    llm: model,
    tools: [reviewCodeTool],
    prompt: REVIEWER_PROMPT,
    name: 'reviewer',
  });

  // 2️⃣ 创建 Supervisor 编排图
  const supervisorGraph = createSupervisor({
    llm: model,
    agents: [pmAgent, architectAgent, developerAgent, reviewerAgent],
    prompt: SUPERVISOR_PROMPT,
  });

  // 3️⃣ 编译（带 Redis checkpointer 以支持状态持久化）
  const app = supervisorGraph.compile({
    ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
  });

  // 4️⃣ 流式执行
  const config = {
    configurable: { thread_id: threadId || `team-${Date.now()}` },
    recursionLimit: 50,  // Supervisor 允许 50 轮递归
  };

  yield* streamMultiAgent(app, { messages: [new HumanMessage(requirement)] }, config);
  yield { type: 'done' };
}
```

**逐行解析：**

```plain
createReactAgent({
  llm: model,       → 复用同一个 ChatOpenAI 实例
  tools: [...],      → 每个 Agent 有专属工具（专业分工）
  prompt: '...',     → 角色提示词（告诉 Agent 做什么）
  name: 'pm',        → Agent 名称（Supervisor 靠 name 路由任务）
})

createSupervisor({
  llm: model,        → Supervisor 自己也用 LLM 来决定调度
  agents: [...],     → 注册四个专业 Agent
  prompt: '...',     → Supervisor 的提示词（定义工作流程）
})

supervisorGraph.compile({
  checkpointer: ...  → Redis 持久化（同一 threadId 共享对话记忆）
})
```

**Supervisor 的调度原理：**

```plain
Supervisor 不是硬编码的路由表，而是用 LLM 来决定调度！

用户：开发一个用户登录功能

Supervisor（LLM 推理）：
  "用户要开发登录功能，按工作流程，先让 PM 分析需求"
  → 调用 transfer_to_pm 工具 → PM 开始工作

PM 完成 → 结果返回给 Supervisor

Supervisor（LLM 推理）：
  "PM 分析完了，接下来让 Architect 设计方案"
  → 调用 transfer_to_architect 工具 → Architect 开始工作

...以此类推

⚠️ transfer_to_xxx 工具是 createSupervisor 自动生成的！
   你不需要定义它们，Supervisor 会根据 agents 列表自动创建。
```

### 2.3.1 createSupervisor 内部自动做了什么？

`createSupervisor` 是简写，它内部自动构建了一个完整的 StateGraph。如果你手动展开，等价于：

```typescript
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

// 1️⃣ 定义共享状态
const SupervisorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => [...curr, ...update],  // 消息追加
  }),
});

// 2️⃣ Supervisor 节点：用 LLM 决定调哪个 Agent
const supervisorNode = async (state) => {
  // 把所有 transfer 工具绑定到 LLM
  const modelWithTools = model.bindTools([
    transferToPmTool,       // 自动生成的 transfer_to_pm
    transferToArchitectTool,
    transferToDeveloperTool,
    transferToReviewerTool,
  ]);
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
};

// 3️⃣ 条件路由：判断 LLM 输出的是 transfer 工具还是普通工具
const routeFromSupervisor = (state) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg.tool_calls?.length) return 'end';      // 无 tool_calls → END

  const toolName = lastMsg.tool_calls[0].name;
  if (toolName.startsWith('transfer_to_')) {
    return toolName.replace('transfer_to_', '');       // transfer_to_pm → 'pm'
  }
  return 'tools';                                      // 普通工具 → tools 节点
};

// 4️⃣ 组装图
const graph = new StateGraph(SupervisorState)
  .addNode('supervisor', supervisorNode)   // Supervisor 推理节点
  .addNode('pm', pmAgent)                  // PM 子图（Phase 3 的 ReAct 循环）
  .addNode('architect', architectAgent)    // Architect 子图
  .addNode('developer', developerAgent)    // Developer 子图
  .addNode('reviewer', reviewerAgent)      // Reviewer 子图
  .addEdge(START, 'supervisor')            // 入口 → Supervisor
  .addConditionalEdges('supervisor', routeFromSupervisor, {
    pm: 'pm',                              // transfer_to_pm → pm 节点
    architect: 'architect',                // transfer_to_architect → architect 节点
    developer: 'developer',               // transfer_to_developer → developer 节点
    reviewer: 'reviewer',                 // transfer_to_reviewer → reviewer 节点
    tools: 'tools',                       // 普通工具 → tools 节点
    end: END,                              // 无 tool_calls → END
  })
  .addEdge('pm', 'supervisor')            // PM 完成 → 回到 Supervisor
  .addEdge('architect', 'supervisor')     // Architect 完成 → 回到 Supervisor
  .addEdge('developer', 'supervisor')     // Developer 完成 → 回到 Supervisor
  .addEdge('reviewer', 'supervisor');     // Reviewer 完成 → 回到 Supervisor

const app = graph.compile({ checkpointer });
```

**对比简写和自定义：**

```plain
自定义写法（Phase 3 学过的）          createSupervisor 简写
─────────────────────────────        ──────────────────────
1. 手动定义 Annotation               ✅ 自动生成
2. 手动写 supervisorNode             ✅ 自动生成
3. 手动生成 transfer 工具            ✅ 自动生成
4. 手动写条件路由函数                ✅ 自动生成
5. 手动 addNode × 6 个               ✅ 自动注册
6. 手动 addEdge × 6 条               ✅ 自动连线
7. 手动 addConditionalEdges          ✅ 自动添加
8. 手动 compile                      ✅ 自动编译

代码量：~80 行                        代码量：~5 行
```

**什么时候用简写，什么时候自定义：**

```plain
用 createSupervisor（简写）就够了：
  ✅ 标准的 Supervisor → 多 Agent 调度
  ✅ 所有 Agent 执行完回到 Supervisor
  ✅ 不需要自定义路由逻辑

需要自定义 StateGraph：
  🔧 Agent 之间需要直接通信（不回 Supervisor）
  🔧 需要自定义状态字段（不只是 messages）
  🔧 需要并行执行多个 Agent
  🔧 需要自定义中断点（如 Agent 执行前确认）
  🔧 需要更复杂的条件路由（不只是 tool_calls 判断）
```

### 2.3.2 transfer 工具：不是普通工具，是路由指令

`transfer_to_pm` 和普通工具（如 `analyze_requirement`）有本质区别：

```plain
普通工具（analyze_requirement）：
  LLM 输出 tool_call { name: "analyze_requirement" }
    → 路由到 tools 节点执行函数
    → 返回 ToolMessage（函数结果字符串）
    → 回到 LLM 继续推理

transfer 工具（transfer_to_pm）：
  LLM 输出 tool_call { name: "transfer_to_pm" }
    → 同样路由到 tools 节点执行函数
    → 函数返回 Command 对象（不是普通字符串）
    → LangGraph 读取 Command，跳转到 pm 子图
    → pm 子图完整执行
    → 返回子图的输出消息
    → 回到 Supervisor 继续推理
```

transfer 工具的 `func` 返回的不是字符串，而是 `Command` 对象——告诉 LangGraph "跳转到指定节点"：

```typescript
// transfer_to_pm 的内部实现（伪代码，LangGraph 自动生成）
const transferToPmTool = tool({
  name: 'transfer_to_pm',
  description: '将任务交给 PM',
  parameters: z.object({}),
  func: async () => {
    // 返回 Command，不是普通字符串
    return new Command({
      goto: 'pm',        // ← 跳转到 pm 节点
      update: messages,   // 携带当前消息状态
    });
  },
});
```

**transfer 工具的 SSE 事件流中会产生 `tool_call` 和 `tool_result` 事件**，但它经过 `tools` 节点执行后返回的是 `Command` 对象，LangGraph 识别后执行路由跳转。前端通过 `toolName.startsWith('transfer_to_')` 过滤掉这些内部交接事件，不展示给用户。

```plain
实际 SSE 事件流（以 transfer_to_developer 为例）：

1. agent 节点输出 tool_call
   data: {"type":"tool_call","name":"transfer_to_developer","agent":"agent"}

2. 路由到 tools 节点执行 transfer 函数
   data: {"type":"handoff","from":"agent","to":"tools"}
   data: {"type":"agent_start","agent":"tools"}

3. tools 节点执行完毕，返回 Command 对象
   data: {"type":"tool_result","result":"{\"lg_name\":\"Command\",...}","name":"transfer_to_developer"}
   data: {"type":"agent_end","agent":"tools"}

4. LangGraph 读取 Command，路由到目标节点
   data: {"type":"handoff","from":"tools","to":"developer"}
   data: {"type":"agent_start","agent":"developer"}
```

### 2.3.3 为什么 Agent 执行完要回到 Supervisor？

Supervisor 是调度者，它需要看上一个 Agent 的输出，才能决定下一步给谁：

```plain
PM 执行完直接到 Architect？❌
  Supervisor 不知道 PM 输出了什么
  → 无法判断是否该继续、该给谁
  → 流程失控

PM 执行完回到 Supervisor？✅
  Supervisor 看到 PM 的输出："需求分析完成，拆分了 3 个子任务"
  → LLM 推理："PM 分析完了，按流程该 Architect 了"
  → 调用 transfer_to_architect

Supervisor 能做复杂决策：
  - 审查不通过 → 打回 Developer 重写
  - 需求变更 → 重新让 PM 分析
  - 某个 Agent 失败 → 换一个 Agent 重试
```

这就是 Supervisor（星型拓扑）和 Swarm（网状拓扑）的核心区别——Supervisor 全局把控，Swarm Agent 自主交接。

## 2.4 执行流程详解

用"开发一个用户登录功能"为例，完整流程：

```plain
用户输入："开发一个用户登录功能"

1. Supervisor 接收需求，LLM 推理后决定先交给 PM
   SSE 事件：agent_start(supervisor) → handoff(supervisor→pm) → agent_start(pm)

2. PM 分析需求，调用 analyze_requirement 工具
   SSE 事件：tool_call(analyze_requirement) → tool_result → content("需求分析完成...")

3. PM 完成，结果返回 Supervisor
   SSE 事件：agent_end(pm) → handoff(pm→supervisor)

4. Supervisor 评估 PM 的结果，决定交给 Architect
   SSE 事件：agent_start(supervisor) → handoff(supervisor→architect)

5. Architect 设计方案，调用 design_architecture 工具
   SSE 事件：tool_call(design_architecture) → tool_result → content("技术方案设计完成...")

6. Architect 完成 → Supervisor → Developer → 写代码 → Supervisor → Reviewer → 审查

7. 如果 Reviewer 审查不通过（返回 REVISE）：
   Supervisor → Developer（重写） → Supervisor → Reviewer（再审查）
   ↑ 循环最多 2 轮
```

---

# Part 3：Swarm 模式实战

## 3.1 场景：智能客服

Swarm 模式和 Supervisor 的区别：**没有中心调度者，Agent 之间直接交接控制权**。

```plain
Supervisor 模式：
  用户 → Supervisor → 分配给 Agent A → 返回 Supervisor → 分配给 Agent B
  所有任务都经过 Supervisor 中转

Swarm 模式：
  用户 → Sales → 遇到技术问题 → 直接交给 Tech Support → 解决后返回 Sales
  Agent 之间自主决定交接，没有中间人
```

## 3.2 创建 Swarm 协作图

```typescript
// src/multi-agent/multi-agent.service.ts

import { createSwarm } from '@langchain/langgraph-swarm';

async *runSwarm(message: string, threadId?: string) {
  const model = this.langchainService.getModel();

  // 1️⃣ 创建两个 Agent
  const salesAgent = createReactAgent({
    llm: model,
    tools: [searchTool],              // 销售只需要搜索工具
    prompt: SALES_PROMPT,
    name: 'sales',
  });

  const techAgent = createReactAgent({
    llm: model,
    tools: [searchTool, timeTool, weatherTool],  // 技术支持需要更多工具
    prompt: TECH_SUPPORT_PROMPT,
    name: 'tech_support',
  });

  // 2️⃣ 创建 Swarm 协作图
  const swarmGraph = createSwarm({
    agents: [salesAgent, techAgent],
  defaultActiveAgent: 'sales',      // 默认从 Sales 开始
});
```

**Supervisor vs Swarm 代码对比：**

```plain
                    Supervisor              Swarm
─────────────────   ──────────────          ──────────────
npm 包              @langchain/langgraph-supervisor   @langchain/langgraph-swarm
编排函数            createSupervisor()       createSwarm()
需要 llm 参数       ✅ Supervisor 自己用 LLM 决定调度   ❌ 不需要额外 LLM
需要 prompt 参数    ✅ 定义工作流程          ❌ 不需要
需要 defaultActive  ❌ Supervisor 自动决定    ✅ 指定起始 Agent
调度方式           Supervisor LLM 决定      Agent 提示词引导交接
拓扑结构           星型：所有 Agent 回到 supervisor  网状：Agent 之间直连
transfer 工具      Supervisor 调用          Agent 自己调用
```

### 3.2.1 createSwarm 内部自动做了什么？

和 `createSupervisor` 类似，`createSwarm` 也是简写。它内部自动构建的图结构：

```plain
createSupervisor 构建的图（星型）：
                    ┌─────────────┐
                    │ supervisor   │ ← 中心调度者
                    └──┬─┬─┬─┬────┘
                       ↓ ↓ ↓ ↓
                  [pm] [arch] [dev] [rev]  ← 每个都回 supervisor

createSwarm 构建的图（网状）：
                  ┌─────────┐     ┌──────────────┐
                  │  sales   │ ⇄   │ tech_support  │  ← 直接交接，无中心
                  └─────────┘     └──────────────┘
```

关键区别：**Swarm 没有 supervisor 节点**。交接决策由 Agent 自己做，靠提示词引导：

```plain
Supervisor 模式——交接决策在中心：
  sales 输出 → 回到 supervisor → supervisor LLM 推理 "这是技术问题"
  → supervisor 调用 transfer_to_tech_support

Swarm 模式——交接决策在 Agent 自身：
  sales 输出 → sales LLM 推理 "这是技术问题"
  → sales 自己调用 transfer_to_tech_support → 直接到 tech_support

不需要一个额外的 "调度 LLM"，每个 Agent 自己就是决策者。
```

**为什么 Swarm 不需要 `llm` 和 `prompt` 参数？**

```plain
createSupervisor({
  llm: model,       ← 需要一个独立的 LLM 作为 Supervisor 的"大脑"
  prompt: '...',    ← 需要告诉 Supervisor 怎么调度
  agents: [...],
})

createSwarm({
  agents: [...],              ← 每个 Agent 自己有 LLM（createReactAgent 的 llm）
  defaultActiveAgent: 'sales',← 只需指定谁先接客
})

Swarm 的调度逻辑分散在每个 Agent 的提示词里：
  SALES_PROMPT: "遇到技术问题，交给 tech_support"
  TECH_SUPPORT_PROMPT: "遇到价格问题，交给 sales"

Agent 自己推理 → 自己决定是否交接 → 不需要中心调度者
```

## 3.3 Agent 提示词中的交接引导

Swarm 模式的关键在**提示词**——告诉 Agent 什么时候应该交接：

```typescript
// src/multi-agent/agents/prompts.ts

export const SALES_PROMPT = `你是销售顾问，负责处理：
- 产品价格咨询
- 购买流程引导
- 订单相关问题

遇到以下情况时，交给技术支持（tech_support）：
- 技术问题（bug、报错、部署问题）
- 产品使用方法
- API 相关问题

用自然的语言回答用户，保持友好专业。`;

export const TECH_SUPPORT_PROMPT = `你是技术支持工程师，负责处理：
- 技术问题排查
- 产品使用指导
- API 调用问题

遇到以下情况时，交给销售顾问（sales）：
- 价格和购买问题
- 合同和发票问题
- 退换货政策

用技术性的语言回答，提供具体的解决方案。`;
```

**交接是怎么发生的？**

```plain
用户：我想买你们的产品，多少钱？

Sales Agent：
  "我们的产品定价如下..."  → 直接回答，不交接

用户：但是我安装的时候报错了

Sales Agent（LLM 推理）：
  "这是技术问题，我应该交给技术支持"
  → 调用 transfer_to_tech_support 工具 → Tech Support 接管

Tech Support Agent：
  "请问报错信息是什么？"  → 开始处理技术问题
```

**和 Supervisor 的区别**：

```plain
Supervisor 模式：
  Sales → Supervisor（"这是技术问题"）→ Tech Support
  中间经过 Supervisor 判断和转发

Swarm 模式：
  Sales → Tech Support（直接交接）
  没有中间人，Sales 自己决定交接

Swarm 更快、更自然，但缺乏全局控制。
Supervisor 更有序、可控，但多一跳延迟。

**两种模式的路由对比：**

```plain
Supervisor 路由（星型）：
  用户 → Supervisor → transfer_to_pm → PM → Supervisor → transfer_to_architect → Architect → ...
  每一步都经过 Supervisor，它能看所有 Agent 的输出并做全局决策

Swarm 路由（网状）：
  用户 → Sales → transfer_to_tech_support → Tech Support → transfer_to_sales → Sales → ...
  Agent 之间直接交接，没有中间人

适用场景：
  Supervisor → 流水线式工作流（需求→设计→开发→审查），需要全局把控
  Swarm → 客服/角色切换，Agent 需要快速响应，不需要全局视角
```
```

## 3.4 SSE 流式事件流

两种模式共用同一个 SSE 流式工具 `streamMultiAgent`，它通过 LangGraph 的 `streamEvents` API 捕获所有事件，然后转换为前端需要的格式：

```typescript
// src/multi-agent/multi-agent-stream.util.ts

export interface MultiAgentEvent {
  type:
    | 'agent_start'    // Agent 开始执行
    | 'agent_end'      // Agent 执行完毕
    | 'handoff'        // Agent 间交接（from → to）
    | 'content'        // 正常文本输出（token 级别）
    | 'reasoning'      // 推理/思考过程
    | 'tool_call'      // LLM 决定调用工具
    | 'tool_result'    // 工具执行结果
    | 'done'           // 整个 Multi-Agent 工作流完成
    | 'error';         // 出错
  agent?: string;                      // 哪个 Agent 的事件
  content?: string;                    // content/reasoning 事件的文本
  name?: string;                       // 工具名（tool_call/tool_result）
  args?: Record<string, unknown>;      // 工具调用参数
  result?: string;                     // 工具执行结果
  from?: string;                       // 交接的源 Agent
  to?: string;                         // 交接的目标 Agent
}
```

**事件流示例（Supervisor 模式）：**

```plain
data: {"type":"agent_start","agent":"__start__"}        ← 内部路由节点
data: {"type":"agent_end","agent":"__start__"}
data: {"type":"handoff","from":"__start__","to":"supervisor"}
data: {"type":"agent_start","agent":"supervisor"}       ← Supervisor 开始
data: {"type":"agent_end","agent":"supervisor"}
data: {"type":"handoff","from":"supervisor","to":"agent"}
data: {"type":"agent_start","agent":"agent"}            ← Supervisor LLM 运行
data: {"type":"reasoning","content":"The user wants...","agent":"agent"}
data: {"type":"content","content":"好的！我来协调团队...","agent":"agent"}
data: {"type":"tool_call","name":"transfer_to_pm","args":{},"agent":"agent"}
data: {"type":"agent_end","agent":"agent"}
data: {"type":"handoff","from":"agent","to":"pm"}
data: {"type":"agent_start","agent":"pm"}               ← PM 开始
data: {"type":"tool_call","name":"analyze_requirement","args":{...},"agent":"pm"}
data: {"type":"tool_result","result":"需求分析完成...","name":"analyze_requirement","agent":"pm"}
data: {"type":"content","content":"需求分析如下...","agent":"pm"}
data: {"type":"agent_end","agent":"pm"}
...
data: {"type":"done"}
```

**⚠️ 关键点：事件中包含 LangGraph 内部节点**（`__start__`、`supervisor`、`agent`、`tools`），这些是路由节点，不是真正的"专业 Agent"。前端需要过滤这些节点，只展示 `pm`、`architect`、`developer`、`reviewer` 等真实 Agent。这是 Part 4 要解决的问题。

## 3.5 Controller 端点

```typescript
// src/multi-agent/multi-agent.controller.ts

@ApiTags('Multi-Agent - 多 Agent 协作系统 (Phase 5)')
@Controller('multi-agent')
export class MultiAgentController {

  // POST /multi-agent/supervisor
  @Post('supervisor')
  @SkipTransform()  // ⚠️ SSE 必须跳过全局响应包装
  @HttpCode(HttpStatus.OK)
  async supervisorChat(@Body() body: SupervisorRequestDto, @Res() res: Response) {
    this.setupSSE(res);
    const stream = this.multiAgentService.runDevTeam(body.requirement, body.threadId);
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }

  // POST /multi-agent/swarm
  @Post('swarm')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  async swarmChat(@Body() body: SwarmRequestDto, @Res() res: Response) {
    this.setupSSE(res);
    const stream = this.multiAgentService.runSwarm(body.message, body.threadId);
    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }

  private setupSSE(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }
}
```

**请求参数对比：**

```plain
Supervisor 模式：                    Swarm 模式：
POST /multi-agent/supervisor         POST /multi-agent/swarm
{                                    {
  "requirement": "开发登录功能",       "message": "产品多少钱？",
  "threadId": "team-001"              "threadId": "swarm-001"
}                                    }

⚠️ 字段名不同：
  Supervisor 用 requirement（需求描述）
  Swarm 用 message（用户消息）
```

---

# Part 4：前端可视化

## 4.1 核心挑战：SSE 事件过滤

后端返回的 SSE 事件包含大量 LangGraph 内部路由节点：

```plain
真实的事件流：
  agent_start: __start__     ← 内部路由，不展示
  agent_start: supervisor    ← 内部路由，不展示
  agent_start: agent         ← Supervisor 的 LLM 节点，应映射为 "supervisor"
  agent_start: tools         ← 内部工具执行，不展示
  agent_start: pm            ← ✅ 真实的 PM Agent，展示！
  agent_start: architect     ← ✅ 真实的 Architect Agent，展示！
```

**前端需要做的三件事**：

1. **过滤内部节点**：`__start__`、`__end__`、`tools`、`supervisor` 路由节点不创建消息
2. **映射 LLM 节点**：`agent` 节点映射为 `supervisor`（Supervisor 模式下它是 Supervisor 的 LLM）
3. **延迟创建消息**：只有当 Agent 产生实际内容时才创建消息气泡，避免空消息

## 4.2 Agent 名称映射

```typescript
// web/src/hooks/use-multi-agent.ts

// LangGraph 内部路由节点 — 不创建消息
const INTERNAL_AGENT_NODES = new Set(['__start__', '__end__', 'tools', 'supervisor']);

// 将 LangGraph 节点名映射为展示用的 Agent 名称
function mapAgentName(name: string, subMode: MultiAgentSubMode): string | null {
  if (INTERNAL_AGENT_NODES.has(name)) return null;       // 内部节点，跳过
  if (name === 'agent') return subMode === 'supervisor'  // LLM 节点
    ? 'supervisor'   // Supervisor 模式下 → Supervisor
    : null;          // Swarm 模式下 → 跳过（Swarm 的 agent 节点是内部路由）
  return name;       // 真实 Agent 名（pm、architect、developer、reviewer...）
}
```

**映射效果：**

```plain
原始事件                  映射后              前端行为
─────────────────────    ──────────────      ──────────────
agent_start: __start__   null                跳过，不创建消息
agent_start: supervisor  null                跳过，不创建消息
agent_start: agent       "supervisor"        创建 Supervisor 消息 ✅
agent_start: tools       null                跳过，不创建消息
agent_start: pm          "pm"                创建 PM 消息 ✅
agent_start: architect   "architect"         创建 Architect 消息 ✅
```

## 4.3 延迟消息创建

不能在 `agent_start` 时就创建消息，因为有些 `agent_start` 事件后面没有内容（纯路由）。要在第一个 `content`/`reasoning`/`tool_call` 事件到来时才创建：

```typescript
// 确保当前 Agent 的消息存在，然后更新它
function ensureAgentMessage(
  agentName: string,
  setMessages: SetMessages,
  updater: (last: ChatMessage) => Partial<ChatMessage>,
) {
  setMessages(prev => {
    const last = prev[prev.length - 1];
    // 如果最后一条消息就是该 Agent 的，直接更新
    if (last?.role === 'assistant' && last.agentName === agentName) {
      return updateLastAssistant(prev, updater);
    }
    // 否则先创建新消息再更新
    const withNew = [...prev, {
      role: 'assistant' as const,
      content: '',
      agentName,
      toolCalls: [],
      isThinking: true,
    }];
    return updateLastAssistant(withNew, updater);
  });
}
```

**为什么需要延迟创建？**

```plain
不延迟（agent_start 就创建消息）：
  agent_start: __start__ → 创建空消息 ❌
  agent_start: supervisor → 创建空消息 ❌
  agent_start: agent → 创建 Supervisor 消息 ✅
  agent_start: tools → 创建空消息 ❌
  agent_start: pm → 创建 PM 消息 ✅
  → 结果：3 条无用的空消息

延迟（第一个内容事件才创建）：
  agent_start: __start__ → 记录 currentAgent = null，跳过
  agent_start: agent → 记录 currentAgent = "supervisor"
  content: "好的！我来协调..." → 创建 Supervisor 消息 ✅
  agent_start: pm → 记录 currentAgent = "pm"
  content: "需求分析如下..." → 创建 PM 消息 ✅
  → 结果：只有真实内容的消息
```

## 4.4 过滤 Swarm 的 transfer 工具

Swarm 模式自动生成 `transfer_to_sales`、`transfer_to_tech_support` 等交接工具。这些工具的调用不应显示在前端——它们是内部交接机制，不是用户需要看到的"工具调用"：

```typescript
// 跳过 Swarm 内部的 transfer_to_* 工具
if (toolName.startsWith('transfer_to_')) return;
```

## 4.5 Handoff 事件过滤

原始 handoff 事件包含内部节点，需要映射后过滤：

```typescript
// 映射 handoff 中的 Agent 名称（保留 supervisor 用于交接展示）
function mapHandoffAgent(name: string, subMode: MultiAgentSubMode): string | null {
  if (['__start__', '__end__', 'tools'].includes(name)) return null;
  if (name === 'agent') return subMode === 'supervisor' ? 'supervisor' : null;
  return name;
}

// 只保留两端都是真实 Agent 的 handoff
const fromMapped = mapHandoffAgent(parsed.from, subMode);
const toMapped = mapHandoffAgent(parsed.to, subMode);
if (fromMapped && toMapped && fromMapped !== toMapped) {
  // 记录交接：supervisor → pm、pm → supervisor 等
}
```

**过滤效果：**

```plain
原始 handoff                   过滤后               展示
───────────────────────       ──────────────       ──────────────
__start__ → supervisor        null → supervisor     ❌ 跳过（from 为空）
supervisor → __start__        supervisor → null     ❌ 跳过（to 为空）
agent → pm                    supervisor → pm       ✅ 展示
pm → supervisor               pm → supervisor       ✅ 展示
tools → pm                    null → pm             ❌ 跳过（from 为空）
```

## 4.6 Agent 协作流程面板

前端最核心的可视化组件——展示 Agent 的协作流程和实时状态：

```typescript
// web/src/components/agent-flow.tsx

export function AgentFlow({ flow, subMode }: AgentFlowProps) {
  const isSupervisor = subMode === 'supervisor';

  return (
    <div className="agent-flow-panel">
      <div className="agent-flow-header">
        <span className="agent-flow-title">
          {isSupervisor ? '🎯 Supervisor 编排' : '🐝 Swarm 协作'}
        </span>
      </div>
      {/* Agent 流水线 */}
      <div className="agent-flow-pipeline">
        {flow.agents.map((agent, i) => (
          <Fragment key={agent.name}>
            <AgentCard agent={agent} />
            {i < flow.agents.length - 1 && (
              <div className="agent-flow-arrow">
                {isSupervisor ? '→' : '⇄'}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {/* 交接记录 */}
      {flow.handoffs.length > 0 && (
        <div className="agent-flow-handoffs">
          {flow.handoffs.map((h, i) => (
            <span key={i} className="agent-flow-handoff-item">
              {fromInfo.icon} {fromInfo.label} → {toInfo.icon} {toInfo.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**视觉效果：**

```plain
Supervisor 模式：
┌──────────────────────────────────────────────────────────────────┐
│  🎯 Supervisor 编排                                              │
│                                                                  │
│  ┌──────┐  →  ┌──────────┐  →  ┌──────────┐  →  ┌────────┐    │
│  │ 🎯   │     │  📋      │     │  💻      │     │  🔍    │    │
│  │Super │     │  PM      │     │Developer │     │Reviewer│    │
│  │  ✓   │     │  ●       │     │  ○       │     │  ○     │    │
│  └──────┘     └──────────┘     └──────────┘     └────────┘    │
│                                                                  │
│  🎯 Supervisor → 📋 PM                                          │
└──────────────────────────────────────────────────────────────────┘

Swarm 模式：
┌──────────────────────────────────────┐
│  🐝 Swarm 协作                       │
│                                      │
│  ┌─────────┐  ⇄  ┌──────────────┐  │
│  │  💼     │     │    🛠️        │  │
│  │  Sales  │     │  Tech Support │  │
│  │   ●     │     │     ○        │  │
│  └─────────┘     └──────────────┘  │
└──────────────────────────────────────┘

状态标识：
  ○ pending  → 还没开始
  ● active   → 正在执行（带脉冲动画）
  ✓ done     → 已完成
```

## 4.7 Agent 消息气泡

每个 Agent 的输出显示为独立的聊天消息，带有角色标识：

```typescript
// web/src/components/message-list.tsx

// Agent 头像 — 根据角色显示不同图标
<div className={`message-avatar ${msg.agentName ? `agent-avatar-${msg.agentName}` : ''}`}>
  {msg.role === 'user' ? '👤' : msg.agentName 
    ? (AGENT_DISPLAY_INFO[msg.agentName]?.icon || '🤖') 
    : '🤖'}
</div>

// Agent 标识徽章 — 显示角色名称
{msg.agentName && (
  <span className="agent-badge" style={{ color: AGENT_DISPLAY_INFO[msg.agentName]?.color }}>
    {AGENT_DISPLAY_INFO[msg.agentName]?.icon} {AGENT_DISPLAY_INFO[msg.agentName]?.label}
  </span>
)}
```

**Agent 显示配置：**

```typescript
// web/src/types/chat.ts

export const AGENT_DISPLAY_INFO: Record<string, { icon: string; label: string; color: string }> = {
  supervisor:   { icon: '🎯', label: 'Supervisor',  color: '#dc2626' },
  pm:           { icon: '📋', label: 'PM',          color: '#6366f1' },
  architect:    { icon: '🏗️', label: 'Architect',   color: '#8b5cf6' },
  developer:    { icon: '💻', label: 'Developer',   color: '#059669' },
  reviewer:     { icon: '🔍', label: 'Reviewer',    color: '#d97706' },
  sales:        { icon: '💼', label: 'Sales',        color: '#2563eb' },
  tech_support: { icon: '🛠️', label: 'Tech Support', color: '#7c3aed' },
};
```

## 4.8 完整 Hook：use-multi-agent

把所有逻辑组合起来：

```typescript
// web/src/hooks/use-multi-agent.ts（核心流程）

export function useMultiAgent(messages, setMessages, setLoading) {
  const [agentFlow, setAgentFlow] = useState<AgentFlowState | null>(null);
  const currentAgentRef = useRef<string | null>(null);

  const handleChat = async (userMessage, subMode, threadId) => {
    setLoading(true);

    // 初始化 Agent Flow 状态
    const initialAgents = subMode === 'supervisor'
      ? ['supervisor', 'pm', 'architect', 'developer', 'reviewer']
      : ['sales', 'tech_support'];

    setAgentFlow({
      agents: initialAgents.map(name => ({ name, status: 'pending' })),
      handoffs: [],
    });

    // 调用后端 SSE 接口
    const endpoint = subMode === 'supervisor'
      ? '/multi-agent/supervisor' : '/multi-agent/swarm';
    const body = subMode === 'supervisor'
      ? { requirement: userMessage, threadId }
      : { message: userMessage, threadId };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 逐事件处理
    await readSSE(res, parsed => {
      handleMultiAgentEvent(parsed, setMessages, setAgentFlow, currentAgentRef, subMode);
    });
  };

  return { handleChat, agentFlow, resetFlow };
}
```

## 4.9 App.tsx 集成

在 App.tsx 中添加 Phase 5 模式：

```typescript
// 新增状态
const [multiAgentSubMode, setMultiAgentSubMode] = useState<MultiAgentSubMode>('supervisor');
const multiAgent = useMultiAgent(messages, setMessages, setLoading);

// 模式按钮
<button className={`btn-tool ${mode === 'multi-agent' ? 'active' : ''}`}
  onClick={() => setMode('multi-agent')}>
  🤝 Multi-Agent
</button>

// 子模式切换
{mode === 'multi-agent' && (
  <div className="lg-submode-group">
    <button className={`btn-tool btn-tool-sm ${multiAgentSubMode === 'supervisor' ? 'active' : ''}`}
      onClick={() => setMultiAgentSubMode('supervisor')}>Supervisor</button>
    <button className={`btn-tool btn-tool-sm ${multiAgentSubMode === 'swarm' ? 'active' : ''}`}
      onClick={() => setMultiAgentSubMode('swarm')}>Swarm</button>
  </div>
)}

// Agent Flow 面板
{mode === 'multi-agent' && multiAgent.agentFlow && (
  <AgentFlow flow={multiAgent.agentFlow} subMode={multiAgentSubMode} />
)}

// 发送消息
if (mode === 'multi-agent')
  multiAgent.handleChat(userMessage, multiAgentSubMode, threadId);
```

---

# 总结

## 五个阶段的完整递进

```plain
Phase 1：OpenAI SDK
  → 学会了：LLM 基础对话 + 流式输出

Phase 2：LangChain + Tool Use
  → 学会了：工具调用循环 + Agent 模式

Phase 3：LangGraph
  → 学会了：状态图编排 + ReAct Agent + Human-in-the-Loop

Phase 4：RAG
  → 学会了：文档处理 + 向量检索 + 知识增强

Phase 5：Multi-Agent
  → 学会了：多 Agent 协作 + Supervisor 编排 + Swarm 交接 + 可视化
```

## 核心概念回顾

| 概念 | 说明 |
|------|------|
| `createReactAgent` | 创建一个带工具的 ReAct Agent（Phase 3 学过） |
| `createSupervisor` | 创建 Supervisor 编排图，中心调度多个 Agent |
| `createSwarm` | 创建 Swarm 协作图，Agent 间自主交接 |
| `transfer_to_xxx` | 自动生成的交接工具，Supervisor/Swarm 内部使用 |
| `streamMultiAgent` | SSE 事件流工具，捕获 Agent 生命周期事件 |
| `RedisSaver` | Redis checkpointer，支持 threadId 状态持久化 |
| Agent 名称映射 | 将 LangGraph 内部节点映射为展示用的 Agent 名 |
| 延迟消息创建 | 只在有实际内容时才创建前端消息气泡 |

## 关键踩坑记录

**1. 模型必须支持 tool role**

```plain
报错：400 角色信息不能为空
原因：GLM-5 等模型不支持 role: "tool" 的消息
解决：换用支持 function calling 的模型（如 minimax-m2.7）
```

**2. LangGraph 内部节点需要过滤**

```plain
后端返回的 SSE 事件包含 __start__、supervisor、agent、tools 等内部节点
前端必须过滤这些节点，否则会出现大量空消息
```

**3. Swarm 的 transfer 工具不需要展示**

```plain
transfer_to_sales、transfer_to_tech_support 是内部交接工具
前端应过滤掉，只展示真实的业务工具调用
```

**4. recursionLimit 要合理设置**

```plain
Supervisor 模式：50（4 个 Agent + 可能的审查打回循环）
Swarm 模式：30（2 个 Agent，交接次数有限）
设太低 → Agent 可能无法完成完整流程
设太高 → 如果出循环 bug 会一直跑
```
