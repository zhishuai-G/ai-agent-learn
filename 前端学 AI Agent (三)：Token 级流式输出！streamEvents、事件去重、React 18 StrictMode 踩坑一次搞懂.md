这个系列记录一个有 React + NestJS 经验的前端开发者，从零学习 AI Agent 的全过程。上一篇我们用 LangGraph 的 StateGraph、createReactAgent、Human-in-the-Loop 搭建了完整的 Agent 图。这一篇进入 **Phase 3 进阶**——

**把 Agent 的"思考"和"回答"从"等完再一次性显示"升级为"逐 token 实时流式输出"——就像 DeepSeek、ChatGPT 官网那样，思考过程一个字一个字地蹦出来。**

全文分为四个部分：

- **Part 1：问题分析** —— 为什么 `app.stream()` 不是真正的实时流
- **Part 2：streamEvents API** —— token 级流式输出的核心原理
- **Part 3：后端实现** —— `streamWithTokens` 方法 + 事件去重 + `<think/>` 标签流式解析
- **Part 4：前端适配** —— 不可变状态更新 + 增量追加 + React 18 StrictMode 踩坑

---

# Part 1：问题分析 —— 为什么"思考"不是实时的？

## 1.1 现象

上一篇的代码用的是 `app.stream()` 执行 LangGraph 图。它能正常工作，但有一个体验问题：

```plain
用户发送消息后：
  ┌─────────── 等待 3-5 秒 ───────────┐
  │                                    │
  │  （页面显示"正在思考..."，但没有内容）  │
  │                                    │
  └────────────────────────────────────┘
                                       ↓ 突然一次性出现
  reasoning: "用户用中文打招呼...我应该用中文回复..."  ← 一整块
  content: "你好！很高兴见到你！我是你的 AI 助手..."    ← 一整块
```

用户看到的效果是：**等了很久 → 思考内容一整块出现 → 回答一整块出现**。

而 ChatGPT / DeepSeek 官网的效果是：**思考过程逐字流式输出 → 回答也逐字流式输出**。

## 1.2 根本原因：`app.stream()` 是节点级输出

`app.stream()` 的工作方式是：**每个节点执行完后，yield 一次该节点的完整输出**。

```plain
app.stream() 的时间线：

  agent 节点开始执行
    ├── LLM 开始生成 token 1, 2, 3, ... （这些 token 被缓存在 LLM 内部）
    ├── LLM 生成完毕（3-5 秒后）
    └── agent 节点 yield → { agent: { messages: [AIMessage(完整内容)] } }
        ↑ 此刻前端才收到数据，一次性拿到全部思考内容和回答

  tools 节点开始执行
    ├── 工具执行完毕
    └── tools 节点 yield → { tools: { messages: [ToolMessage(结果)] } }
```

关键问题：**LLM 每个字都在生成，但 `stream()` 等整个节点跑完才返回**。这就像看直播变成了看录播。

## 1.3 对比：我们想要的效果

```plain
streamEvents() 的时间线：

  agent 节点开始执行
    ├── LLM 生成 token "用户"   → 前端立即显示 "用户"
    ├── LLM 生成 token "用"     → 前端立即显示 "用户用"
    ├── LLM 生成 token "中文"   → 前端立即显示 "用户用中文"
    ├── ...
    └── LLM 生成完毕 → 前端已经看到完整思考过程

  tools 节点开始执行
    ├── 工具执行完毕 → 前端收到 tool_result
    └── ...
```

**每个 token 生成后立即推送到前端，用户看到的是"一个字一个字蹦出来"的实时效果。**

---

# Part 2：streamEvents API —— token 级流式输出

## 2.1 两种 Streaming API 对比

LangGraph 提供了两种流式执行 API：

