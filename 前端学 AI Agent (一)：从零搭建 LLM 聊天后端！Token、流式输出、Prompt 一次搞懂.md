这个系列会记录一个有 React + NestJS 经验的前端开发者，从零开始学习 AI Agent 的全过程。第一篇，我们先搞清楚几个最基本的问题：

**LLM 到底怎么用？Token 是什么？流式输出是怎么回事？怎么让 AI "记住"上下文？**

然后，我们会用 NestJS 搭建一个真正能跑的聊天后端——支持普通对话和流式输出（打字机效果），并用 Swagger 管理所有接口。

## 一、先搞懂几个核心概念

在写代码之前，有几个概念必须搞清楚，否则后面会一头雾水。

### Token —— LLM 的"最小阅读单位"

LLM 不像人类一样"读字"，它读的是 **Token**。你可以把 Token 理解为"词块"：

+ 英文中，`hello` 是 1 个 token，`unbelievable` 可能被拆成 `un` + `believ` + `able` = 3 个 token
+ 中文中，1 个汉字大约 = 1.5~2 个 token

为什么要关心这个？因为 **Token 直接决定了两件事**：

1. **花多少钱**：API 按 token 计费，输入 + 输出的 token 都算钱
2. **能塞多少上下文**：每个模型有 Context Window 上限（GPT-4o 是 128k token，Claude 是 200k），超了就"读不下"

### Temperature —— 控制 AI 的"创造力"

`temperature` 是一个 0~1 的参数：

+ **0** = 确定性模式：每次问同样的问题，答案几乎一样（适合代码生成、数据提取）
+ **1** = 创造性模式：答案更丰富、更随机（适合写作、头脑风暴）

我们的项目用 **0.7**，算是"创造力和稳定性之间的平衡点"。

### 三种消息角色 —— 给 AI 的"剧本"

调用 Chat API 时，消息分三种角色：

```
system:   "你是一位资深的前端架构师..."   ← 角色设定，AI 的"人设"
user:     "什么是 Token？"              ← 用户说的话
assistant: "Token 是 LLM 处理文本的..."   ← AI 之前的回答
```

这三种角色的组合就是一段完整的对话。**system 消息就像导演给演员的剧本**——它不会出现在对话中，但始终影响 AI 的回答风格。

### 主流模型速览

| 模型 | 特点 | 适合场景 |
| --- | --- | --- |
| GPT-4o / 4o-mini | 通用能力强，Function Calling 支持好 | 通用开发首选 |
| Claude 3.5 | 长文本处理优秀，代码能力强 | 代码辅助、长文档 |
| 通义千问 / 智谱 GLM | 中文友好，API 兼容 OpenAI 格式 | 国内项目 |
| Llama 3 / Qwen 2.5 | 开源可本地部署 | 隐私敏感 / 成本控制 |

开发阶段推荐用 **gpt-4o-mini**——便宜，能力够用。

## 二、Prompt Engineering：不是玄学，是工程

很多人觉得 Prompt 就是"跟 AI 聊天"，其实不是。好的 Prompt 是有套路的：

### 五个核心技巧

```
1. Role Setting（角色设定）
   "你是一位资深的前端架构师..."

2. Few-Shot（示例驱动）
   "输入: xxx → 输出: yyy
    输入: aaa → 输出: bbb
    输入: {用户输入} → 输出: "

3. Chain of Thought（思维链）
   "请一步步思考..."

4. Output Format Control（输出格式控制）
   "请以 JSON 格式返回，包含以下字段: ..."

5. Structured Prompts（结构化 Prompt）
   使用 XML 标签或 Markdown 结构组织复杂 Prompt
```

其中 **Few-Shot** 和 **思维链** 是最常用的两个。Few-Shot 就是"先给几个例子让 AI 学着做"，思维链就是"让 AI 先想再答，别直接蒙"。

### 进阶模式（后面阶段会用到）

