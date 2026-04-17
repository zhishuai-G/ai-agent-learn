import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * SSE 事件接口 —— 定义了前端能收到的所有事件类型
 */
export interface LangGraphEvent {
  type: 'node' | 'tool_call' | 'tool_result' | 'content' | 'reasoning' | 'interrupt' | 'done' | 'error';
  node?: string;
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
  result?: string;
  content?: string;
  error?: string;
  interruptValue?: unknown;
}

/**
 * 从 AIMessage 中提取推理/思考内容
 * 支持两种来源：
 * 1. additional_kwargs.reasoning_content（DeepSeek 等模型原生支持）
 * 2. content 中的 <think>...</think> 标签（通用方案）
 */
export function extractReasoning(msg: AIMessage): { reasoning: string; content: string } {
  let reasoning = '';
  let content = typeof msg.content === 'string' ? msg.content : '';

  const nativeReasoning = msg.additional_kwargs?.reasoning_content;
  if (nativeReasoning && typeof nativeReasoning === 'string') {
    reasoning = nativeReasoning;
  }

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
export function* processAIMessage(msg: AIMessage): Generator<LangGraphEvent> {
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

  const { reasoning, content } = extractReasoning(msg);

  if (reasoning) {
    yield { type: 'reasoning', content: reasoning };
  }

  if (content.length > 0) {
    yield { type: 'content', content };
  }
}

/**
 * 通用流式执行方法 —— 使用 streamEvents 实现 token 级流式输出
 *
 * 替代原来的 app.stream()，核心区别：
 * - app.stream()：节点级输出，LLM 完整生成后才返回
 * - streamEvents：token 级输出，LLM 每生成一个 token 就推送
 *
 * 事件映射：
 * - on_chat_model_stream → reasoning / content（逐 token）
 * - on_chat_model_end   → tool_call（完整工具调用信息）
 * - on_tool_end         → tool_result（工具执行结果）
 * - metadata.langgraph_node 变化 → node（节点切换）
 */
export async function* streamWithTokens(
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
    const node = event.metadata?.langgraph_node;
    if (node && node !== currentNode) {
      currentNode = node;
      yield { type: 'node', node };
    }

    switch (event.event) {
      case 'on_chat_model_stream': {
        if (!event.name?.startsWith('Chat')) break;

        const chunk = event.data?.chunk;
        if (!chunk) break;

        const reasoning = chunk.additional_kwargs?.reasoning_content;
        if (reasoning && typeof reasoning === 'string') {
          yield { type: 'reasoning', content: reasoning };
          break;
        }

        let text = typeof chunk.content === 'string' ? chunk.content : '';
        if (!text) break;

        // 流式解析 <think> 标签
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

      case 'on_chat_model_end': {
        if (!event.name?.startsWith('Chat')) break;
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