| 特性 | `app.stream()` | `app.streamEvents()` |
|------|---------------|---------------------|
| 输出粒度 | 节点级（一个节点 yield 一次） | 事件级（每个 token/工具调用 yield 一次） |
| 推理内容 | 一整块到达（LLM 生成完后才返回） | 逐 token 到达（实时流式） |
| 正文内容 | 一整块到达 | 逐 token 到达 |
| 工具调用 | 完整返回 | 流式返回 tool_call 片段 + 完整返回 tool_result |
| 事件类型 | `{ [nodeName]: output }` | `on_chat_model_stream` / `on_chat_model_end` / `on_tool_end` 等 |
| 适合场景 | 简单展示、调试 | 生产级实时 UI |

## 2.2 streamEvents 事件类型

`app.streamEvents(input, { version: 'v2' })` 返回的事件流中，我们关注三种核心事件：

```plain
事件类型                    何时触发                     产出什么 SSE 事件
─────────────────────────────────────────────────────────────────────
on_chat_model_stream       LLM 每生成一个 token          reasoning / content
on_chat_model_end          LLM 完成一次完整响应            tool_call
on_tool_end                工具执行完毕                   tool_result

另外，metadata.langgraph_node 变化时 → node（节点切换指示）
```

### 事件结构

```typescript
// on_chat_model_stream 事件
{
  event: 'on_chat_model_stream',
  name: 'ChatOpenAI',                    // 模型名称
  data: {
    chunk: {
      content: '你',                      // 当前 token 的文本
      additional_kwargs: {
        reasoning_content: '用户'          // DeepSeek 的思考 token（如有）
      }
    }
  },
  metadata: {
    langgraph_node: 'agent'              // 当前所在节点
  }
}

// on_chat_model_end 事件
{
  event: 'on_chat_model_end',
  name: 'ChatOpenAI',
  data: {
    output: {
      tool_calls: [{                     // 完整的工具调用信息
        name: 'get_weather',
        args: { city: '北京' },
        id: 'call_xxx'
      }]
    }
  },
  metadata: {
    langgraph_node: 'agent'
  }
}

// on_tool_end 事件
{
  event: 'on_tool_end',
  name: 'get_weather',                  // 工具名
  data: {
    output: '北京：晴，28°C'             // 工具结果
  },
  metadata: {
    langgraph_node: 'tools'
  }
}
```

## 2.3 一个重要的坑：事件冒泡导致重复

`streamEvents` 有一个让很多人踩坑的行为：**同一个事件会在多个调用层级中冒泡**。

```plain
LangGraph 内部调用层级：

  CompiledGraph（图本身）
    └── RunnableSequence（节点 wrapper）
          └── ChatOpenAI（实际模型）

当模型生成一个 token 时：
  1. ChatOpenAI 发出 on_chat_model_stream 事件  ← 原始事件
  2. RunnableSequence 转发这个事件               ← 冒泡（重复！）
  3. CompiledGraph 转发这个事件                  ← 冒泡（重复！）
```

如果你不过滤，**每个 token 会被收到 2-3 次**，前端就会显示"用用户户问问"这种效果。

**解决方案**：只处理来自实际 chat model 的事件，通过 `event.name` 过滤：

```typescript
// event.name 是发出事件的 runnable 名称
// ChatOpenAI 的 name 是 "ChatOpenAI"，以 "Chat" 开头
// 上层 wrapper 的 name 是节点名或 "RunnableSequence"
if (!event.name?.startsWith('Chat')) break;  // 跳过冒泡的重复事件
```

---

# Part 3：后端实现 —— `streamWithTokens` 方法

## 3.1 方法签名

```typescript
// src/langgraph/langgraph.service.ts

private async *streamWithTokens(
  app: any,                                    // 编译后的图实例
  input: { messages: BaseMessage[] } | null,   // 输入（null 表示从检查点恢复）
  config: Record<string, any>,                 // 运行时配置（含 thread_id）
): AsyncGenerator<LangGraphEvent> {
```

**为什么 `input` 可以是 `null`？** 因为 Human-in-the-Loop 的 `resumeExecution` 场景：从检查点恢复时，不需要新输入，传 `null` 即可。

## 3.2 完整实现

