这个系列记录一个有 React + NestJS 经验的前端开发者，从零学习 AI Agent 的全过程。上一篇我们搭了一个基础聊天后端，这一篇进入 **Phase 2**——

**不再直接调 OpenAI SDK，而是用 LangChain.js 的 LCEL 链来编排调用；让 AI 自己决定"要不要调工具"，实现 Tool Use 循环；前端实时展示工具调用链路。**

## 一、从 OpenAI SDK 到 LangChain.js：为什么要加一层？

Phase 1 我们直接用 `openai` 包调 `chat.completions.create()`，能跑，但有个问题：**所有逻辑都是手写的**——拼消息、调 API、解析结果、处理流式输出，全部手动来。

LangChain.js 的价值在于：**它把 LLM 应用中反复出现的模式抽象成了标准组件**。

```
Phase 1（手动挡）：
  手动拼 messages → 手动调 OpenAI API → 手动解析 response

Phase 2（LangChain）：
  PromptTemplate → ChatModel → OutputParser
  用 .pipe() 一行串联，还能自动处理 Tool Use 循环
```

### 包结构

LangChain.js 不是一个大包，而是拆成了多个精确安装的模块：

```
@langchain/core        - 核心抽象（Runnable、消息类型、工具定义）
@langchain/openai      - OpenAI 兼容模型（也支持 OneAPI 代理）
langchain              - 高层 chain/agent（按需用）
zod                    - 参数 schema 定义（LangChain 工具必须用）
```

安装：

```bash
npm install @langchain/core @langchain/openai langchain zod
```

## 二、核心概念：LCEL、Tool Use、结构化输出

### LCEL（LangChain Expression Language）—— 像搭积木一样组合 AI 调用

LCEL 的核心思想：**每个组件都是一个 Runnable，用 `.pipe()` 串联成一条可执行的链**。

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '你是{role}专家，使用{language}回答'],
  ['human', '{question}'],
]);

const model = new ChatOpenAI({ modelName: 'GLM-5' });

// 核心！用 .pipe() 串联：Prompt → Model → Parser
const chain = prompt.pipe(model).pipe(new StringOutputParser());

const result = await chain.invoke({
  role: '前端',
  language: '中文',
  question: '什么是虚拟 DOM？',
});
```

这段代码做了三件事：
1. `prompt` 把变量填入模板，生成完整的消息列表
2. `model` 拿到消息列表，调 LLM API
3. `StringOutputParser` 把 AI 返回的 `AIMessage` 对象提取成纯文本字符串

这三步用 `.pipe()` 一行串联。和 Phase 1 手动写 `chat.completions.create()` 比，**代码更声明式、更容易组合**。

### Tool Use —— 让 AI "自己决定"调什么 API

这是 Phase 2 最重要的概念。

Phase 1 的 AI 只能聊天——你问什么，它从自己的知识里编答案。**但如果你问"北京今天天气怎么样"，它只能瞎猜**，因为它没有实时数据。

Tool Use 的思路是：**给 AI 一套"工具菜单"，让它自己决定要不要用、用哪个**。

```
你："北京今天天气怎么样？"

AI（内心独白）："这个问题需要实时天气数据，我自己不知道。
               但我有一个 get_weather 工具可以查！"

AI → 调用 get_weather({ city: "北京" })
工具返回 → "北京：晴天，28°C，湿度 45%"
AI → "北京今天天气不错，晴天，温度 28°C..."
```

关键：**AI 不是被动执行工具，而是主动判断是否需要工具**。如果你问的是"什么是 Token"，它不会调任何工具，直接用自己的知识回答。

这就是 **Function Calling** 的本质——模型在回复中不返回文字，而是返回一个 `tool_calls` 数组，告诉你"我想调这个函数，参数是这些"。

### Tool Use 循环 —— Agent 的雏形

一次工具调用可能不够。AI 可能需要**先查时间、再查天气、最后综合回答**。所以 Tool Use 不是"调一次就完"，而是一个循环：

```
用户问题 → LLM（带工具菜单）
  → 有 tool_calls?
    → 是：执行工具 → 把结果喂回 LLM → 再次判断
    → 否：直接回答（循环结束）
```

这就是 **ReAct（Reasoning + Acting）** 模式的核心循环——先推理、再行动、看结果、再推理。Phase 3 的 LangGraph 会把这个循环标准化成状态图，但核心逻辑就是这个 while 循环。

## 三、动手：用 LangChain.js 升级后端

### 项目结构（Phase 2 新增部分）

```
server/src/
├── langchain/                     # 🆕 LangChain 集成层
│   ├── langchain.module.ts        #   模块定义
│   ├── langchain.service.ts       #   封装 ChatOpenAI 模型 + LCEL Chain
│   └── tools/                     #   工具定义
│       ├── index.ts               #     统一导出
│       ├── weather.tool.ts        #     天气查询（wttr.in API）
│       ├── time.tool.ts           #     时间查询（worldtimeapi.org）
│       └── search.tool.ts         #     百科搜索（Wikipedia API）
├── agent/                         # 🆕 智能助手（Tool Use）
│   ├── agent.module.ts            #   模块定义
│   ├── agent.controller.ts        #   API 端点：POST /agent/chat
│   ├── agent.service.ts           #   Tool Use 循环核心逻辑
│   └── dto/
│       └── agent-request.dto.ts   #   请求 DTO
├── chat/                          # Phase 1 保留
├── llm/                           # Phase 1 保留
└── common/                        # 公共层
```

Phase 1 的代码完全保留（`/chat` 接口照常用），Phase 2 新增 `langchain/` 和 `agent/` 两个模块。

### 3.1 LangChain Service —— 封装 ChatOpenAI

```typescript
// src/langchain/langchain.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

