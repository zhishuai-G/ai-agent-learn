# Phase 5: Multi-Agent 系统与高级模式

## 目录

- [5.1 Multi-Agent 架构模式](#51-multi-agent-架构模式)
- [5.2 Supervisor 模式](#52-supervisor-模式)
- [5.3 Swarm 模式](#53-swarm-模式)
- [5.4 Agent 间通信](#54-agent-间通信)
- [5.5 练习项目](#55-练习项目)

---

## 5.1 Multi-Agent 架构模式

### 为什么需要 Multi-Agent

单个 Agent 在复杂任务中的局限：
- 工具过多导致选择困难
- 上下文窗口被不同任务信息占满
- 缺乏专业化分工

### 三种核心架构

```
1. Supervisor (主管模式)
   Supervisor Agent → 分配任务给专业 Agent → 汇总结果

2. Swarm (对等协作)
   Agent A ↔ Agent B ↔ Agent C (Agent 之间直接交接控制权)

3. Hierarchical (层级模式)
   Top Supervisor → Sub Supervisors → Worker Agents
```

---

## 5.2 Supervisor 模式

### LangGraph 实现

```typescript
import { createSupervisor } from '@langchain/langgraph/prebuilt';

// 定义专业 Agent
const researchAgent = createReactAgent({
  llm: model,
  tools: [searchTool, scrapeTool],
  prompt: '你是研究专家，负责搜索和整理信息',
});

const codeAgent = createReactAgent({
  llm: model,
  tools: [codeTool, testTool],
  prompt: '你是编码专家，负责编写和测试代码',
});

// 创建 Supervisor
const supervisor = createSupervisor({
  llm: model,
  agents: [researchAgent, codeAgent],
  prompt: '你是项目经理。根据用户需求，将任务分配给合适的专家。',
});

const result = await supervisor.invoke({
  messages: [new HumanMessage('帮我研究React 19新特性并写一个demo')],
});
```

### Supervisor 设计要点

- Supervisor 的 prompt 需明确各 Agent 的能力范围
- 控制最大循环次数，避免无限委派
- 考虑 Agent 失败的兜底逻辑

---

## 5.3 Swarm 模式

### 概念

Agent 之间通过 handoff (交接) 传递控制权，没有中心调度者。

```typescript
import { createSwarm } from '@langchain/langgraph/prebuilt';

const salesAgent = createReactAgent({
  llm: model,
  tools: [pricingTool, orderTool],
  prompt: '你是销售顾问。遇到技术问题时，交给技术支持。',
});

const techAgent = createReactAgent({
  llm: model,
  tools: [docSearchTool, debugTool],
  prompt: '你是技术支持。遇到价格问题时，交给销售顾问。',
});

const swarm = createSwarm({
  agents: [salesAgent, techAgent],
  defaultAgent: salesAgent,
});
```

### 适用场景

- 客服系统（不同部门 Agent 交接）
- 工作流中的角色切换
- 对话中自然地切换专家

---

## 5.4 Agent 间通信

### 共享状态

```typescript
const SharedState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => [...curr, ...update],
  }),
  researchResults: Annotation<string[]>({
    reducer: (curr, update) => [...curr, ...update],
  }),
  currentAgent: Annotation<string>(),
});
```

### 消息传递模式

- **全量消息历史**: 所有 Agent 共享完整对话历史（简单但 token 消耗大）
- **摘要传递**: Agent 产出摘要供下一个 Agent 使用（节省 token）
- **结构化数据**: Agent 通过 State 字段传递结构化结果（最精确）

---

## 5.5 练习项目

### 项目: AI 开发团队

**目标**: 构建一个多 Agent 协作系统模拟开发团队

**Agent 角色**:
1. **PM Agent**: 分析需求，拆分任务
2. **Architect Agent**: 设计技术方案
3. **Developer Agent**: 编写代码
4. **Reviewer Agent**: 代码审查，提出改进建议

**功能要求**:
1. 用户描述需求，PM 自动拆分为子任务
2. Architect 设计方案后交给 Developer
3. Developer 写代码后 Reviewer 审查
4. 审查不通过则打回重写（循环）
5. 前端可视化展示整个协作流程

**技术要点**:
- LangGraph Supervisor 模式编排 Agent
- 子图: 每个 Agent 可以是独立子图
- NestJS WebSocket: 实时推送 Agent 执行状态
- React: Agent 协作可视化面板（流程图 + 实时状态）
