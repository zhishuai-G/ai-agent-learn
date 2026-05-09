import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * 可用模型枚举
 * 来源：OneAPI 平台可用模型列表
 */
export enum AvailableModel {
  // 推荐模型（毕业项目默认支持）
  DEEPSEEK_V4_FLASH = 'deepseek-v4-flash',
  DEEPSEEK_V4_PRO = 'deepseek-v4-pro',
  KIMI_K2_6 = 'kimi-k2.6',
  // 其他可用模型
  CLAUDE_OPUS_4_6 = 'Claude Opus 4.6',
  CLAUDE_SONNET_4_6 = 'Claude Sonnet 4.6',
  GPT_5_4 = 'GPT-5.4',
  GEMINI_3_PRO = 'Gemini 3 Pro',
  GLM_5 = 'GLM-5',
  GLM_5_1 = 'glm-5.1',
  KIMI_K2_5 = 'Kimi K2.5',
}

/**
 * LLM 服务 - 封装 OpenAI SDK
 *
 * Phase 1 学习要点：
 * 1. OpenAI SDK 基础用法：chat.completions.create
 * 2. 流式输出：stream: true，逐 chunk 返回
 * 3. Temperature：控制输出随机性（0=确定性，1=创造性）
 * 4. Messages 角色：system（系统设定）、user（用户输入）、assistant（模型回复）
 */
@Injectable()
export class LlmService {
  private client: OpenAI;
  private model: string;

  constructor(private configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
    });
    this.model = AvailableModel.DEEPSEEK_V4_FLASH;
  }

  /**
   * 普通聊天 - 一次性返回完整结果
   */
  async chat(messages: OpenAI.ChatCompletionMessageParam[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content || '';
  }

  /**
   * 流式聊天 - 逐 token 返回（AsyncGenerator）
   *
   * 学习要点：
   * - stream: true 会让 API 返回一个异步迭代器
   * - 每个 chunk 包含 delta.content（增量文本）
   * - 使用 yield* 或 for-await-of 消费
   */
  async *chatStream(
    messages: OpenAI.ChatCompletionMessageParam[],
    model?: string,
  ): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: model || this.model,
      messages,
      temperature: 0.7,
      stream: true,
    });

    for await (const chunk of stream) {
      console.log('[Stream Chunk]', JSON.stringify(chunk));
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
    console.log('[Stream] Done');
  }
}