@Injectable()
export class LangChainService {
  private model: ChatOpenAI;

  constructor(private configService: ConfigService) {
    this.model = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
      modelName: this.configService.get<string>('OPENAI_MODEL') || 'GLM-5',
      temperature: 0.7,
    });
  }

  // 获取模型实例（用于 bindTools、invoke 等）
  getModel(): ChatOpenAI {
    return this.model;
  }

  // LCEL Chain 示例：Prompt → Model → Parser
  buildChain(systemTemplate: string) {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemTemplate],
      ['human', '{input}'],
    ]);
    return prompt.pipe(this.model).pipe(new StringOutputParser());
  }
}
```

**和 Phase 1 的 `LlmService` 对比**：

```plain
Phase 1 (LlmService):
  this.client = new OpenAI({ apiKey, baseURL })
  this.client.chat.completions.create({ model, messages })

Phase 2 (LangChainService):
  this.model = new ChatOpenAI({ openAIApiKey, configuration: { baseURL } })
  this.model.invoke(messages)  或  this.model.bindTools(tools).invoke(messages)
```

`ChatOpenAI` 底层还是调 OpenAI 格式的 API，但它实现了 LangChain 的 `Runnable` 接口——可以 `.pipe()`、`.bindTools()`、`.withStructuredOutput()`，**可组合性比原始 SDK 强很多**。

通过 OneAPI 代理，`ChatOpenAI` 同样可以调 GLM、Claude、Gemini 等模型，只需要设 `configuration.baseURL`。

### 3.2 定义工具 —— 用 Zod Schema + 真实 API

工具定义是 Phase 2 最有意思的部分。每个工具需要三样东西：

1. **执行函数**：工具被调用时实际干什么（调真实的开源 API）
2. **name + description**：LLM 靠这个决定"什么时候该用这个工具"
3. **schema**：用 Zod 定义参数类型，LLM 会严格按 schema 生成调用参数

我们用了三个免费开源 API，**不需要注册、不需要 API Key**：

| 工具 | API | 说明 |
| --- | --- | --- |
| 天气查询 | [wttr.in](https://wttr.in) | 开源天气服务，支持中文城市名、JSON 输出 |
| 时间查询 | [worldtimeapi.org](http://worldtimeapi.org) | 开源时间服务，支持全球标准时区 |
| 百科搜索 | [Wikipedia REST API](https://www.mediawiki.org/wiki/REST_API) | 维基百科 API，中英文双语支持 |

#### 天气工具（wttr.in）

```typescript
// src/langchain/tools/weather.tool.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const weatherTool = tool(
  async ({ city }: { city: string }) => {
    try {
      // wttr.in 的 JSON 接口：format=j1 返回结构化天气数据，lang=zh 返回中文描述
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const current = data.current_condition?.[0];
      if (!current) return `未能获取 ${city} 的天气数据`;

      // 中文天气描述在 lang_zh 字段中
      const desc = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value;

      return [
        `${city}当前天气：${desc}`,
        `温度：${current.temp_C}°C（体感 ${current.FeelsLikeC}°C）`,
        `湿度：${current.humidity}%`,
        `风：${current.winddir16Point} ${current.windspeedKmph} km/h`,
        `能见度：${current.visibility} km`,
        `紫外线指数：${current.uvIndex}`,
      ].join('，');
    } catch (error) {
      return `获取 ${city} 天气失败：${error instanceof Error ? error.message : error}`;
    }
  },
  {
    name: 'get_weather',
    description: '获取指定城市的实时天气信息，包括温度、体感温度、湿度、风向风速、能见度等。支持全球城市。',
    schema: z.object({
      city: z.string().describe('城市名称，支持中文或英文，例如：北京、上海、Tokyo、New York'),
    }),
  },
);
```

**为什么选 wttr.in？** 因为它是开源的（[chubin/wttr.in](https://github.com/chubin/wttr.in)），支持中文城市名查询和中文天气描述（`lang=zh`），JSON 格式的接口（`format=j1`）返回的数据非常结构化。最关键的是——**不需要 API Key**，直接 `fetch` 就能用。

注意两个工程细节：
- `AbortSignal.timeout(10000)`：10 秒超时，防止外部 API 卡住拖垮整个请求
- `encodeURIComponent(city)`：城市名可能是中文，必须 URL 编码

**Zod 在这里的作用**：

```typescript
schema: z.object({
  city: z.string().describe('城市名称，支持中文或英文，例如：北京、上海'),
})
```

这段 Zod schema 会被 LangChain 自动转换成 JSON Schema，发送给 LLM。LLM 看到的是：

```json
{
  "name": "get_weather",
  "description": "获取指定城市的实时天气信息...",
  "parameters": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "description": "城市名称，支持中文或英文，例如：北京、上海" }
    },
    "required": ["city"]
  }
}
```

所以 **description 写得好不好，直接决定 LLM 会不会正确使用这个工具**。这不是给人看的文档，是给 AI 看的说明书。

#### 时间工具（worldtimeapi.org）

```typescript
// src/langchain/tools/time.tool.ts
export const timeTool = tool(
  async ({ timezone }: { timezone?: string }) => {
    const tz = timezone || 'Asia/Shanghai';
    try {
      // worldtimeapi.org 返回指定时区的精确时间
      const res = await fetch(
        `http://worldtimeapi.org/api/timezone/${tz}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const dt = new Date(data.datetime);
      const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
      const formatted = dt.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });

      return `时区：${data.timezone}（UTC${data.utc_offset}），当前时间：${formatted} ${weekdays[data.day_of_week]}`;
    } catch {
      // API 不可用时降级到 Node.js 本地时间
      const formatted = new Date().toLocaleString('zh-CN', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      return `当前时间（${tz}）：${formatted}（由本地系统时钟提供）`;
    }
  },
  {
    name: 'get_current_time',
    description: '获取当前的日期和时间。可以指定时区来查询世界各地的时间。',
    schema: z.object({
      timezone: z.string().optional()
        .describe('IANA 时区名称，如 Asia/Shanghai、America/New_York。不传默认中国时间'),
    }),
  },
);
```

这里有一个**降级策略**：如果 worldtimeapi.org 挂了（开源服务难免偶尔不稳定），自动回退到 Node.js 的 `Date` + `Intl` API 获取本地时间。**外部 API 调用要永远做好兜底方案**。

#### 搜索工具（Wikipedia API）

```typescript
// src/langchain/tools/search.tool.ts
export const searchTool = tool(
  async ({ query }: { query: string }) => {
    // 搜索策略：先试中文维基精确匹配 → 中文维基搜索 → 英文维基兜底
    const zhSummary = await getWikiSummary(query, 'zh');
    if (zhSummary) return zhSummary;

    const zhSearch = await searchWiki(query, 'zh');
    if (zhSearch) return zhSearch;

    const enSummary = await getWikiSummary(query, 'en');
    if (enSummary) return enSummary;

    const enSearch = await searchWiki(query, 'en');
    if (enSearch) return enSearch;

    return `未找到与"${query}"相关的信息。建议尝试更通用或更具体的关键词。`;
  },
  {
    name: 'web_search',
    description: '搜索百科知识，可以查询技术概念、人物、事件、地理等各类信息。数据来源为维基百科。',
    schema: z.object({
      query: z.string().describe('搜索关键词或主题名称，例如：React、TypeScript、人工智能'),
    }),
  },
);
```

其中 `getWikiSummary` 和 `searchWiki` 是两个辅助函数：

```typescript
// 从维基百科获取页面摘要
async function getWikiSummary(query: string, lang: 'zh' | 'en'): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'AIAgentLearn/1.0 (learning project)' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.type === 'standard' && data.extract ? `【${data.title}】${data.extract}` : null;
  } catch { return null; }
}

// 在维基百科中搜索相关条目
async function searchWiki(query: string, lang: 'zh' | 'en', limit = 3): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'query', list: 'search', srsearch: query,
      format: 'json', utf8: '1', srlimit: String(limit),
    });
    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?${params}`,
      { signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'AIAgentLearn/1.0 (learning project)' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.query?.search;
    if (!results?.length) return null;

    // 获取搜索结果的摘要
    const summaries: string[] = [];
    for (const item of results) {
      const summary = await getWikiSummary(item.title, lang);
      summaries.push(summary || `【${item.title}】${item.snippet.replace(/<[^>]*>/g, '')}`);
    }
    return summaries.join('\n\n');
  } catch { return null; }
}
```

搜索策略是**逐级降级**：中文精确 → 中文搜索 → 英文精确 → 英文搜索。这样中英文关键词都能覆盖。

注意 Wikipedia API 要求设置 `User-Agent` 请求头，否则可能返回 403。这是维基百科的礼貌约定——**调用公共 API 时标明身份是好习惯**。

三个工具统一导出：

```typescript
// src/langchain/tools/index.ts
export { weatherTool } from './weather.tool';
export { timeTool } from './time.tool';
export { searchTool } from './search.tool';
```

### 3.3 Agent Service —— Tool Use 循环（核心！）

这是整个 Phase 2 最关键的代码。它实现了"LLM 自主决定是否调用工具"的循环。

```typescript
// src/agent/agent.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '../langchain/langchain.service';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { weatherTool, timeTool, searchTool } from '../langchain/tools';

// SSE 事件类型 —— 前端靠 type 字段区分不同事件
export interface AgentEvent {
  type: 'tool_call' | 'tool_result' | 'content' | 'done' | 'error';
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
  result?: string;
  content?: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private tools = [weatherTool, timeTool, searchTool];
  private toolMap = Object.fromEntries(this.tools.map((t) => [t.name, t]));

  constructor(private readonly langchainService: LangChainService) {}

  async *chat(
    message: string,
    history: Array<{ role: string; content: string }> = [],
    systemPrompt?: string,
  ): AsyncGenerator<AgentEvent> {
    const model = this.langchainService.getModel();

    // ⭐ 关键：bindTools 把工具菜单告诉模型
    const modelWithTools = model.bindTools(this.tools);

    // 构建 LangChain 消息列表
    const messages: BaseMessage[] = [];
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    for (const msg of history) {
      if (msg.role === 'user') messages.push(new HumanMessage(msg.content));
      else if (msg.role === 'assistant') messages.push(new AIMessage(msg.content));
    }
    messages.push(new HumanMessage(message));

    // ⭐ Tool Use 循环
    const MAX_ITERATIONS = 10;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      this.logger.log(`Tool Use Loop iteration ${i + 1}`);

      const response = await modelWithTools.invoke(messages);

      // 检查 LLM 是否想调用工具
      if (response.tool_calls && response.tool_calls.length > 0) {
        messages.push(response);  // AI 的消息（带 tool_calls）加入历史

        for (const toolCall of response.tool_calls) {
          // 通知前端：正在调用工具
          yield {
            type: 'tool_call',
            name: toolCall.name,
            args: toolCall.args,
            id: toolCall.id,
          };

          // 执行工具
          const toolFn = this.toolMap[toolCall.name];
          const result = toolFn
            ? await (toolFn as any).invoke(toolCall.args)
            : `未知工具: ${toolCall.name}`;

          // 通知前端：工具返回了结果
          yield { type: 'tool_result', name: toolCall.name, result, id: toolCall.id };

          // ⭐ 关键：把工具结果作为 ToolMessage 加入消息列表
          // tool_call_id 必须对应，LLM 才知道"这是哪次调用的结果"
          messages.push(new ToolMessage({
            content: result,
            tool_call_id: toolCall.id || '',
          }));
        }

        continue; // 回到循环顶部，让 LLM 继续判断
      }

      // 没有 tool_calls → 最终回答
      yield { type: 'content', content: response.content as string };
      break;
    }

    yield { type: 'done' };
  }
}
```

**这段代码的核心逻辑只有一个 for 循环**，但它就是 Agent 的雏形。让我画个图：

```plain
用户："北京和上海今天天气哪个好？"
  ↓
【循环第 1 次】
  LLM 收到消息 → 返回 tool_calls:
    [{ name: "get_weather", args: { city: "北京" } },
     { name: "get_weather", args: { city: "上海" } }]
  ↓
  执行 get_weather("北京") → "北京：晴天，28°C..."
  执行 get_weather("上海") → "上海：多云，26°C..."
  ↓
  把两个 ToolMessage 加入消息列表
  ↓
【循环第 2 次】
  LLM 收到消息（包含两个天气结果）→ 不再调用工具
  → 返回最终文本："北京今天晴天 28°C，上海多云 26°C，北京天气更好一些..."
  ↓
  yield content → 循环结束
```

注意几个关键点：

1. **`model.bindTools(tools)`**：这不是执行工具，只是"告诉模型有哪些工具可用"。模型看到工具菜单后，会在需要时自动在回复里带上 `tool_calls`。
2. **`ToolMessage` 的 `tool_call_id`**：必须和 `toolCall.id` 对应。这样 LLM 才能把"工具结果"和"工具请求"匹配起来。如果 id 对不上，模型会困惑。
3. **`MAX_ITERATIONS = 10`**：防止 LLM 陷入"不断调工具"的死循环。实际开发中也会加超时机制。
4. **LangChain 的消息类型**：Phase 1 用的是 OpenAI SDK 的 `{ role, content }` 对象，Phase 2 用的是 LangChain 的 `HumanMessage`、`AIMessage`、`ToolMessage` 类。它们本质一样，但 LangChain 的消息类型支持更多元信息（如 `tool_calls`、`tool_call_id`）。

### 3.4 Agent Controller —— SSE 接口

和 Phase 1 的流式聊天接口几乎一样的结构，只是推送的事件格式不同：

```typescript
// src/agent/agent.controller.ts
@ApiTags('Agent - 智能助手')
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  @SkipTransform()
  async agentChat(@Body() body: AgentRequestDto, @Res() res: Response) {
    const { message, history, systemPrompt } = body;

    // SSE 响应头（和 Phase 1 一样的套路）
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = this.agentService.chat(message, history, systemPrompt);
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
```

**Phase 1 vs Phase 2 的 SSE 数据格式对比**：

```plain
Phase 1（普通流式）：
  data: {"content":"你"}
  data: {"content":"好"}
  data: {"content":"！"}
  data: {"content":"","done":true}

Phase 2（Tool Use）：
  data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"}}
  data: {"type":"tool_result","name":"get_weather","result":"北京：晴天，28°C..."}
  data: {"type":"content","content":"根据查询结果，北京今天天气晴朗..."}
  data: {"type":"done"}
```

Phase 2 加了 `type` 字段来区分事件类型，前端根据 `type` 渲染不同的 UI。

### 3.5 注册模块

```typescript
// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,      // Phase 1
    AgentModule,     // Phase 2 🆕
  ],
})
export class AppModule {}
```

`AgentModule` 导入 `LangChainModule`，`LangChainModule` 提供 `LangChainService`：

```
AppModule
├── ChatModule → LlmModule（Phase 1，原始 OpenAI SDK）
└── AgentModule → LangChainModule（Phase 2，LangChain.js）
```

两套 LLM 调用方式并存，这样可以对比学习。

## 四、前端：可视化工具调用链路

Phase 2 前端的核心改动：**展示 AI 的"思考过程"——调用了哪个工具、传了什么参数、得到了什么结果**。

### 4.1 新增数据结构

```typescript
interface ToolCallInfo {
  name: string                      // 工具名称
  args: Record<string, unknown>     // 调用参数
  result?: string                   // 返回结果
  status: 'calling' | 'done'        // 状态
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]        // 🆕 工具调用链
  // ...Phase 1 的字段保留
}
```

### 4.2 解析 Agent SSE 事件

前端用同样的 SSE 读取逻辑，但需要根据 `type` 字段分别处理：

```typescript
const handleAgentChat = async () => {
  // ...fetch /agent/chat...

  for (const line of lines) {
    const parsed = JSON.parse(trimmed.slice(5).trim())

    if (parsed.type === 'tool_call') {
      // 新增一个工具调用条目，状态为 "calling"
      setMessages(prev => {
        const last = prev[prev.length - 1]
        last.toolCalls = [...(last.toolCalls || []), {
          name: parsed.name,
          args: parsed.args,
          status: 'calling',
        }]
        return [...prev]
      })
    } else if (parsed.type === 'tool_result') {
      // 更新对应的工具调用，填入结果，状态改为 "done"
      setMessages(prev => {
        const last = prev[prev.length - 1]
        const tc = last.toolCalls?.find(t => t.name === parsed.name && t.status === 'calling')
        if (tc) {
          tc.result = parsed.result
          tc.status = 'done'
        }
        return [...prev]
      })
    } else if (parsed.type === 'content') {
      // 最终文本回答
      setMessages(prev => {
        const last = prev[prev.length - 1]
        last.content = parsed.content
        return [...prev]
      })
    }
  }
}
```

### 4.3 渲染工具调用 UI

工具调用以卡片形式展示在 AI 回复的上方：

```tsx
{msg.toolCalls?.map((tc, j) => {
  const display = { get_weather: { icon: '🌤️', label: '天气查询' }, ... }[tc.name]
  return (
    <details key={j} className="tool-call-block" open>
      <summary className="tool-call-header">
        <span className="tool-call-icon">{display.icon}</span>
        <span className="tool-call-name">{display.label}</span>
        <span className={`tool-call-status ${tc.status}`}>
          {tc.status === 'calling' ? '调用中...' : '已完成'}
        </span>
      </summary>
      <div className="tool-call-body">
        <div className="tool-call-args">
          <span className="tool-call-label">参数</span>
          <code>{JSON.stringify(tc.args, null, 2)}</code>
        </div>
        {tc.result && (
          <div className="tool-call-result">
            <span className="tool-call-label">结果</span>
            <div className="tool-call-result-text">{tc.result}</div>
          </div>
        )}
      </div>
    </details>
  )
})}
```

### 4.4 模式切换

底部工具栏新增模式切换按钮，支持"普通聊天"和"智能助手"两种模式：

```tsx
<button
  className={`btn-tool ${mode === 'agent' ? 'active' : ''}`}
  onClick={() => setMode(mode === 'agent' ? 'chat' : 'agent')}
