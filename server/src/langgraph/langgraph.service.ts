import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'; // 引入 NestJS 装饰器和生命周期钩子
import { ConfigService } from '@nestjs/config'; // 引入配置服务，用于读取环境变量
import { LangChainService } from '../langchain/langchain.service'; // 引入 Phase 2 的 LangChain 服务，用于获取模型实例
import { weatherTool, timeTool, searchTool } from '../langchain/tools'; // 引入 Phase 2 定义的三个工具：天气、时间、搜索
import {
  Annotation,   // 用于定义 State schema（类型安全的状态定义）
  StateGraph,   // 状态图构造器，用于手动构建 Agent 图
  START,        // 图的起始虚拟节点标识
  END,          // 图的结束虚拟节点标识
} from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt'; // 预构建的 ReAct Agent 工厂函数
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis'; // Redis 检查点存储器，用于持久化图执行状态
import {
  HumanMessage,  // 用户消息类型
  AIMessage,     // AI 回复消息类型
  SystemMessage, // 系统提示词消息类型
  ToolMessage,   // 工具执行结果消息类型
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages'; // 所有消息类型的基类
import type { RunnableConfig } from '@langchain/core/runnables'; // 可运行配置类型（包含 thread_id 等）

// SSE 事件接口 —— 定义了前端能收到的所有事件类型
export interface LangGraphEvent {
  type: 'node' | 'tool_call' | 'tool_result' | 'content' | 'reasoning' | 'interrupt' | 'done' | 'error'; // 事件类型枚举
  node?: string;            // 当前执行的图节点名称（type=node 时使用）
  name?: string;            // 工具名称（type=tool_call 时使用）
  args?: Record<string, unknown>; // 工具调用参数（type=tool_call 时使用）
  id?: string;              // 调用 ID，用于前端匹配 tool_call 和 tool_result
  result?: string;          // 工具执行返回结果（type=tool_result 时使用）
  content?: string;         // LLM 文本回答、推理内容或中断提示信息
  error?: string;           // 错误信息（type=error 时使用）
  interruptValue?: unknown; // 中断时的上下文数据（type=interrupt 时使用）
}

@Injectable() // NestJS 依赖注入装饰器，标记该类可以被注入到其他模块
export class LangGraphService implements OnModuleInit, OnModuleDestroy { // 实现生命周期钩子，用于 Redis 连接管理
  private readonly logger = new Logger(LangGraphService.name); // 创建带类名前缀的日志实例

  private tools = [weatherTool, timeTool, searchTool]; // 复用 Phase 2 定义的三个工具

  private toolMap: Record<string, (typeof this.tools)[number]> = Object.fromEntries( // 构建工具名 → 工具实例的映射表
    this.tools.map((t) => [t.name, t]), // 将 [工具名, 工具实例] 数组转为对象
  );

  // Redis 检查点存储器（替代 MemorySaver）
  // 优势：服务重启后状态不丢失，支持多实例部署共享状态
  // 需要 Redis 8.0+（内置 RedisJSON + RediSearch），或 Redis Stack
  private checkpointer!: RedisSaver; // 在 onModuleInit 中异步初始化

  constructor(
    private readonly langchainService: LangChainService, // 注入 LangChainService，用于获取 LLM 模型实例
    private readonly configService: ConfigService,       // 注入 ConfigService，用于读取 REDIS_URL 环境变量
  ) {}

  /**
   * 从 AIMessage 中提取推理/思考内容
   * 支持两种来源：
   * 1. additional_kwargs.reasoning_content（DeepSeek 等模型原生支持）
   * 2. content 中的 <think>...</think> 标签（通用方案）
   */
  private extractReasoning(msg: AIMessage): { reasoning: string; content: string } {
    let reasoning = '';
    let content = typeof msg.content === 'string' ? msg.content : '';

    // 来源 1：模型原生推理字段（DeepSeek 等）
    const nativeReasoning = msg.additional_kwargs?.reasoning_content;
    if (nativeReasoning && typeof nativeReasoning === 'string') {
      reasoning = nativeReasoning;
    }

    // 来源 2：解析 <think> 标签
    if (content.includes('<think>')) {
      const thinkStart = content.indexOf('<think>');
      const thinkEnd = content.indexOf('</think>');
      if (thinkEnd !== -1) {
        const thinkText = content.slice(thinkStart + 7, thinkEnd).trim();
        content = content.slice(thinkEnd + 8).trim();
        reasoning = reasoning ? reasoning + '\n' + thinkText : thinkText;
      }
    }

    return { reasoning, content };
  }

  /**
   * 处理 AIMessage 并生成对应的 SSE 事件序列
   * 统一处理 tool_call、reasoning、content 三种事件
   */
  private *processAIMessage(msg: AIMessage): Generator<LangGraphEvent> {
    // 1. 工具调用事件
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        yield {
          type: 'tool_call',
          name: tc.name,
          args: tc.args as Record<string, unknown>,
          id: tc.id,
        };
      }
    }

    // 2. 提取推理内容和正文
    const { reasoning, content } = this.extractReasoning(msg);

    // 3. 推理事件（模型的思考过程）
    if (reasoning) {
      yield { type: 'reasoning', content: reasoning };
    }

    // 4. 正文内容事件（最终回答）
    if (content.length > 0) {
      yield { type: 'content', content };
    }
  }

  // NestJS 生命周期钩子：模块初始化时连接 Redis
  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.checkpointer = await RedisSaver.fromUrl(redisUrl);
    this.logger.log(`Redis checkpointer connected: ${redisUrl}`);
  }

  // NestJS 生命周期钩子：模块销毁时断开 Redis 连接
  async onModuleDestroy() {
    if (this.checkpointer) {
      await this.checkpointer.end();
      this.logger.log('Redis checkpointer disconnected');
    }
  }

  /**
   * 通用流式执行方法 —— 使用 streamEvents 实现 token 级流式输出
   *
   * 替代原来的 app.stream()，核心区别：
   * - app.stream()：节点级输出，LLM 完整生成后才返回（reasoning 一整块到达）
   * - streamEvents：token 级输出，LLM 每生成一个 token 就推送（实时流式思考）
   *
   * 事件映射：
   * - on_chat_model_stream → reasoning / content（逐 token）
   * - on_chat_model_end   → tool_call（完整工具调用信息）
   * - on_tool_end         → tool_result（工具执行结果）
   * - metadata.langgraph_node 变化 → node（节点切换）
   */
  private async *streamWithTokens(
    app: any,
    input: { messages: BaseMessage[] } | null,
    config: Record<string, any>,
  ): AsyncGenerator<LangGraphEvent> {
    const eventStream = app.streamEvents(input, {
      ...config,
      version: 'v2',
    });

    let currentNode = '';
    let isInThinkTag = false;

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
          // 过滤重复事件：只处理来自实际 chat model 的事件（如 "ChatOpenAI"）
          // LangGraph 的 streamEvents 会在多个层级冒泡同一事件，导致每个 token 重复
          // 只有 event.name 以 "Chat" 开头的才是模型本身发出的原始事件
          if (!event.name?.startsWith('Chat')) break;

          const chunk = event.data?.chunk;
          if (!chunk) break;

          // 来源 1：原生 reasoning_content（DeepSeek 等模型）
          const reasoning = chunk.additional_kwargs?.reasoning_content;
          if (reasoning && typeof reasoning === 'string') {
            yield { type: 'reasoning', content: reasoning };
            break;
          }

          // 来源 2：普通 content（可能包含 <think> 标签）
          let text = typeof chunk.content === 'string' ? chunk.content : '';
          if (!text) break;

          // 流式解析 <think> 标签（处理思考内容和正文的分离）
          if (isInThinkTag) {
            const closeIdx = text.indexOf('</think>');
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
            const openIdx = text.indexOf('<think>');
            if (openIdx !== -1) {
              const before = text.slice(0, openIdx);
              if (before) yield { type: 'content', content: before };
              isInThinkTag = true;
              const after = text.slice(openIdx + 7);
              if (after) {
                const closeIdx = after.indexOf('</think>');
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

        // === LLM 完成响应 —— 提取完整的工具调用信息 ===
        case 'on_chat_model_end': {
          if (!event.name?.startsWith('Chat')) break; // 同样过滤重复事件
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
            yield {
              type: 'tool_result',
              result,
              name: event.name,
            };
          }
          break;
        }
      }
    }
  }

  // ==================== 方式一：自定义 StateGraph ====================

  async *chatWithStateGraph( // 异步生成器函数，逐条 yield SSE 事件给前端
    message: string,        // 用户输入的消息文本
    threadId?: string,      // 线程 ID，用于多轮对话持久化（可选）
    history: Array<{ role: string; content: string }> = [], // 历史对话记录数组（可选）
    systemPrompt?: string,  // 系统提示词（可选）
  ): AsyncGenerator<LangGraphEvent> { // 返回类型：异步生成器，产出 LangGraphEvent
    const model = this.langchainService.getModel(); // 从 LangChainService 获取 ChatOpenAI 模型实例

    // ===== Step 1: 定义 State =====
    const AgentState = Annotation.Root({ // 用 Annotation.Root 定义图的 State 类型
      messages: Annotation<BaseMessage[]>({ // messages 字段：存储所有对话消息
        reducer: (current, update) => [...current, ...update], // reducer：新消息追加到已有消息数组末尾
      }),
    });

    const modelWithTools = model.bindTools(this.tools); // 将工具绑定到模型，告诉 LLM 有哪些工具可用

    // ===== Step 2: 定义节点函数 =====
    const callModel = async ( // agent 节点函数：负责调用 LLM
      state: typeof AgentState.State, // 参数：当前 State（包含 messages 数组）
      config?: RunnableConfig,        // 参数：运行时配置（包含 thread_id 等）
    ) => {
      this.logger.log('Node [agent]: calling LLM...'); // 打印日志，方便调试
      const response = await modelWithTools.invoke(state.messages, config); // 将所有消息发给 LLM，获取回复
      return { messages: [response] }; // 返回新消息，reducer 会将其追加到 state.messages
    };

    const callTools = async (state: typeof AgentState.State) => { // tools 节点函数：负责执行工具调用
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage; // 取最后一条消息（一定是 AIMessage）
      const toolMessages: ToolMessage[] = []; // 存放所有工具执行结果的数组

      for (const toolCall of lastMessage.tool_calls || []) { // 遍历 AIMessage 中的每个工具调用请求
        this.logger.log(`Node [tools]: executing ${toolCall.name}`); // 打印正在执行的工具名
        const toolFn = this.toolMap[toolCall.name]; // 根据工具名从映射表中查找对应的工具实例
        let result: string; // 工具执行结果变量

        if (toolFn) { // 如果找到了对应的工具
          try {
            result = await (toolFn as any).invoke(toolCall.args); // 调用工具的 invoke 方法执行（传入 LLM 给的参数）
          } catch (error) { // 如果工具执行出错
            result = `工具执行出错: ${error instanceof Error ? error.message : String(error)}`; // 将错误信息作为结果返回给 LLM
          }
        } else { // 如果工具名不存在
          result = `未知工具: ${toolCall.name}`; // 返回未知工具的提示
        }

        toolMessages.push( // 将工具结果包装成 ToolMessage 放入结果数组
          new ToolMessage({ // 创建 ToolMessage 实例
            content: result, // 工具执行结果文本
            tool_call_id: toolCall.id || '', // 关联的工具调用 ID，LLM 用它匹配结果和请求
          }),
        );
      }

      return { messages: toolMessages }; // 返回所有工具结果，reducer 会追加到 state.messages
    };

    // ===== Step 3: 定义条件路由 =====
    const shouldContinue = (state: typeof AgentState.State) => { // 条件路由函数：决定 agent 节点执行后走哪条边
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage; // 取最后一条 AI 消息
      if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) { // 如果 AI 返回了工具调用请求
        return 'continue'; // 返回 'continue'，对应 addConditionalEdges 中 continue → tools
      }
      return 'end'; // 否则返回 'end'，对应 addConditionalEdges 中 end → END
    };

    // ===== Step 4: 构建图 =====
    const graph = new StateGraph(AgentState) // 创建 StateGraph 实例，传入 State 类型定义
      .addNode('agent', callModel)          // 添加 agent 节点，绑定 callModel 函数
      .addNode('tools', callTools)          // 添加 tools 节点，绑定 callTools 函数
      .addEdge(START, 'agent')              // 添加固定边：图的入口 START → agent 节点
      .addConditionalEdges('agent', shouldContinue, { // 添加条件边：agent 节点后根据 shouldContinue 返回值路由
        continue: 'tools',                  // shouldContinue 返回 'continue' 时 → 走到 tools 节点
        end: END,                           // shouldContinue 返回 'end' 时 → 走到 END 结束
      })
      .addEdge('tools', 'agent');           // 添加固定边：tools 执行完后 → 回到 agent（形成循环）

    // ===== Step 5: 编译图 =====
    const app = graph.compile({ // 编译图定义，生成可执行的 Agent 实例
      checkpointer: this.checkpointer, // 传入 Redis 检查点存储器，启用状态持久化和多轮对话
    });

    // 构建初始消息列表
    const messages: BaseMessage[] = []; // 创建空消息数组
    if (systemPrompt) { // 如果有系统提示词
      messages.push(new SystemMessage(systemPrompt)); // 将系统提示词作为第一条消息
    }
    for (const msg of history) { // 遍历历史对话记录
      if (msg.role === 'user') messages.push(new HumanMessage(msg.content)); // 用户消息 → HumanMessage
      else if (msg.role === 'assistant') messages.push(new AIMessage(msg.content)); // AI 消息 → AIMessage
    }
    messages.push(new HumanMessage(message)); // 将当前用户输入作为最后一条消息

    // ===== Step 6: 流式执行（token 级流式输出） =====
    const config = {
      configurable: { thread_id: threadId || `thread-${Date.now()}` },
    };

    yield* this.streamWithTokens(app, { messages }, config);
    yield { type: 'done' };
  }

  // ==================== 方式二：createReactAgent ====================

  async *chatWithReactAgent( // 使用预构建 ReAct Agent 的异步生成器
    message: string,        // 用户消息
    threadId?: string,      // 线程 ID（可选）
    systemPrompt?: string,  // 系统提示词（可选）
  ): AsyncGenerator<LangGraphEvent> { // 返回类型：LangGraphEvent 异步生成器
    const model = this.langchainService.getModel(); // 获取 LLM 模型实例

    const agent = createReactAgent({ // 用工厂函数一行创建 ReAct Agent（内部自动构建 StateGraph）
      llm: model,                    // 传入模型
      tools: this.tools,             // 传入工具数组（内部自动 bindTools）
      ...(systemPrompt ? { prompt: systemPrompt } : {}), // 有系统提示词则传入（会自动包装成 SystemMessage）
      checkpointSaver: this.checkpointer, // 传入 Redis 检查点存储器，启用多轮对话
    });

    const config = { // 构建运行时配置
      configurable: { thread_id: threadId || `react-${Date.now()}` }, // 设置 thread_id
    };

    // 使用 streamWithTokens 实现 token 级流式输出
    yield* this.streamWithTokens(agent, { messages: [new HumanMessage(message)] }, config);
    yield { type: 'done' }; // 执行完毕
  }

  // ==================== 方式三：Human-in-the-Loop（原始 StateGraph 实现） ====================

  // 构建带 interruptBefore 的 StateGraph —— 方式三的 HiTL 和 resume 共用同一个图结构
  // 抽成私有方法避免重复代码，chatWithHumanInTheLoop 和 resumeExecution 都调用它
  private buildHitlGraph(systemPrompt?: string) {
    const model = this.langchainService.getModel(); // 获取 LLM 模型实例

    // ===== 定义 State =====
    const AgentState = Annotation.Root({ // 和方式一相同的 State 定义
      messages: Annotation<BaseMessage[]>({
        reducer: (current, update) => [...current, ...update], // 追加策略
      }),
    });

    const modelWithTools = model.bindTools(this.tools); // 绑定工具到模型

    // ===== 定义节点函数 =====
    const callModel = async ( // agent 节点：调用 LLM
      state: typeof AgentState.State,
      config?: RunnableConfig,
    ) => {
      // 如果有 systemPrompt，在消息列表最前面插入 SystemMessage
      const msgs = systemPrompt
        ? [new SystemMessage(systemPrompt), ...state.messages] // 每次调用都带上 systemPrompt
        : state.messages;
      this.logger.log('Node [agent] (HiTL): calling LLM...');
      const response = await modelWithTools.invoke(msgs, config); // 调用 LLM
      return { messages: [response] }; // 返回新消息
    };

    const callTools = async (state: typeof AgentState.State) => { // tools 节点：执行工具调用
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      const toolMessages: ToolMessage[] = [];

      for (const toolCall of lastMessage.tool_calls || []) {
        this.logger.log(`Node [tools] (HiTL): executing ${toolCall.name}`);
        const toolFn = this.toolMap[toolCall.name];
        let result: string;

        if (toolFn) {
          try {
            result = await (toolFn as any).invoke(toolCall.args);
          } catch (error) {
            result = `工具执行出错: ${error instanceof Error ? error.message : String(error)}`;
          }
        } else {
          result = `未知工具: ${toolCall.name}`;
        }

        toolMessages.push(
          new ToolMessage({
            content: result,
            tool_call_id: toolCall.id || '',
          }),
        );
      }

      return { messages: toolMessages };
    };

    // ===== 定义条件路由 =====
    const shouldContinue = (state: typeof AgentState.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return 'continue'; // 有工具调用 → 去 tools 节点
      }
      return 'end'; // 无工具调用 → 结束
    };

    // ===== 构建图 =====
    const graph = new StateGraph(AgentState)
      .addNode('agent', callModel)
      .addNode('tools', callTools)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', shouldContinue, {
        continue: 'tools',
        end: END,
      })
      .addEdge('tools', 'agent');

    // ===== 编译图（关键：interruptBefore） =====
    // 和方式一的区别：compile 时传入 interruptBefore: ['tools']
    // 图在执行到 tools 节点**之前**自动暂停，等待人工确认
    const app = graph.compile({
      checkpointer: this.checkpointer, // Redis 检查点存储器（中断恢复必须有 checkpointer）
      interruptBefore: ['tools'],       // 核心配置：在 tools 节点执行前自动中断
    });

    return app; // 返回编译后的图实例
  }

  async *chatWithHumanInTheLoop( // 带人工审核的 Agent，工具执行前自动暂停
    message: string,   // 用户消息
    threadId: string,  // 线程 ID（必填，恢复执行时需要同一个 ID）
    systemPrompt?: string, // 系统提示词（可选）
  ): AsyncGenerator<LangGraphEvent> { // 返回类型：LangGraphEvent 异步生成器
    const app = this.buildHitlGraph(systemPrompt); // 构建带 interruptBefore 的 StateGraph

    const config = { // 构建运行时配置
      configurable: { thread_id: threadId }, // 使用传入的 thread_id（恢复时需要一致）
    };

    // 第一次执行：图会跑到 tools 节点前暂停
    // 使用 streamWithTokens 实现 token 级流式输出
    yield* this.streamWithTokens(
      app,
      { messages: [new HumanMessage(message)] },
      config,
    );

    // 检查图是否被中断
    const state = await app.getState(config); // 获取当前图的 State 快照
    if (state.next && state.next.length > 0) { // 如果 state.next 不为空，说明图被中断了
      yield { // 向前端发送 interrupt 事件
        type: 'interrupt', // 事件类型
        content: '⏸️ Agent 想要执行工具调用，等待人工确认...', // 提示文本
        interruptValue: { nextNodes: state.next }, // 附带待执行的节点列表
      };
    } else { // state.next 为空，说明图正常结束（不需要工具的情况）
      yield { type: 'done' }; // 发送完成事件
    }
  }

  async *resumeExecution(threadId: string): AsyncGenerator<LangGraphEvent> { // 恢复被中断的 Agent 执行
    // 重新构建相同配置的图（checkpointer 是同一个 Redis 实例，之前保存的 State 还在）
    const app = this.buildHitlGraph();

    const config = { // 构建配置（thread_id 必须和暂停时一致）
      configurable: { thread_id: threadId }, // 用相同的 thread_id 找到之前的 State 快照
    };

    // stream(null, config) 是恢复执行的关键！
    // null 告诉 LangGraph："不传新输入，从上次 checkpointer 保存的状态继续"
    // 使用 streamWithTokens 实现 token 级流式输出
    yield* this.streamWithTokens(app, null, config);

    // 检查恢复执行后是否又遇到了新的中断（Agent 又要调工具）
    const state = await app.getState(config); // 获取恢复执行后的 State 快照
    if (state.next && state.next.length > 0) { // 如果又被中断了
      yield { // 再次发送 interrupt 事件，前端再次展示确认面板
        type: 'interrupt',
        content: '⏸️ Agent 想要执行更多工具调用，等待人工确认...', // 提示文本
        interruptValue: { nextNodes: state.next }, // 待执行节点
      };
    } else { // 没有更多中断，图执行完毕
      yield { type: 'done' }; // 发送完成事件
    }
  }
}
