# Phase 2: LangChain.js 生态与核心组件

## 目录

- [2.1 LangChain.js 架构概览](#21-langchainjs-架构概览)
- [2.2 核心抽象](#22-核心抽象)
- [2.3 Chain 模式](#23-chain-模式)
- [2.4 Tool Use / Function Calling](#24-tool-use--function-calling)
- [2.5 Output Parsers](#25-output-parsers)
- [2.6 练习项目](#26-练习项目)

---

## 2.1 LangChain.js 架构概览

### 包结构

```
@langchain/core        - 核心抽象（必装）
@langchain/openai      - OpenAI 集成
@langchain/anthropic   - Anthropic 集成
@langchain/community   - 社区集成
langchain              - 高层 chain/agent（按需）
```

### NestJS 集成模式

```typescript
// src/langchain/langchain.module.ts
@Module({
  providers: [
    {
      provide: 'CHAT_MODEL',
      useFactory: () => new ChatOpenAI({
        modelName: 'gpt-4o-mini',
        temperature: 0,
      }),
    },
    LangChainService,
  ],
  exports: ['CHAT_MODEL', LangChainService],
})
export class LangChainModule {}
```

---

## 2.2 核心抽象

### ChatModel

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const model = new ChatOpenAI({ modelName: 'gpt-4o-mini' });
const response = await model.invoke([
  new SystemMessage('你是一位前端专家'),
  new HumanMessage('解释 React Server Components'),
]);
```

### Prompt Templates

```typescript
import { ChatPromptTemplate } from '@langchain/core/prompts';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是{role}专家，使用{language}回答'],
  ['human', '{question}'],
]);

const chain = prompt.pipe(model);
const result = await chain.invoke({
  role: '前端',
  language: '中文',
  question: '什么是虚拟DOM？',
});
```

### LCEL (LangChain Expression Language)

核心范式：用 `.pipe()` 将组件串联成可执行链

```typescript
const chain = prompt
  .pipe(model)
  .pipe(new StringOutputParser());

// 支持流式
const stream = await chain.stream({ question: '...' });
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

---

## 2.3 Chain 模式

### 顺序链 (Sequential Chain)

```typescript
// 第一步：生成大纲
const outlineChain = outlinePrompt.pipe(model).pipe(parser);
// 第二步：基于大纲生成文章
const articleChain = articlePrompt.pipe(model).pipe(parser);

// 组合
const fullChain = RunnableSequence.from([
  outlineChain,
  (outline) => ({ outline, topic: '...' }),
  articleChain,
]);
```

### 并行链 (Parallel)

```typescript
import { RunnableParallel } from '@langchain/core/runnables';

const parallel = RunnableParallel.from({
  summary: summaryChain,
  keywords: keywordChain,
  sentiment: sentimentChain,
});

const result = await parallel.invoke({ text: '...' });
// { summary: '...', keywords: [...], sentiment: '...' }
```

---

## 2.4 Tool Use / Function Calling

### 定义工具

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const weatherTool = tool(
  async ({ city }) => {
    // 实际调用天气 API
    return `${city}今天晴，25°C`;
  },
  {
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    schema: z.object({
      city: z.string().describe('城市名称'),
    }),
  }
);
```

### 绑定工具到模型

```typescript
const modelWithTools = model.bindTools([weatherTool, searchTool]);
const response = await modelWithTools.invoke('北京今天天气怎么样？');

// 检查是否有 tool call
if (response.tool_calls?.length) {
  const toolCall = response.tool_calls[0];
  const result = await weatherTool.invoke(toolCall.args);
  // 将结果回传给模型...
}
```

### Tool Use 循环 (Agent 雏形)

```
用户问题 → LLM 判断是否需要工具
  → 需要: 调用工具 → 结果回传 LLM → 继续判断
  → 不需要: 直接回答
```

这就是 ReAct Agent 的核心循环，Phase 3 中 LangGraph 会将此标准化。

---

## 2.5 Output Parsers

### 结构化输出

```typescript
import { StructuredOutputParser } from 'langchain/output_parsers';

const parser = StructuredOutputParser.fromZod(
  z.object({
    title: z.string(),
    tags: z.array(z.string()),
    difficulty: z.enum(['easy', 'medium', 'hard']),
  })
);

const chain = prompt.pipe(model).pipe(parser);
// 返回类型安全的 JS 对象
```

### withStructuredOutput (推荐)

```typescript
const structuredModel = model.withStructuredOutput(
  z.object({
    answer: z.string(),
    confidence: z.number(),
    sources: z.array(z.string()),
  })
);
// 模型直接返回结构化对象，基于 Function Calling 实现
```

---

## 2.6 练习项目

### 项目: 智能客服助手 (带工具调用)

**目标**: 在 Phase 1 项目基础上增加工具调用能力

**功能要求**:
1. 集成 LangChain.js，使用 LCEL 构建 chain
2. 定义 3+ 个工具（查天气、查时间、搜索等）
3. 实现 Tool Use 循环：LLM 自主决定是否调用工具
4. 前端展示工具调用过程（调用了哪个工具、参数、结果）
5. 结构化输出解析

**技术要点**:
- NestJS: LangChainModule 封装模型和工具
- Zod schema 定义工具参数和输出格式
- React: 可视化工具调用链路（思考过程展示）