>
  {mode === 'agent' ? '🛠️ 智能助手' : '💬 普通聊天'}
</button>
```

- **普通聊天**：调 `POST /chat/stream`，Phase 1 的流式 SSE
- **智能助手**：调 `POST /agent/chat`，Phase 2 的 Tool Use SSE

## 4.5 全链路函数调用关系

前面分别讲了后端和前端的代码，现在把整条链路串起来——从用户按下回车到看到 AI 回答，每一步调了什么函数、经过了哪个文件。

### 模块依赖关系

先看 NestJS 的模块注入链路，搞清楚"谁依赖谁"：

```
AppModule                              ← src/app.module.ts
├── ConfigModule.forRoot()             ← @nestjs/config，加载 .env
├── ChatModule                         ← Phase 1（保留）
│   ├── imports: [LlmModule]
│   │   └── provides: LlmService       ← 原始 OpenAI SDK 封装
│   ├── controllers: [ChatController]  ← POST /chat, POST /chat/stream
│   └── providers: [ChatService]       ← 消息拼装 + 调 LlmService
│
└── AgentModule                        ← Phase 2（新增） src/agent/agent.module.ts
    ├── imports: [LangChainModule]      ← src/langchain/langchain.module.ts
    │   └── provides: LangChainService  ← ChatOpenAI 封装 src/langchain/langchain.service.ts
    ├── controllers: [AgentController]  ← POST /agent/chat src/agent/agent.controller.ts
    └── providers: [AgentService]       ← Tool Use 循环 src/agent/agent.service.ts
                                           ├── 注入 LangChainService（获取 ChatOpenAI 模型）
                                           └── 导入 tools（weatherTool, timeTool, searchTool）
                                               ├── src/langchain/tools/weather.tool.ts → wttr.in API
                                               ├── src/langchain/tools/time.tool.ts    → worldtimeapi.org
                                               └── src/langchain/tools/search.tool.ts  → Wikipedia API