```typescript
private async *streamWithTokens(
  app: any,
  input: { messages: BaseMessage[] } | null,
  config: Record<string, any>,
): AsyncGenerator<LangGraphEvent> {
  const eventStream = app.streamEvents(input, {
    ...config,
    version: 'v2',   // 必须指定 v2 版本
  });

  let currentNode = '';       // 跟踪当前节点，检测节点切换
  let isInThinkTag = false;   // 跟踪 <think/> 标签状态（流式解析用）

  for await (const event of eventStream) {
    // === 检测节点切换 ===
    const node = event.metadata?.langgraph_node;
    if (node && node !== currentNode) {
      currentNode = node;
      yield { type: 'node', node };
    }

    switch (event.event) {
      // === LLM 逐 token 流式输出 ===
      case 'on_chat_model_stream': {
        // 过滤冒泡的重复事件（关键！）
        if (!event.name?.startsWith('Chat')) break;

        const chunk = event.data?.chunk;
        if (!chunk) break;

        // 来源 1：原生 reasoning_content（DeepSeek 等模型）
        const reasoning = chunk.additional_kwargs?.reasoning_content;
        if (reasoning && typeof reasoning === 'string') {
          yield { type: 'reasoning', content: reasoning };
          break;
        }

        // 来源 2：普通 content（可能包含 <think/> 标签）
        let text = typeof chunk.content === 'string' ? chunk.content : '';
        if (!text) break;

        // 流式解析 <think/> 标签（详见 3.3 节）
        if (isInThinkTag) {
          const closeIdx = text.indexOf('</think\>');
          if (closeIdx !== -1) {
            const thinkPart = text.slice(0, closeIdx);
            if (thinkPart) yield { type: 'reasoning', content: thinkPart };
            isInThinkTag = false;
            const after = text.slice(closeIdx + 8);
            if (after) yield { type: 'content', content: after };
          } else {
            yield { type: 'reasoning', content: text };
          }
        } else {
          const openIdx = text.indexOf('<think\>');
          if (openIdx !== -1) {
            const before = text.slice(0, openIdx);
            if (before) yield { type: 'content', content: before };
            isInThinkTag = true;
            const after = text.slice(openIdx + 7);
            if (after) {
              const closeIdx = after.indexOf('</think\>');
              if (closeIdx !== -1) {
                const thinkPart = after.slice(0, closeIdx);
                if (thinkPart) yield { type: 'reasoning', content: thinkPart };
                isInThinkTag = false;
                const rest = after.slice(closeIdx + 8);
                if (rest) yield { type: 'content', content: rest };
              } else {
                yield { type: 'reasoning', content: after };
              }
            }
          } else {
            yield { type: 'content', content: text };
          }
        }
        break;
      }

      // === LLM 完成响应 → 提取工具调用 ===
      case 'on_chat_model_end': {
        if (!event.name?.startsWith('Chat')) break;  // 同样过滤重复
        const msg = event.data?.output;
        if (msg?.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            yield {
              type: 'tool_call',
              name: tc.name,
              args: tc.args as Record<string, unknown>,
              id: tc.id,
            };
          }
        }
        break;
      }

      // === 工具执行完成 ===
      case 'on_tool_end': {
        const output = event.data?.output;
        if (output != null) {
          const result = typeof output === 'string'
            ? output
            : typeof output.content === 'string'
              ? output.content
              : JSON.stringify(output);
          yield { type: 'tool_result', result, name: event.name };
        }
        break;
      }
    }
  }
}
```

## 3.3 `<think/>` 标签的流式解析 —— 状态机

有些模型（非 DeepSeek）不提供 `reasoning_content` 字段，而是把思考内容放在 `<think/>` 标签里：

```plain
<think\>
用户用中文打招呼"你好"。我应该用中文回复，保持友好和热情。
</think\>

你好！很高兴见到你！
```

在节点级输出时，这很好处理——拿到完整文本，正则匹配就行。但在 token 级流式输出时，**标签可能被拆到多个 token 中**：

```plain
token 1: "<think\>"
token 2: "用户"
token 3: "用中文"
...
token N: "。"
token N+1: "</think\>"
token N+2: "\n\n你好"
```

所以需要一个状态机来跟踪当前是否在 `<think/>` 标签内：