+ **ReAct**（Reasoning + Acting）：Agent 的核心模式——先推理，再行动，再观察结果，再推理...
+ **Self-Reflection**：让 AI 自己评估答案质量并改进
+ **Prompt Chaining**：把复杂任务拆成多个 Prompt 串联执行

这些在后面 LangGraph Agent 阶段会深入使用，现在知道有这回事就行。

## 三、动手：搭建 NestJS 聊天后端

概念聊够了，开始写代码。

### 项目结构

```
server/
├── .env                           # 环境变量（API Key 等）
├── src/
│   ├── main.ts                    # 入口：Swagger + 全局管道 / 拦截器 / 过滤器
│   ├── app.module.ts              # 根模块
│   ├── llm/                       # LLM 服务层
│   │   ├── llm.module.ts
│   │   └── llm.service.ts         # 封装 OpenAI SDK
│   ├── chat/                      # 聊天业务层
│   │   ├── chat.module.ts
│   │   ├── chat.controller.ts     # API 端点
│   │   ├── chat.service.ts        # 对话逻辑
│   │   └── dto/                   # 请求/响应 DTO
│   │       ├── chat-request.dto.ts
│   │       └── chat-reply.dto.ts
│   └── common/                    # 公共层
│       ├── dto/
│       │   └── api-response.dto.ts       # 统一响应格式
│       ├── interceptors/
│       │   └── transform.interceptor.ts  # 响应包装拦截器
│       └── filters/
│           └── all-exceptions.filter.ts  # 全局异常过滤器
```

分层很清晰：**Controller 接请求 → Service 处理逻辑 → LlmService 调用 OpenAI**。

### 3.1 环境变量配置

```bash
# .env
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

如果用国内代理（比如通义千问兼容 OpenAI 格式的），改一下 `OPENAI_BASE_URL` 就行，代码不用动。

NestJS 通过 `@nestjs/config` 的 `ConfigModule` 加载 `.env`：

```typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),  // 全局可用
    ChatModule,
  ],
})
export class AppModule {}
```

### 3.2 LLM Service —— 封装 OpenAI SDK

这是整个项目和 AI 打交道的唯一入口。它做两件事：**普通调用**和**流式调用**。

```typescript
// src/llm/llm.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private client: OpenAI;
  private model: string;

  constructor(private configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
    });
    this.model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
  }

  // 普通聊天 —— 一次性返回完整结果
  async chat(messages: OpenAI.ChatCompletionMessageParam[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content || '';
  }

  // 流式聊天 —— 逐 token 返回（AsyncGenerator）
  async *chatStream(
    messages: OpenAI.ChatCompletionMessageParam[],
  ): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
      stream: true,     // 关键！加上这个参数，API 返回的就是异步迭代器
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;  // 每收到一小块文本就立刻吐出去
      }
    }
  }
}
```

**两种调用方式的区别**：

```plain
普通调用：
  请求 → 等........等........等 → 一次性拿到完整回答
  用户体验：转圈圈......（几秒后突然出来一大段文字）

流式调用：
  请求 → 拿到第1个token → 拿到第2个token → ... → 拿到最后一个token
  用户体验：文字一个一个蹦出来（打字机效果）
```

流式的核心是 `stream: true` 这个参数。加了之后，`create()` 返回的不再是完整响应，而是一个 **异步迭代器**——用 `for await...of` 遍历，每个 chunk 里的 `delta.content` 就是一小段增量文本。

`async *chatStream()` 是一个 **AsyncGenerator**——你可以理解为"一个能暂停、能恢复的异步函数"。每次 `yield` 就吐出一小块文本，调用方用 `for await...of` 消费。

### 3.3 Chat Service —— 对话逻辑

Chat Service 负责**组装消息列表**，然后交给 LlmService 去调用 API。

```typescript
// src/chat/chat.service.ts
@Injectable()
export class ChatService {
  constructor(private readonly llmService: LlmService) {}