```

### 完整函数调用链路（以"北京天气怎么样？"为例）

下面按时间顺序，逐步展示一个请求从前端到后端再回到前端的完整链路。每一步标注了**文件路径**和**关键行号**。

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 用户在前端输入"北京天气怎么样？"，按回车                              │
│    web/src/App.tsx                                                    │
│                                                                      │
│    handleKeyDown()         ← :288  捕获 Enter 键                     │
│      ↓                                                               │
│    handleSend()            ← :280  判断 mode === 'agent'             │
│      ↓                                                               │
│    handleAgentChat()       ← :162  Agent 模式入口                     │
│      ├── setMessages(...)  ← :167  添加用户消息到 UI                   │
│      ├── setMessages(...)  ← :171  预创建空的 assistant 消息占位         │
│      └── fetch(POST /agent/chat, { message, history, systemPrompt }) │
│           ← :174  发起 HTTP 请求                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ HTTP POST
┌──────────────────────────────┴──────────────────────────────────────┐
│ 2. NestJS 路由匹配，进入 Controller                                   │
│    server/src/agent/agent.controller.ts                              │
│                                                                      │
│    @Post('chat') agentChat()   ← :32                                 │
│      ├── @Body() body: AgentRequestDto  ← 自动校验参数（class-validator）│
│      ├── res.setHeader('Content-Type', 'text/event-stream')  ← :39  │
│      ├── res.flushHeaders()    ← :42  立即发送响应头                    │
│      └── this.agentService.chat(message, history, systemPrompt)      │
│           ← :45  调用 AgentService，获得 AsyncGenerator                │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ 函数调用
┌──────────────────────────────┴──────────────────────────────────────┐
│ 3. AgentService：构建消息 + 启动 Tool Use 循环                        │
│    server/src/agent/agent.service.ts                                 │
│                                                                      │
│    async *chat()               ← :53  AsyncGenerator 函数            │
│      ├── this.langchainService.getModel()  ← :58                    │
│      │     ↓                                                         │
│      │   LangChainService.getModel()                                 │
│      │   server/src/langchain/langchain.service.ts:35                │
│      │     └── return this.model  ← ChatOpenAI 实例                   │
│      │                                                               │
│      ├── model.bindTools([weatherTool, timeTool, searchTool])  ← :62│
│      │     └── 把三个工具的 name + description + schema 附加到模型       │
│      │                                                               │
│      ├── 构建 messages: BaseMessage[]  ← :65-76                      │
│      │   ├── new SystemMessage(systemPrompt)                         │
│      │   ├── history → HumanMessage / AIMessage                      │
│      │   └── new HumanMessage("北京天气怎么样？")                      │
│      │                                                               │
│      └── 进入 Tool Use 循环  ← :80                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ 循环第 1 次
┌──────────────────────────────┴──────────────────────────────────────┐
│ 4. Tool Use 循环 - 第 1 次迭代                                        │
│    server/src/agent/agent.service.ts:80-148                          │
│                                                                      │
│    modelWithTools.invoke(messages)   ← :83                           │
│      ↓ HTTP 请求到 LLM API（通过 OneAPI 代理）                         │
│      ↓ LLM 返回: { tool_calls: [{ name: "get_weather",              │
│      ↓                             args: { city: "北京" },            │
│      ↓                             id: "call_abc123" }] }            │
│                                                                      │
│    response.tool_calls.length > 0 → 进入工具调用分支  ← :86           │
│      ├── messages.push(response)   ← :88  AI 消息入历史               │
│      │                                                               │
│      ├── yield { type:'tool_call', name:'get_weather',               │
│      │          args:{city:"北京"}, id:"call_abc123" }  ← :97-102    │
│      │     ↓                                                         │
│      │   [SSE 推送到前端] → 前端渲染"🌤️ 天气查询 - 调用中..."          │
│      │                                                               │
│      ├── this.toolMap["get_weather"]  ← :105  查找工具实例             │
│      │     ↓                                                         │
│      │   weatherTool.invoke({ city: "北京" })  ← :110                │
│      │   server/src/langchain/tools/weather.tool.ts                  │
│      │     └── fetch("https://wttr.in/北京?format=j1&lang=zh")       │
│      │         ↓ wttr.in 返回 JSON 天气数据                            │
│      │         └── return "北京当前天气：晴，温度：28°C..."              │
│      │                                                               │
│      ├── yield { type:'tool_result', name:'get_weather',             │
│      │          result:"北京当前天气：晴...", id:"call_abc123" }        │
│      │     ↓                                                         │
│      │   [SSE 推送到前端] → 前端更新工具卡片，显示结果                    │
│      │                                                               │
│      ├── messages.push(new ToolMessage({                             │
│      │     content: "北京当前天气：晴...",                               │
│      │     tool_call_id: "call_abc123"   ← 必须对应！                  │
│      │   }))  ← :128-132                                             │
│      │                                                               │
│      └── continue  ← :137  回到循环顶部                                │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ 循环第 2 次
┌──────────────────────────────┴──────────────────────────────────────┐
│ 5. Tool Use 循环 - 第 2 次迭代                                        │
│    server/src/agent/agent.service.ts:80-148                          │
│                                                                      │
│    此时 messages 包含：                                                │
│      [SystemMessage, HumanMessage("北京天气怎么样？"),                  │
│       AIMessage(tool_calls: [...]),                                   │
│       ToolMessage("北京当前天气：晴...")]                               │
│                                                                      │
│    modelWithTools.invoke(messages)   ← :83                           │
│      ↓ LLM 看到工具结果后，判断不需要再调工具                            │
│      ↓ 返回: { content: "北京今天天气不错！晴天，28°C..." }              │
│                                                                      │
│    response.tool_calls 为空 → 走到最终回答分支  ← :140                 │
│      ├── yield { type:'content', content:"北京今天天气不错！..." }       │
│      │     ↓                                                         │
│      │   [SSE 推送到前端] → 前端渲染最终文本回答                         │
│      └── break  ← :147  退出循环                                      │
│                                                                      │
│    yield { type: 'done' }  ← :150                                    │
│      ↓                                                               │
│    [SSE 推送到前端] → 前端知道对话结束                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ 回到 Controller
┌──────────────────────────────┴──────────────────────────────────────┐
│ 6. Controller 结束响应                                                │
│    server/src/agent/agent.controller.ts                              │
│                                                                      │
│    for await 循环结束（generator done）                                │
│      └── res.end()  ← :53  关闭 SSE 连接                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓ HTTP 连接关闭
┌──────────────────────────────┴──────────────────────────────────────┐
│ 7. 前端收到所有 SSE 事件后                                              │
│    web/src/App.tsx                                                    │
│                                                                      │
│    reader.read() 返回 { done: true }  ← :99                         │
│      └── while 循环 break  ← :100                                    │
│                                                                      │
│    finally { setLoading(false) }  ← :275-277                         │
│      └── UI 状态：loading 结束，发送按钮恢复可用                         │
│                                                                      │
│    最终 UI 状态：                                                      │
│    ┌───────────────────────────────────────┐                         │
│    │ 👤 北京天气怎么样？                      │                         │
│    │                                       │                         │
│    │ 🤖 ┌ 🌤️ 天气查询 ─── [已完成] ──┐    │                         │
│    │    │ 参数: { "city": "北京" }     │    │                         │
│    │    │ 结果: 北京当前天气：晴，28°C... │    │                         │
│    │    └─────────────────────────────┘    │                         │
│    │    北京今天天气不错！晴天，温度28°C...   │                          │
│    └───────────────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 数据流转视角

换个角度，看**关键数据**在各层之间是怎么变形和传递的：

```
前端 (React State)                Server (NestJS)               外部服务
──────────────                    ───────────────               ────────

