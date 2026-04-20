/**
 * Phase 5: Multi-Agent 流式事件工具
 *
 * 扩展 Phase 3 的 streamWithTokens 模式，增加多 Agent 特有事件：
 * - agent_start: Agent 开始执行
 * - agent_end: Agent 执行完毕
 * - handoff: Agent 间交接控制权
 *
 * 核心原理：通过 streamEvents v2 的 metadata.langgraph_node 检测 Agent 切换
 */
import type { BaseMessage } from '@langchain/core/messages';

/** Multi-Agent SSE 事件类型 */
export interface MultiAgentEvent {
  type:
    | 'agent_start'
    | 'agent_end'
    | 'handoff'
    | 'content'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'done'
    | 'error';
  agent?: string;
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
  result?: string;
  from?: string;
  to?: string;
  error?: string;
}

/**
 * 多 Agent 流式执行方法
 *
 * 使用 streamEvents v2 实现 token 级流式输出，
 * 同时追踪 Agent 切换并发出 handoff 事件。
 *
 * 事件映射：
 * - metadata.langgraph_node 变化 → agent_start / agent_end / handoff
 * - on_chat_model_stream → content / reasoning（逐 token）
 * - on_chat_model_end → tool_call
 * - on_tool_end → tool_result
 */
export async function* streamMultiAgent(
  app: any,
  input: { messages: BaseMessage[] } | null,
  config: Record<string, any>,
): AsyncGenerator<MultiAgentEvent> {
  const eventStream = app.streamEvents(input, {
    ...config,
    version: 'v2',
  });

  let currentNode = '';
  let isInThinkTag = false;

  for await (const event of eventStream) {
    const node: string | undefined = event.metadata?.langgraph_node;

    // 检测 Agent 切换（通过 langgraph_node 元数据）
    if (node && node !== currentNode) {
      if (currentNode) {
        yield { type: 'agent_end', agent: currentNode };
        yield { type: 'handoff', from: currentNode, to: node };
      }
      currentNode = node;
      yield { type: 'agent_start', agent: node };
    }

    switch (event.event) {
      // ---- Token 级流式输出 ----
      case 'on_chat_model_stream': {
        if (!event.name?.startsWith('Chat')) break;

        const chunk = event.data?.chunk;
        if (!chunk) break;

        // 处理原生 reasoning_content（DeepSeek 等模型）
        const reasoning = chunk.additional_kwargs?.reasoning_content;
        if (reasoning && typeof reasoning === 'string') {
          yield { type: 'reasoning', content: reasoning, agent: currentNode };
          break;
        }

        let text = typeof chunk.content === 'string' ? chunk.content : '';
        if (!text) break;

        // 流式解析 <think> 标签
        if (isInThinkTag) {
          const closeIdx = text.indexOf('</think>');
          if (closeIdx !== -1) {
            const thinkPart = text.slice(0, closeIdx);
            if (thinkPart) yield { type: 'reasoning', content: thinkPart, agent: currentNode };
            isInThinkTag = false;
            const after = text.slice(closeIdx + 8);
            if (after) yield { type: 'content', content: after, agent: currentNode };
          } else {
            yield { type: 'reasoning', content: text, agent: currentNode };
          }
        } else {
          const openIdx = text.indexOf('<think>');
          if (openIdx !== -1) {
            const before = text.slice(0, openIdx);
            if (before) yield { type: 'content', content: before, agent: currentNode };
            isInThinkTag = true;
            const after = text.slice(openIdx + 7);
            if (after) {
              const closeIdx = after.indexOf('</think>');
              if (closeIdx !== -1) {
                const thinkPart = after.slice(0, closeIdx);
                if (thinkPart) yield { type: 'reasoning', content: thinkPart, agent: currentNode };
                isInThinkTag = false;
                const rest = after.slice(closeIdx + 8);
                if (rest) yield { type: 'content', content: rest, agent: currentNode };
              } else {
                yield { type: 'reasoning', content: after, agent: currentNode };
              }
            }
          } else {
            yield { type: 'content', content: text, agent: currentNode };
          }
        }
        break;
      }

      // ---- 工具调用（LLM 完成时提取） ----
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
              agent: currentNode,
            };
          }
        }
        break;
      }

      // ---- 工具执行结果 ----
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
            agent: currentNode,
          };
        }
        break;
      }
    }
  }

  // 最后一个 Agent 结束
  if (currentNode) {
    yield { type: 'agent_end', agent: currentNode };
  }
}