  private buildMessages(
    message: string,
    history: OpenAI.ChatCompletionMessageParam[] = [],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // 1. System Prompt（角色设定）放最前面
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    // 2. 对话历史
    messages.push(...history);
    // 3. 当前用户消息
    messages.push({ role: 'user', content: message });

    return messages;
  }

  async chat(message, history?, systemPrompt?): Promise<string> {
    const messages = this.buildMessages(message, history, systemPrompt);
    return this.llmService.chat(messages);
  }

  async *chatStream(message, history?, systemPrompt?): AsyncGenerator<string> {
    const messages = this.buildMessages(message, history, systemPrompt);
    yield* this.llmService.chatStream(messages);
  }
}
```

**为什么要手动拼消息列表？** 因为 OpenAI API 是**无状态的**——它不会帮你记住之前的对话。每次请求你都得把完整的对话历史传过去。消息拼接的顺序是：

```plain
[system] "你是一位前端架构师..."      ← 角色设定（可选）
[user]   "你好"                      ← 历史对话
[assistant] "你好！有什么可以帮你的？"  ← 历史对话
[user]   "什么是 Token？"            ← 当前问题
```

这就是"上下文"的本质——不是 AI 有记忆，而是你每次都把聊天记录全发过去。所以 **Context Window 很重要**：历史太长就塞不下了。

### 3.4 Chat Controller —— API 端点

两个接口：普通聊天和流式聊天。

```typescript
// src/chat/chat.controller.ts
@ApiTags('Chat - 聊天')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // POST /chat —— 普通聊天，一次性返回
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '普通聊天' })
  async chat(@Body() body: ChatRequestDto) {
    const { message, history, systemPrompt } = body;
    const reply = await this.chatService.chat(message, history, systemPrompt);
    return { reply };
  }

  // POST /chat/stream —— 流式聊天（SSE）
  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '流式聊天 (SSE)' })
  chatStream(@Body() body: ChatRequestDto): Observable<MessageEvent> {
    const { message, history, systemPrompt } = body;

    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          const stream = this.chatService.chatStream(message, history, systemPrompt);
          for await (const chunk of stream) {
            subscriber.next({
              data: JSON.stringify({ content: chunk }),
            } as MessageEvent);
          }
          // 发送结束信号
          subscriber.next({
            data: JSON.stringify({ content: '', done: true }),
          } as MessageEvent);
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
    });
  }
}
```

流式接口的关键在于 **SSE（Server-Sent Events）**。NestJS 的 SSE 本质上就是返回一个 `Observable<MessageEvent>`，框架会自动设置 `Content-Type: text/event-stream`，然后每次 `subscriber.next()` 就推送一条数据给前端。

一图看懂流式请求的完整链路：

```plain
前端 fetch('/chat/stream', { body: { message: '你好' } })
  ↓
ChatController.chatStream()
  ↓ 创建 Observable
ChatService.chatStream()
  ↓ yield* 代理
LlmService.chatStream()
  ↓ stream: true
OpenAI API 流式返回
  ↓ for await (const chunk of stream)
yield "你"  →  subscriber.next({ data: '{"content":"你"}' })  →  SSE 推送给前端
yield "好"  →  subscriber.next({ data: '{"content":"好"}' })  →  SSE 推送给前端
yield "！"  →  subscriber.next({ data: '{"content":"！"}' })  →  SSE 推送给前端
            →  subscriber.next({ data: '{"done":true}' })     →  结束信号
            →  subscriber.complete()
```

前端拿到后只需要逐条拼接 content，就实现了打字机效果。

## 四、工程化：统一响应格式 + Swagger

裸奔的接口不可维护。我们加了三层保障：

### 4.1 统一响应格式

所有接口的返回值都被自动包装成同一结构：

```json
// 成功
{ "code": 200, "message": "success", "data": { "reply": "Token 是 LLM 的最小处理单位..." } }

// 失败（比如参数缺失）
{ "code": 400, "message": "message 不能为空", "data": null }