{ message: "北京天气怎么样？",     AgentRequestDto               
  history: [...],                    ↓ 校验通过                  
  systemPrompt: "..." }          AgentController.agentChat()    
       │                              ↓                         
       │ POST /agent/chat        AgentService.chat()            
       │                              ↓                         
       │                         [SystemMessage,                
       │                          HumanMessage("北京天气...")]   
       │                              ↓                         
       │                         modelWithTools.invoke()  ──→  OneAPI 代理 → LLM
       │                              ↓                    ←─  { tool_calls: [...] }
       │                              ↓                         
       │  ←── SSE ──────────     yield { type: 'tool_call' }   
       │  tool_call 事件              ↓                         
       │                         weatherTool.invoke()  ────→   wttr.in API
       │                              ↓                    ←─  JSON 天气数据
       │  ←── SSE ──────────     yield { type: 'tool_result' } 
       │  tool_result 事件            ↓                         
       │                         messages.push(ToolMessage)     
       │                              ↓                         
       │                         modelWithTools.invoke()  ──→  OneAPI 代理 → LLM
       │                              ↓                    ←─  { content: "..." }
       │  ←── SSE ──────────     yield { type: 'content' }     
       │  content 事件                ↓                         
       │  ←── SSE ──────────     yield { type: 'done' }        
       │  done 事件                   ↓                         
       ↓                         res.end()                      
