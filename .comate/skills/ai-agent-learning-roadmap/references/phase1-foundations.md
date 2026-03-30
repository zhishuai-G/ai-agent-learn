# Phase 1: AI 基础与 LLM 核心概念

## 目录

- [1.1 LLM 核心概念](#11-llm-核心概念)
- [1.2 Prompt Engineering](#12-prompt-engineering)
- [1.3 OpenAI API 实战](#13-openai-api-实战)
- [1.4 流式输出与前端集成](#14-流式输出与前端集成)
- [1.5 练习项目](#15-练习项目)

---

## 1.1 LLM 核心概念

### 必须掌握的概念

- **Token**: LLM 处理文本的最小单位，中文约 1.5-2 token/字
- **Context Window**: 模型单次能处理的最大 token 数（GPT-4o: 128k, Claude: 200k）
- **Temperature**: 控制输出随机性，0=确定性，1=创造性
- **System/User/Assistant Message**: Chat Completion API 的三种角色
- **Embedding**: 文本向量化表示，用于语义搜索（RAG 基础）

### 主流模型对比

- **OpenAI GPT-4o/4o-mini**: 通用能力强，Function Calling 支持好
- **Anthropic Claude 3.5**: 长文本处理优秀，代码能力强
- **开源模型 (Llama 3, Qwen 2.5)**: 可本地部署，成本可控
- **国内模型 (通义千问, 智谱GLM)**: 中文场景友好，API 兼容 OpenAI 格式

### 推荐学习资源

- [OpenAI Cookbook](https://cookbook.openai.com/)
- [LangChain 概念文档](https://js.langchain.com/docs/concepts/)
- Andrej Karpathy: "Intro to LLMs" (YouTube)

---

## 1.2 Prompt Engineering

### 核心技巧

```
1. Role Setting (角色设定)
   "你是一位资深的前端架构师..."

2. Few-Shot (示例驱动)
   "输入: xxx → 输出: yyy
    输入: aaa → 输出: bbb
    输入: {用户输入} → 输出: "

3. Chain of Thought (思维链)
   "请一步步思考..."

4. Output Format Control (输出格式控制)
   "请以JSON格式返回，包含以下字段: ..."

5. Structured Prompts (结构化 Prompt)
   使用 XML 标签或 markdown 结构组织复杂 prompt
```

### 进阶模式

- **ReAct (Reasoning + Acting)**: Agent 的核心 prompt 模式
- **Self-Reflection**: 让 LLM 自我评估并改进
- **Prompt Chaining**: 将复杂任务拆分为多个 prompt 串联

---

## 1.3 OpenAI API 实战

### NestJS 后端集成

```typescript
// 安装依赖
// npm install openai

// src/llm/llm.service.ts
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async chat(messages: OpenAI.ChatCompletionMessageParam[]) {
    return this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });
  }

  // 流式输出
  async *chatStream(messages: OpenAI.ChatCompletionMessageParam[]) {
    const stream = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
    });
    for await (const chunk of stream) {
      yield chunk.choices[0]?.delta?.content || '';
    }
  }
}
```

### 关键配置

- API Key 管理: 使用 `@nestjs/config` + `.env`
- 模型选择: 开发用 `gpt-4o-mini`（便宜），生产按需选择
- 错误处理: rate limit 重试、token 超限处理、超时处理

---

## 1.4 流式输出与前端集成

### NestJS SSE 端点

```typescript
// src/chat/chat.controller.ts
@Controller('chat')
export class ChatController {
  @Sse('stream')
  chatStream(@Query('message') message: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      // 调用 LLM 流式接口，逐 chunk 推送
    });
  }
}
```

### React 前端消费 SSE

```typescript
// 使用 EventSource 或 fetch + ReadableStream
const response = await fetch('/api/chat/stream', {
  method: 'POST',
  body: JSON.stringify({ message }),
});
const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  setContent(prev => prev + text);
}
```

### 推荐库

- `ai` (Vercel AI SDK): 提供 `useChat` hook，开箱即用的流式处理
- `eventsource-parser`: SSE 解析

---

## 1.5 练习项目

### 项目: 智能命令行助手

**目标**: 用 NestJS + React 构建一个基础聊天应用

**功能要求**:
1. 用户输入问题，调用 LLM 获取回答
2. 支持流式输出（打字机效果）
3. 支持 System Prompt 自定义
4. 对话历史管理（Context Window 内）

**技术要点**:
- NestJS: Controller → Service → OpenAI SDK
- React: 消息列表 + 输入框 + 流式渲染
- 状态管理: React useState/useReducer 管理对话历史