// 服务器错误
{ "code": 500, "message": "服务器内部错误", "data": null }
```

实现方式是**全局拦截器 + 全局异常过滤器**：

```typescript
// 拦截器：包装成功响应
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((data) => ApiResponse.success(data)));
  }
}

// 异常过滤器：包装错误响应
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // ... 提取状态码和错误信息
    response.status(status).json(ApiResponse.error(message, status));
  }
}
```

Controller 不需要手动包装，只管返回业务数据，拦截器自动帮你套上 `{ code, message, data }` 的壳。

### 4.2 请求参数校验

用 `class-validator` + `ValidationPipe`，参数不合法时自动返回 400：

```typescript
// src/chat/dto/chat-request.dto.ts
export class ChatRequestDto {
  @ApiProperty({ description: '用户消息', example: '什么是 LLM？' })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({ description: '对话历史' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @ApiPropertyOptional({ description: '系统提示词（角色设定）' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}
```

### 4.3 Swagger 文档

在 `main.ts` 中配置，启动后访问 `http://localhost:3000/api-docs`：

```typescript
const config = new DocumentBuilder()
  .setTitle('AI Agent Learn API')
  .setDescription('Phase 1 - 基础聊天应用 API 文档')
  .setVersion('1.0')
  .addTag('Chat - 聊天', '聊天相关接口（普通 + 流式）')
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api-docs', app, document);
```

每个接口的参数说明、示例值、状态码都自动从 DTO 的装饰器中提取，不用额外维护文档。

## 五、跑起来试试

### 启动

```bash
cd server
npm run start:dev
```

看到这两行就说明成功了：

```
Server running on http://localhost:3000
Swagger docs: http://localhost:3000/api-docs
```

### 测试普通聊天

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "什么是 Token？用一句话解释"}'
```

返回：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "reply": "Token 是 LLM 处理文本的最小单位，相当于模型眼中的"词块"。"
  }
}
```

### 测试流式聊天

```bash
curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "用简单的语言解释什么是 Transformer 架构", "systemPrompt": "你是一位擅长打比方的老师"}'
```

你会看到数据一条一条地蹦出来（SSE 格式）：

```
data: {"content":"Transformer"}
data: {"content":" 就像"}
data: {"content":"一个"}
data: {"content":"超级"}
data: {"content":"高效的"}
data: {"content":"翻译团队"}
...
data: {"content":"","done":true}
```

### 测试参数校验

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{}'
```

返回：

```json
{
  "code": 400,
  "message": "message 不能为空",
  "data": null
}
```

## 六、小结

| 概念 | 作用 | 类比 |
| --- | --- | --- |
| Token | LLM 的最小处理单位 | 英语单词 / 中文词块 |
| Context Window | 模型单次能读多少 token | 书桌大小 |
| Temperature | 控制回答的随机性 | 创造力旋钮 |
| System Prompt | 给 AI 设定角色和行为规则 | 导演给演员的剧本 |
| 对话历史 | 把之前的对话全发过去 | 给 AI 看聊天记录 |
| `stream: true` | 让 API 逐 token 返回 | 边写边传，不等写完 |
| SSE | 服务端向前端推送数据流 | 直播 vs 点播 |
| AsyncGenerator | JS 中的异步生成器 | 一个能暂停的水龙头 |

**核心要点**：

1. **LLM 是无状态的**：它不记得上一轮对话，每次都要把历史全传过去
2. **流式输出的本质**：`stream: true` → AsyncGenerator → Observable → SSE → 前端逐条拼接
3. **工程化很重要**：统一响应格式、参数校验、Swagger 文档——这些不是锦上添花，是生产环境的基本要求
4. **Token 决定成本和容量**：开发用 gpt-4o-mini 省钱，对话历史要控制长度

下一篇，我们将进入 **Phase 2：LangChain.js**——不再直接调用 OpenAI SDK，而是用 LangChain 的 LCEL 表达式语言来编排调用链，并学习 Tool Use（让 AI 调用外部工具）。