setMessages(...)                                                
  → UI 渲染完成                                                  
```

### 前端 SSE 事件处理映射

前端收到的每种 SSE 事件类型，对应的处理函数和 UI 变化：

```
SSE 事件 type        App.tsx 处理位置    state 变化                    UI 效果
─────────────        ───────────────    ──────────                    ───────
tool_call            :205-220          toolCalls.push({              工具卡片出现
                                         name, args,                  状态: "调用中..."
                                         status: 'calling'            橙色脉冲动画
                                       })                            

tool_result          :221-236          tc.result = result            工具卡片更新
                                       tc.status = 'done'             状态: "已完成"
                                                                      绿色标签 + 显示结果

content              :237-246          last.content = content        消息气泡显示最终文本
                                                                      

done                 :257              (无 state 变化)               (无)

─── reader done ───  :99-100           setLoading(false)  :275       发送按钮恢复
```

## 五、跑起来试试

### 启动

```bash
cd server && npm run start:dev
cd web && npm run dev
```

### 测试工具调用

试试这些问题（现在都是调用真实 API，返回实时数据）：

```
"北京今天天气怎么样？"
→ AI 调用 get_weather → wttr.in 返回实时天气 → 生成回答

"纽约现在几点了？"
→ AI 调用 get_current_time({ timezone: "America/New_York" }) → worldtimeapi.org 返回时间 → 生成回答

