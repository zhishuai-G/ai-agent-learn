import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangChainService } from '../langchain/langchain.service';
import { weatherTool, timeTool, searchTool } from '../langchain/tools';
import {
  Annotation,
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { streamWithTokens } from './langgraph-stream.util';
import type { LangGraphEvent } from './langgraph-stream.util';

// 重新导出，供 controller 使用
export type { LangGraphEvent };

@Injectable()
export class LangGraphService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LangGraphService.name);

  private tools = [weatherTool, timeTool, searchTool];

  private toolMap: Record<string, (typeof this.tools)[number]> = Object.fromEntries(
    this.tools.map((t) => [t.name, t]),
  );

  private checkpointer!: RedisSaver;

  constructor(
    private readonly langchainService: LangChainService,
    private readonly configService: ConfigService,
  ) { }

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    try {
      this.checkpointer = await RedisSaver.fromUrl(redisUrl);
      this.logger.log(`Redis checkpointer connected: ${redisUrl}`);
    } catch (error) {
      this.logger.warn(
        `Redis 连接失败 (${redisUrl})，HiTL 功能将不可用: ${error.message}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.checkpointer) {
      await this.checkpointer.end();
      this.logger.log('Redis checkpointer disconnected');
    }
  }

  /**
   * 构建通用的工具执行节点函数
   */
  private buildCallTools() {
    return async (state: { messages: BaseMessage[] }) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      const toolMessages: ToolMessage[] = [];

      for (const toolCall of lastMessage.tool_calls || []) {
        this.logger.log(`Node [tools]: executing ${toolCall.name}`);
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
  }

  /**
   * 通用条件路由：判断 AI 是否需要调用工具
   */
  private shouldContinue(state: { messages: BaseMessage[] }) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return 'continue';
    }
    return 'end';
  }

  // ==================== 方式一：自定义 StateGraph ====================

  async *chatWithStateGraph(
    message: string,
    threadId?: string,
    history: Array<{ role: string; content: string }> = [],
    systemPrompt?: string,
  ): AsyncGenerator<LangGraphEvent> {
    const model = this.langchainService.getModel();

    const AgentState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (current, update) => [...current, ...update],
      }),
    });

    const modelWithTools = model.bindTools(this.tools);

    const callModel = async (
      state: typeof AgentState.State,
      config?: RunnableConfig,
    ) => {
      this.logger.log('Node [agent]: calling LLM...');
      const response = await modelWithTools.invoke(state.messages, config);
      return { messages: [response] };
    };

    const graph = new StateGraph(AgentState)
      .addNode('agent', callModel)
      .addNode('tools', this.buildCallTools())
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', this.shouldContinue, {
        continue: 'tools',
        end: END,
      })
      .addEdge('tools', 'agent');

    const app = graph.compile({
      checkpointer: this.checkpointer,
    });

    // 构建初始消息列表
    const messages: BaseMessage[] = [];
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    for (const msg of history) {
      if (msg.role === 'user') messages.push(new HumanMessage(msg.content));
      else if (msg.role === 'assistant') messages.push(new AIMessage(msg.content));
    }
    messages.push(new HumanMessage(message));

    const config = {
      configurable: { thread_id: threadId || `thread-${Date.now()}` },
    };

    yield* streamWithTokens(app, { messages }, config);
    yield { type: 'done' };
  }

  // ==================== 方式二：createReactAgent ====================

  async *chatWithReactAgent(
    message: string,
    threadId?: string,
    systemPrompt?: string,
  ): AsyncGenerator<LangGraphEvent> {
    const model = this.langchainService.getModel();

    const agent = createReactAgent({
      llm: model,
      tools: this.tools,
      ...(systemPrompt ? { prompt: systemPrompt } : {}),
      checkpointSaver: this.checkpointer,
    });

    const config = {
      configurable: { thread_id: threadId || `react-${Date.now()}` },
    };

    yield* streamWithTokens(agent, { messages: [new HumanMessage(message)] }, config);
    yield { type: 'done' };
  }

  // ==================== 方式三：Human-in-the-Loop ====================

  private buildHitlGraph(systemPrompt?: string) {
    const model = this.langchainService.getModel();

    const AgentState = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (current, update) => [...current, ...update],
      }),
    });

    const modelWithTools = model.bindTools(this.tools);

    const callModel = async (
      state: typeof AgentState.State,
      config?: RunnableConfig,
    ) => {
      const msgs = systemPrompt
        ? [new SystemMessage(systemPrompt), ...state.messages]
        : state.messages;
      this.logger.log('Node [agent] (HiTL): calling LLM...');
      const response = await modelWithTools.invoke(msgs, config);
      return { messages: [response] };
    };

    const graph = new StateGraph(AgentState)
      .addNode('agent', callModel)
      .addNode('tools', this.buildCallTools())
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', this.shouldContinue, {
        continue: 'tools',
        end: END,
      })
      .addEdge('tools', 'agent');

    return graph.compile({
      checkpointer: this.checkpointer,
      interruptBefore: ['tools'],
    });
  }

  async *chatWithHumanInTheLoop(
    message: string,
    threadId: string,
    systemPrompt?: string,
  ): AsyncGenerator<LangGraphEvent> {
    const app = this.buildHitlGraph(systemPrompt);

    const config = {
      configurable: { thread_id: threadId },
    };

    yield* streamWithTokens(
      app,
      { messages: [new HumanMessage(message)] },
      config,
    );

    const state = await app.getState(config);
    if (state.next && state.next.length > 0) {
      yield {
        type: 'interrupt',
        content: '⏸️ Agent 想要执行工具调用，等待人工确认...',
        interruptValue: { nextNodes: state.next },
      };
    } else {
      yield { type: 'done' };
    }
  }

  async *resumeExecution(threadId: string): AsyncGenerator<LangGraphEvent> {
    const app = this.buildHitlGraph();

    const config = {
      configurable: { thread_id: threadId },
    };

    yield* streamWithTokens(app, null, config);

    const state = await app.getState(config);
    if (state.next && state.next.length > 0) {
      yield {
        type: 'interrupt',
        content: '⏸️ Agent 想要执行更多工具调用，等待人工确认...',
        interruptValue: { nextNodes: state.next },
      };
    } else {
      yield { type: 'done' };
    }
  }
}
