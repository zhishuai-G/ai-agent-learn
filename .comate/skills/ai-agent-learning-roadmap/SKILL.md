---
name: ai-agent-learning-roadmap
description: 前端 AI Agent 方向学习路线指导。技术栈：React + NestJS + LangGraph + LangChain.js。当用户询问 AI Agent 学习路线、学习规划、技术选型，或在 ai-langgraph 项目中需要学习指导时使用此 skill。涵盖：LLM 基础、LangChain.js、LangGraph Agent 编排、RAG 检索增强生成、Multi-Agent 多智能体协作、MCP 工具协议、全栈 AI 应用工程化。
---

# 前端 AI Agent 学习路线

面向有 React + NestJS 经验的中级开发者，系统掌握 AI Agent 全栈开发能力。

## 学习路线总览

共 7 个阶段，每阶段包含知识点 + 练习项目，循序渐进：

```
Phase 1: AI 基础与 LLM 核心概念
  └→ LLM 原理、Prompt Engineering、OpenAI API、流式输出
  └→ 项目: 基础聊天应用

Phase 2: LangChain.js 生态与核心组件
  └→ LCEL、Chain 模式、Tool Use / Function Calling、Output Parsers
  └→ 项目: 智能客服助手（带工具调用）

Phase 3: LangGraph - Agent 编排引擎 ⭐ 核心
  └→ StateGraph、ReAct Agent、Human-in-the-Loop、子图、持久化
  └→ 项目: 研究助手 Agent

Phase 4: RAG 检索增强生成
  └→ 文档处理、向量数据库、检索策略、Agentic RAG
  └→ 项目: 智能文档问答系统

Phase 5: Multi-Agent 系统
  └→ Supervisor 模式、Swarm 模式、Agent 间通信
  └→ 项目: AI 开发团队（多 Agent 协作）

Phase 6: MCP - 工具协议与标准化
  └→ MCP 协议原理、MCP Server/Client 开发、工具动态发现
  └→ 项目: 将 Phase 2-5 的硬编码工具改造为 MCP Server

Phase 7: 全栈 AI 应用工程化
  └→ Chat UI、Vercel AI SDK、NestJS 架构、生产化、可观测性
  └→ 毕业项目: AI 全栈工作台
```

## 技术栈清单

### 核心依赖

```json
{
  "@langchain/langgraph": "Agent 编排引擎",
  "@langchain/core": "LangChain 核心抽象",
  "@langchain/openai": "OpenAI 模型集成",
  "langchain": "高层 Chain/Agent",
  "ai": "Vercel AI SDK (前端流式处理)",
  "@ai-sdk/openai": "Vercel AI SDK OpenAI 适配",
  "@modelcontextprotocol/sdk": "MCP 官方 SDK (工具协议)",
  "zod": "Schema 定义 (工具参数、输出格式)"
}
```

### 前端

- React 18/19 + TypeScript
- shadcn/ui (组件库)
- ReactFlow (Agent 图可视化)
- react-markdown + remark-gfm (Markdown 渲染)
- Vercel AI SDK `useChat` hook

### 后端

- NestJS + TypeScript
- LangGraph.js + LangChain.js
- PostgreSQL + Pgvector (生产) / Chroma (开发)
- Redis (缓存)
- WebSocket (@nestjs/websockets)

## 各阶段详细内容

每阶段包含详细的知识点、代码示例和练习项目，按需查阅：

- **Phase 1 - AI 基础**: 查看 [references/phase1-foundations.md](references/phase1-foundations.md)
  - LLM 核心概念、主流模型对比、Prompt Engineering、OpenAI API 实战、流式输出
- **Phase 2 - LangChain.js**: 查看 [references/phase2-langchain-basics.md](references/phase2-langchain-basics.md)
  - LCEL 表达式语言、Chain 模式、Tool Use、Output Parsers
- **Phase 3 - LangGraph**: 查看 [references/phase3-langgraph.md](references/phase3-langgraph.md)
  - StateGraph、条件路由、ReAct Agent、Human-in-the-Loop、子图、持久化
- **Phase 4 - RAG**: 查看 [references/phase4-rag.md](references/phase4-rag.md)
  - 文档处理管线、向量数据库选型、检索策略、Agentic RAG / Self-RAG / CRAG
- **Phase 5 - Multi-Agent**: 查看 [references/phase5-multi-agent.md](references/phase5-multi-agent.md)
  - Supervisor 模式、Swarm 模式、Agent 间通信
- **Phase 6 - MCP 工具协议**: 查看 [references/phase6-mcp.md](references/phase6-mcp.md)
  - MCP 协议原理、Server/Client 开发、工具动态发现、与 LangGraph 集成
- **Phase 7 - 全栈工程化**: 查看 [references/phase7-fullstack.md](references/phase7-fullstack.md)
  - Chat UI 组件体系、Vercel AI SDK、NestJS 架构、生产化、可观测性

## 学习资源

推荐的官方文档、视频教程、开源项目和社区资源，查看 [references/resources.md](references/resources.md)。

## 学习建议

1. **边学边做**: 每阶段完成练习项目后再进入下一阶段
2. **优先 Phase 3**: LangGraph 是整个学习路线的核心，可在 Phase 1 后直接跳到 Phase 3
3. **善用官方示例**: LangGraph.js 的 examples 目录是最佳学习材料
4. **关注 LangChain Academy**: 免费官方课程，质量高
5. **在 ai-langgraph 仓库中实践**: 每个阶段的项目都可以作为这个仓库的迭代版本
