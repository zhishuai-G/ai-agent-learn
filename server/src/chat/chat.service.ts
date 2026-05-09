import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { AvailableModel } from '../llm/llm.service';
import OpenAI from 'openai';

/**
 * Chat 服务 - 管理对话逻辑
 *
 * Phase 1 学习要点：
 * 1. 对话历史管理：维护 messages 数组，保持上下文
 * 2. System Prompt：通过 system 消息设定 AI 角色和行为
 * 3. Context Window：需注意对话历史不能超过模型的 token 限制
 */
@Injectable()
export class ChatService {
  constructor(private readonly llmService: LlmService) {}

  /**
   * 构建完整的消息列表（system prompt + 对话历史 + 当前消息）
   */
  private buildMessages(
    message: string,
    history: OpenAI.ChatCompletionMessageParam[] = [],
    systemPrompt?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // 1. 添加 System Prompt（角色设定）
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 2. 添加对话历史
    messages.push(...history);

    // 3. 添加当前用户消息
    messages.push({ role: 'user', content: message });

    return messages;
  }

  /**
   * 普通聊天 - 一次性返回
   */
  async chat(
    message: string,
    history: OpenAI.ChatCompletionMessageParam[] = [],
    systemPrompt?: string,
  ): Promise<string> {
    const messages = this.buildMessages(message, history, systemPrompt);
    return this.llmService.chat(messages);
  }

  /**
   * 流式聊天 - 逐 token 返回
   * deepThink 为 true 时使用推理模型
   */
  async *chatStream(
    message: string,
    history: OpenAI.ChatCompletionMessageParam[] = [],
    systemPrompt?: string,
    deepThink?: boolean,
  ): AsyncGenerator<string> {
    const messages = this.buildMessages(message, history, systemPrompt);
    const model = deepThink ? AvailableModel.DEEPSEEK_V4_PRO: undefined;
    yield* this.llmService.chatStream(messages, model);
  }
}