"什么是 LangChain？"
→ AI 调用 web_search → 维基百科返回词条摘要 → 生成回答

"北京和上海今天天气哪个好？"
→ AI 调用 get_weather 两次（北京 + 上海）→ 两次 wttr.in 请求 → 对比后生成回答

"你好"
→ AI 不调用任何工具，直接回答
```

最后一个测试很重要——**AI 应该能判断出"你好"不需要工具**，直接用自己的知识回答。这就是 Tool Use 和"无脑调 API"的区别。

### curl 测试

```bash
curl -X POST http://localhost:3500/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "北京今天天气怎么样？"}'
```

输出（SSE 格式，天气数据是实时的）：

```
data: {"type":"tool_call","name":"get_weather","args":{"city":"北京"},"id":"call_xxx"}
data: {"type":"tool_result","name":"get_weather","result":"北京当前天气：晴，温度：28°C（体感 30°C），湿度：45%，风：N 12 km/h，能见度：10 km，紫外线指数：6","id":"call_xxx"}
data: {"type":"content","content":"北京今天天气晴朗，温度 28°C，体感温度 30°C，湿度 45%。北风 12 km/h，能见度良好。紫外线指数为 6，外出建议做好防晒。"}
data: {"type":"done"}
```

## 六、小结

| 概念 | 作用 | 类比 |
| --- | --- | --- |
| LangChain.js | LLM 应用的标准化框架 | Express 之于 Node.js |
| LCEL (.pipe()) | 用管道串联 AI 组件 | Unix 管道 `cmd1 \| cmd2 \| cmd3` |
| ChatOpenAI | LangChain 对 OpenAI 格式的封装 | 比原始 SDK 多了 bindTools 等能力 |
| tool() + Zod | 定义工具的参数类型和描述 | 给 AI 的"API 文档" |
| bindTools() | 把工具菜单告诉模型 | 给员工一本工具手册 |
| tool_calls | 模型回复中的工具调用请求 | 员工说"我需要用这个工具" |
| ToolMessage | 把工具结果回传给模型 | 把工具的输出交回给员工 |
| Tool Use 循环 | 调用→结果→再判断 的循环 | ReAct Agent 的核心 |

**核心要点**：

1. **LLM + 工具 = 能力放大器**：LLM 本身只有训练数据中的知识，但通过 Tool Use，它可以查天气、查数据库、调 API——能力边界从"模型知识"扩展到"整个互联网"
2. **Tool Use 的本质是"LLM 做决策，代码做执行"**：LLM 负责判断"需不需要工具、用哪个、传什么参数"，我们的代码负责"真正执行工具并返回结果"
3. **Zod schema 和 description 非常重要**：这是 LLM 理解工具的唯一途径。description 写得不清楚，LLM 就不知道什么时候该用这个工具
4. **Tool Use 循环就是 Agent 的雏形**：Phase 3 的 LangGraph 会把这个 while 循环升级为状态图（StateGraph），支持条件分支、并行执行、检查点恢复等高级特性
5. **Phase 1 和 Phase 2 可以共存**：简单聊天用原始 SDK，复杂的工具调用用 LangChain——选择合适的工具解决合适的问题
6. **工具接真实 API 时要做好兜底**：外部 API 可能超时或挂掉，`AbortSignal.timeout()` + `try/catch` 降级是必须的。wttr.in、worldtimeapi.org、Wikipedia API 都是免费无需 Key 的好选择

下一篇，我们将进入 **Phase 3：LangGraph**——不再手写 Tool Use 循环，而是用状态图来编排 Agent，实现条件路由、多步推理、甚至多 Agent 协作。
