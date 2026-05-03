# Phase 7: 全栈 AI 应用工程化

## 目录

- [7.1 AI Chat UI 组件体系](#71-ai-chat-ui-组件体系)
- [7.2 Vercel AI SDK 集成](#72-vercel-ai-sdk-集成)
- [7.3 NestJS 后端架构](#73-nestjs-后端架构)
- [7.4 生产化关键问题](#74-生产化关键问题)
- [7.5 可观测性与调试](#75-可观测性与调试)
- [7.6 毕业项目](#76-毕业项目)

---

## 7.1 AI Chat UI 组件体系

### 核心组件

```
ChatContainer
├── MessageList
│   ├── UserMessage
│   ├── AssistantMessage (支持 Markdown 渲染)
│   ├── ToolCallMessage (工具调用展示)
│   └── ThinkingIndicator (思考中状态)
├── InputArea
│   ├── TextInput (支持多行)
│   ├── FileUpload (文档/图片上传)
│   └── SendButton
└── Sidebar
    ├── ConversationList (历史对话)
    └── ModelSelector
```

### 关键 React 模式

```typescript
// 流式消息渲染
function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ node, inline, className, children, ...props }) => {
            // 代码高亮 (react-syntax-highlighter)
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// 自动滚动到底部
function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dep]);
  return ref;
}
```

### 推荐 UI 库

- **shadcn/ui**: 高度可定制的组件库，适合自建 Chat UI
- **react-markdown + remark-gfm**: Markdown 渲染
- **react-syntax-highlighter**: 代码块高亮
- **framer-motion**: 消息出现动画

---

## 7.2 Vercel AI SDK 集成

### 核心能力

```typescript
// React 端 - useChat hook
import { useChat } from 'ai/react';

function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

### NestJS 端适配

```typescript
// Vercel AI SDK 服务端 (兼容 NestJS)
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

@Controller('api')
export class ChatController {
  @Post('chat')
  async chat(@Req() req: Request, @Res() res: Response) {
    const { messages } = await req.json();
    const result = streamText({
      model: openai('gpt-4o-mini'),
      messages,
    });
    return result.toDataStreamResponse();
  }
}
```

---

## 7.3 NestJS 后端架构

### 推荐模块结构

```
src/
├── app.module.ts
├── chat/                    # 对话管理
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   └── chat.gateway.ts     # WebSocket
├── agent/                   # Agent 逻辑
│   ├── agent.module.ts
│   ├── agent.service.ts     # LangGraph Agent
│   └── tools/               # 工具定义
│       ├── search.tool.ts
│       ├── calculator.tool.ts
│       └── index.ts
├── rag/                     # RAG 管线
│   ├── rag.module.ts
│   ├── rag.service.ts
│   ├── document.service.ts  # 文档处理
│   └── vector-store.service.ts
├── llm/                     # LLM 封装
│   ├── llm.module.ts
│   └── llm.service.ts
└── common/
    ├── config/
    └── guards/
```

### WebSocket 实时通信

```typescript
@WebSocketGateway({ cors: true })
export class ChatGateway {
  @SubscribeMessage('chat')
  async handleChat(
    @MessageBody() data: { message: string; threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const stream = await this.agentService.stream(data);
    for await (const event of stream) {
      client.emit('agent-event', {
        type: event.type, // 'thinking' | 'tool_call' | 'message' | 'done'
        data: event.data,
      });
    }
  }
}
```

---

## 7.4 生产化关键问题

### Token 用量管理

- 对话历史裁剪：保留最近 N 轮 + 摘要
- Token 计数：`tiktoken` 或 `gpt-tokenizer`
- 预算控制：按用户/租户设置 token 上限

### 错误处理

```typescript
// 重试策略
import { withRetry } from '@langchain/core/utils/async_caller';

// 降级策略
try {
  return await gpt4oChain.invoke(input);
} catch (e) {
  if (isRateLimitError(e)) {
    return await gpt4oMiniChain.invoke(input); // 降级到更便宜的模型
  }
  throw e;
}
```

### 安全

- Prompt 注入防护：输入过滤 + system prompt 加固
- 输出过滤：敏感内容检测
- API Key 安全：环境变量 + 密钥轮换

### 缓存

- 语义缓存：相似问题直接返回缓存结果
- Embedding 缓存：避免重复向量化
- LangChain 内置：`InMemoryCache` / `RedisCache`

---

## 7.5 可观测性与调试

### LangSmith (推荐)

```typescript
// .env
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your-key
LANGCHAIN_PROJECT=my-agent

// 自动追踪所有 LangChain/LangGraph 调用
// 可视化查看：每步输入/输出、token 用量、延迟
```

### 替代方案

- **Langfuse**: 开源可自托管的 LLM 可观测平台
- **Phoenix (Arize)**: 开源 LLM tracing
- 自建日志：结构化日志 + OpenTelemetry

---

## 7.6 毕业项目

### 项目: AI 全栈工作台

**目标**: 构建一个生产级 AI Agent 全栈应用

**核心功能**:
1. **多模型支持**: GPT-4o / Claude / 开源模型切换
2. **知识库管理**: 上传文档，构建 RAG 知识库
3. **自定义 Agent**: 用户可配置 Agent 的工具和 prompt
4. **Multi-Agent 工作流**: 可视化编排多个 Agent 协作
5. **对话管理**: 多会话、历史记录、分享
7. **实时可视化**: Agent 执行过程实时展示

**技术栈整合**:
- **前端**: React + shadcn/ui + Vercel AI SDK + ReactFlow (图可视化)
- **后端**: NestJS + LangGraph + LangChain.js
- **存储**: PostgreSQL (业务数据) + Pgvector (向量) + Redis (缓存)
- **可观测**: LangSmith / Langfuse
- **部署**: Docker Compose

**项目结构**:
```
ai-langgraph/
├── apps/
│   ├── web/          # React 前端
│   └── server/       # NestJS 后端
├── packages/
│   └── shared/       # 共享类型定义
├── docker-compose.yml
└── turbo.json        # Turborepo monorepo
```