```plain
状态机：

  isInThinkTag = false（初始状态，不在标签内）
    │
    ├── 收到包含 <think\> 的 token
    │   ├── <think\> 之前的内容 → content 事件
    │   ├── <think\> 之后的内容（如果同一 token 内有 </think\>）
    │   │   ├── </think\> 之前的 → reasoning 事件
    │   │   └── </think\> 之后的 → content 事件
    │   └── <think\> 之后没有 </think\>
    │       └── 全部 → reasoning 事件，isInThinkTag = true
    │
    └── 不包含 <think\> 的 token → content 事件

  isInThinkTag = true（在标签内，正在接收思考内容）
    │
    ├── 收到包含 </think\> 的 token
    │   ├── </think\> 之前的 → reasoning 事件
    │   ├── </think\> 之后的 → content 事件
    │   └── isInThinkTag = false
    │
    └── 不包含 </think\> 的 token → reasoning 事件
```

## 3.4 推理内容的两种来源

```plain
来源对比：

  来源 1：reasoning_content 字段（DeepSeek 原生）
  ┌──────────────────────────────────────┐
  │ chunk.additional_kwargs              │
  │   .reasoning_content = "用户用中文..." │  ← 直接作为 reasoning 事件
  │ chunk.content = "你好！很高兴..."      │  ← 直接作为 content 事件
  └──────────────────────────────────────┘
  优点：思考和正文天然分离，不需要解析标签
  缺点：只有 DeepSeek 等少数模型支持

  来源 2：<think/> 标签（通用方案）
  ┌──────────────────────────────────────┐
  │ chunk.content = "<think\>用户用中文..." │  ← 需要状态机解析
  └──────────────────────────────────────┘
  优点：所有模型都能用
  缺点：需要流式解析标签，实现复杂
```

`streamWithTokens` 同时支持两种来源，优先使用 `reasoning_content`（更简单可靠），回退到 `<think/>` 标签解析。

## 3.5 替换所有方法中的 `app.stream()`

原来每个方法都有自己的 `app.stream()` + 循环解析逻辑，现在统一替换为 `streamWithTokens`：

```typescript
// ===== 替换前（节点级输出） =====
const stream = await app.stream({ messages }, config);
for await (const event of stream) {
  for (const [nodeName, output] of Object.entries(event)) {
    yield { type: 'node', node: nodeName };
    const nodeOutput = output as { messages: BaseMessage[] };
    if (!nodeOutput.messages) continue;
    for (const msg of nodeOutput.messages) {
      if (msg instanceof AIMessage) {
        yield* this.processAIMessage(msg);
      } else if (msg instanceof ToolMessage) {
        yield { type: 'tool_result', result: ..., id: ... };
      }
    }
  }
}

// ===== 替换后（token 级输出） =====
yield* this.streamWithTokens(app, { messages }, config);
```

四种方法全部替换：

| 方法 | 修改 |
|------|------|
| `chatWithStateGraph` | `yield* this.streamWithTokens(app, { messages }, config)` |
| `chatWithReactAgent` | `yield* this.streamWithTokens(agent, { messages: [new HumanMessage(message)] }, config)` |
| `chatWithHumanInTheLoop` | `yield* this.streamWithTokens(app, { messages: [new HumanMessage(message)] }, config)` |
| `resumeExecution` | `yield* this.streamWithTokens(app, null, config)` ← 注意 `null` |

**注意**：`resumeExecution` 传 `null` 是因为从检查点恢复不需要新输入。

---

# Part 4：前端适配 —— 从"替换"到"追加"

后端从节点级输出切换到 token 级输出后，前端的 SSE 事件处理也需要相应调整。核心变化：

```plain
之前（节点级）：
  一个 content 事件包含完整文本："你好！很高兴见到你！"
  → last.content = parsed.content  （替换）

现在（token 级）：
  多个 content 事件，每个只包含一个 token：
  "你好" → "！" → "很高兴" → "见到" → "你" → "！"
  → last.content += parsed.content  （追加）
```

