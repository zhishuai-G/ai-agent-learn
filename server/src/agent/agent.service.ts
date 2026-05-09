import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '../langchain/langchain.service';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { weatherTool, timeTool, searchTool } from '../langchain/tools';

/**
 * Agent 事件类型 —— 前端靠 type 字段区分不同的 SSE 事件
 */
export interface AgentEvent {
  type: 'tool_call' | 'tool_result' | 'content' | 'done' | 'error';
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
  result?: string;
  content?: string;
  error?: string;
}

/**
 * Agent 服务 - 实现 Tool Use 循环
 *
 * Phase 2 核心学习内容：
 * 1. bindTools()：把工具绑定到模型，让 LLM 知道有哪些工具可用
 * 2. Tool Use 循环：LLM 判断是否需要工具 → 调用 → 结果回传 → 继续判断
 * 3. 这就是 ReAct Agent 的雏形，Phase 3 的 LangGraph 会将此标准化
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  // 所有可用工具
  private tools = [weatherTool, timeTool, searchTool];

  // 工具名 → 工具实例的映射，方便根据名字查找
  private toolMap: Record<string, (typeof this.tools)[number]> = Object.fromEntries(
    this.tools.map((t) => [t.name, t]),
  );

  constructor(private readonly langchainService: LangChainService) {}

  /**
   * Tool Use 循环（核心！）
   *
   * 工作流程：
   * 1. 用户消息 → LLM（绑定了工具）
   * 2. LLM 返回结果：
   *    - 如果有 tool_calls → 执行工具 → 把结果加入消息列表 → 回到第 1 步
   *    - 如果没有 tool_calls → 直接返回文本（对话结束）
   *
   * 每一步都 yield 事件，前端可以实时展示调用链路
   */
  async *chat(
    message: string,
    history: Array<{ role: string; content: string }> = [],
    systemPrompt?: string,
    model?: string,
  ): AsyncGenerator<AgentEvent> {
    const llm = this.langchainService.getModel(model);

    // 关键！bindTools 让模型知道有哪些工具可用
    // 模型会在 response 里通过 tool_calls 字段告诉我们该调哪个工具
    const modelWithTools = llm.bindTools(this.tools);

    // 构建 LangChain 消息列表
    const messages: BaseMessage[] = [];
    if (systemPrompt) {
      messages.push(new SystemMessage(systemPrompt));
    }
    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage(msg.content));
      }
    }
    messages.push(new HumanMessage(message));

    // Tool Use 循环 —— 最多循环 10 次，防止无限循环
    const MAX_ITERATIONS = 10;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      this.logger.log(`Tool Use Loop iteration ${i + 1}`);

      const response = await modelWithTools.invoke(messages);

      // 检查是否有 tool_calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        // 先把 AI 的带 tool_calls 的消息加入历史
        messages.push(response);

        // 逐个执行工具调用
        for (const toolCall of response.tool_calls) {
          this.logger.log(
            `Calling tool: ${toolCall.name} with args: ${JSON.stringify(toolCall.args)}`,
          );

          // 通知前端：正在调用工具
          yield {
            type: 'tool_call',
            name: toolCall.name,
            args: toolCall.args as Record<string, unknown>,
            id: toolCall.id,
          };

          // 查找并执行工具
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

          // 通知前端：工具返回了结果
          yield {
            type: 'tool_result',
            name: toolCall.name,
            result,
            id: toolCall.id,
          };

          // 把工具结果作为 ToolMessage 加入消息列表
          // tool_call_id 必须和 tool_call 的 id 对应，这样 LLM 知道这是哪个调用的结果
          messages.push(
            new ToolMessage({
              content: result,
              tool_call_id: toolCall.id || '',
            }),
          );
        }

        // 继续循环 —— 让 LLM 看到工具结果后决定下一步
        continue;
      }

      // 没有 tool_calls —— LLM 已经准备好最终回答
      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      yield { type: 'content', content };
      break;
    }

    yield { type: 'done' };
  }
}