## 4.1 不可变状态更新 —— React 18 StrictMode 踩坑

直接用 `+=` 追加会有一个隐蔽的 bug。看看原来的代码：

```typescript
// ❌ 危险写法：直接 mutation
setMessages(prev => {
  const updated = [...prev]                        // 浅拷贝数组
  const last = updated[updated.length - 1]         // 但 last 还是原对象引用！
  last.content = (last.content || '') + parsed.content  // 直接修改了原对象
  return updated
})
```

**问题**：React 18 的 `StrictMode` 在开发模式下会**故意调用两次 state updater** 来检测不纯更新。

```plain
第一次调用：
  prev[last].content = ""
  last.content = "" + "用户" = "用户"   ← 同时修改了 prev 里的对象！

第二次调用（StrictMode 重新执行）：
  prev[last].content = "用户"            ← 已被第一次修改污染
  last.content = "用户" + "用户" = "用户用户"  ← 重复了！
```

每个 token 都被追加两次，最终显示效果："用用户户问问"。

## 4.2 解决方案：不可变更新

创建新对象，而不是修改原对象：

```typescript
// ✅ 正确写法：不可变更新
setMessages(prev => {
  const last = prev[prev.length - 1]
  if (!last || last.role !== 'assistant') return prev
  return [
    ...prev.slice(0, -1),                           // 前面的消息不变
    { ...last, content: (last.content || '') + parsed.content }  // 新对象！
  ]
})
```

`{ ...last, content: ... }` 创建了一个全新的对象，`prev` 里的原对象不受影响。即使 StrictMode 调用两次，第二次读到的 `prev` 仍然是干净的。

## 4.3 封装 `updateLastAssistant` helper

每个 SSE 事件处理都要写一遍不可变更新太啰嗦，封装一个 helper：

```typescript
// web/src/App.tsx

// 不可变更新：创建新对象替代直接 mutation，兼容 React 18 StrictMode
function updateLastAssistant(
  prev: ChatMessage[],
  updater: (last: ChatMessage) => Partial<ChatMessage>,
): ChatMessage[] {
  const last = prev[prev.length - 1]
  if (!last || last.role !== 'assistant') return prev
  return [...prev.slice(0, -1), { ...last, ...updater(last) }]
}
```

使用方式：

```typescript
// reasoning 事件（逐 token 追加）
setMessages(prev => updateLastAssistant(prev, last => ({
  thinkContent: (last.thinkContent || '') + parsed.content,
})))

// content 事件（逐 token 追加 + 结束思考）
setMessages(prev => updateLastAssistant(prev, last => ({
  content: (last.content || '') + parsed.content,
  ...(last.isThinking ? {
    isThinking: false,
    thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
  } : {}),
})))

// tool_call 事件（追加到数组）
setMessages(prev => updateLastAssistant(prev, last => ({
  toolCalls: [...(last.toolCalls || []), {
    name: parsed.name,
    args: parsed.args,
    status: 'calling' as const,
  }],
})))

// tool_result 事件（更新对应工具状态）
setMessages(prev => updateLastAssistant(prev, last => {
  if (!last.toolCalls) return {}
  const toolCalls = last.toolCalls.map(t =>
    t.status === 'calling'
      ? { ...t, result: parsed.result, status: 'done' as const }
      : t,
  )
  return { toolCalls }
}))
```

## 4.4 完整 SSE 事件 → 前端更新映射

| SSE 事件 | 前端更新 | 是否追加 |
|----------|---------|---------|
| `node` | `activeNode = parsed.node` | 替换 |
| `reasoning` | `thinkContent = (last.thinkContent \|\| '') + parsed.content` | **追加** |
| `content` | `content = (last.content \|\| '') + parsed.content` | **追加** |
| `tool_call` | `toolCalls = [...last.toolCalls, newToolCall]` | 追加到数组 |
| `tool_result` | `toolCalls = toolCalls.map(更新对应项)` | 更新数组项 |
| `interrupt` | `interrupted = true` | 替换 |
| `done` | `activeNode = undefined` | 清除 |

关键变化：**`reasoning` 和 `content` 从"替换"变成了"追加"**，因为现在每个 token 是一个独立事件。

## 4.5 实时效果

改造完成后的 SSE 数据流：

```plain
data: {"type":"node","node":"__start__"}
data: {"type":"node","node":"agent"}
data: {"type":"reasoning","content":"用户"}
data: {"type":"reasoning","content":"用"}
data: {"type":"reasoning","content":"中文"}
data: {"type":"reasoning","content":"打招呼"}
data: {"type":"reasoning","content":"\""}
data: {"type":"reasoning","content":"你好"}
data: {"type":"reasoning","content":"\"。"}
data: {"type":"reasoning","content":"我应该"}
data: {"type":"reasoning","content":"用"}
data: {"type":"reasoning","content":"中文"}
data: {"type":"reasoning","content":"回复"}
data: {"type":"reasoning","content":"，"}
data: {"type":"reasoning","content":"保持"}
data: {"type":"reasoning","content":"友好"}
...
data: {"type":"content","content":"你好"}
data: {"type":"content","content":"！"}
data: {"type":"content","content":"很高兴"}
data: {"type":"content","content":"见到"}
data: {"type":"content","content":"你"}
data: {"type":"content","content":"！"}
data: {"type":"content","content":"我是"}
data: {"type":"content","content":"你的"}
data: {"type":"content","content":" AI"}
data: {"type":"content","content":" "}
data: {"type":"content","content":"助手"}
data: {"type":"content","content":"，"}
data: {"type":"content","content":"有什么"}
data: {"type":"content","content":"可以帮助"}
data: {"type":"content","content":"你的"}
data: {"type":"content","content":"吗"}
data: {"type":"content","content":"？"}
data: {"type":"done"}
```

前端效果：思考区的文字逐字出现，回答也逐字出现——和 ChatGPT 官网一样的体验。

---

# 小结

## 概念速查表

| 概念 | 作用 | 类比 |
|------|------|------|
| `streamEvents()` | token 级流式执行 | 直播（实时推送每个画面） |
| `on_chat_model_stream` | LLM 每生成一个 token 触发 | 直播的每一帧 |
| `on_chat_model_end` | LLM 完成一次完整响应触发 | 直播的一个段落结束 |
| `on_tool_end` | 工具执行完毕触发 | API 返回结果 |
| `event.name` 过滤 | 排除冒泡的重复事件 | 只听主讲人的声音，忽略回声 |
| `isInThinkTag` 状态机 | 流式解析 `<think/>` 标签 | 边读边分段的阅读器 |
| `reasoning_content` | DeepSeek 原生思考字段 | 思考和回答天然分离的信封 |
| `updateLastAssistant` | 不可变状态更新 helper | React 的安全更新模式 |
| StrictMode 双重调用 | React 18 开发模式的安全检测 | 双重验算，防止 mutation 污染 |

## 核心要点

1. **`app.stream()` 是节点级，`app.streamEvents()` 是 token 级**：前者等整个节点跑完才返回，后者每个 token 立即推送。实时 UI 必须用后者

2. **必须过滤冒泡事件**：`streamEvents` 会在多个调用层级转发同一事件，用 `event.name?.startsWith('Chat')` 过滤，否则每个 token 重复 2-3 次

3. **`<think/>` 标签需要状态机解析**：标签可能被拆到多个 token 中，必须用 `isInThinkTag` 状态机跟踪开闭标签。`reasoning_content` 字段不需要解析，优先使用

4. **前端必须用追加而非替换**：token 级输出意味着 `content` 和 `reasoning` 事件是增量的，必须用 `+=` 追加，不能用 `=` 替换

5. **React 18 StrictMode 要求不可变更新**：直接 mutation 会导致双重调用时内容重复。用 `{ ...last, ...changes }` 创建新对象是正确做法

6. **`streamWithTokens` 统一了四种执行方法**：`chatWithStateGraph`、`chatWithReactAgent`、`chatWithHumanInTheLoop`、`resumeExecution` 全部使用同一个 helper，避免重复代码
