import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

/** 前端可选择的三种模型 */
export const SUPPORTED_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k2.6'] as const;
export type SupportedModel = typeof SUPPORTED_MODELS[number];

/**
 * LangChain 服务 - 封装 LangChain.js 核心组件
 *
 * 毕业项目增强：支持运行时切换模型
 * - getModel(): 返回默认模型（向后兼容）
 * - getModel(modelName): 返回指定模型（动态切换）
 */
@Injectable()
export class LangChainService {
  private defaultModel: ChatOpenAI;
  private modelCache = new Map<string, ChatOpenAI>();

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const defaultModelName = this.configService.get<string>('OPENAI_MODEL') || 'deepseek-v4-flash';
    const temperature = this.resolveTemperature(defaultModelName);

    this.defaultModel = this.createModel(apiKey!, baseURL!, defaultModelName, temperature);
  }

  /**
   * 获取 ChatOpenAI 模型实例
   * - 不传参：返回默认模型（向后兼容）
   * - 传 modelName：返回指定模型（动态切换）
   */
  getModel(modelName?: string): ChatOpenAI {
    if (!modelName) return this.defaultModel;

    // 缓存已创建的模型实例，避免重复创建
    if (this.modelCache.has(modelName)) {
      return this.modelCache.get(modelName)!;
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const temperature = this.resolveTemperature(modelName);

    const model = this.createModel(apiKey!, baseURL!, modelName, temperature);
    this.modelCache.set(modelName, model);
    return model;
  }

  /** kimi-k2.6 要求 temperature 必须为 1 */
  private resolveTemperature(modelName: string): number {
    if (modelName.includes('kimi')) return 1;
    const envTemp = this.configService.get<string>('OPENAI_TEMPERATURE');
    return envTemp ? Number(envTemp) : 0.7;
  }

  /**
   * 缓存历史 AIMessage 的 reasoning_content，按 tool_call_id 或 content 指纹索引。
   *
   * 背景：DeepSeek 等支持 thinking 的模型要求——只要上一轮 assistant 消息产生过
   * reasoning_content，下一轮请求在把这条 assistant 消息写回 messages[] 时就必须
   * 带上 reasoning_content，否则返回 400 "The reasoning_content in the thinking
   * mode must be passed back to the API."。
   *
   * 然而 @langchain/openai 的 convertMessagesToCompletionsMessageParams 在序列化
   * 出站 body 时会丢弃 additional_kwargs.reasoning_content。在 Multi-Agent 模式下，
   * supervisor 生成的 AIMessage 会流转给 pm / developer 等子 Agent，此时子 Agent
   * 的 LLM 调用历史中包含这条 assistant 消息，就会触发上述 400。
   *
   * 解决方案：
   * - handleLLMEnd 回调里把本轮 LLM 输出的 reasoning_content 按 tool_call_id 或
   *   content 指纹放进缓存。
   * - 通过 OpenAI SDK 的 fetch 选项在请求出站时拦截，遇到命中缓存的 assistant 消息
   *   就把 reasoning_content 补回 body。
   */
  readonly reasoningCache = new Map<string, string>();

  /** 为 assistant 消息生成多组 key，出入站任一命中即可复用 reasoning_content。 */
  getMessageKeys(msg: {
    tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
    content?: unknown;
  }): string[] {
    const keys: string[] = [];
    const firstToolId = msg.tool_calls?.[0]?.id;
    if (firstToolId) keys.push(`tc:${firstToolId}`);
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      keys.push(`c:${msg.content.length}:${msg.content.slice(0, 80)}`);
    }
    return keys;
  }

  /** 外部（如 stream util）在捕获到 LLM 输出时也能写入缓存。 */
  cacheReasoning(msg: { tool_calls?: any; content?: unknown; additional_kwargs?: any }): void {
    const rc = msg?.additional_kwargs?.reasoning_content;
    if (!rc || typeof rc !== 'string') return;
    for (const k of this.getMessageKeys({ tool_calls: msg.tool_calls, content: msg.content })) {
      this.reasoningCache.set(k, rc);
    }
  }

  private createModel(apiKey: string, baseURL: string, modelName: string, temperature: number): ChatOpenAI {
    const cache = this.reasoningCache;
    const getKeys = this.getMessageKeys.bind(this);

    // 出站拦截：命中缓存就回填，未命中也补空串兜底（DeepSeek 接受存在但为空）
    const customFetch: typeof fetch = async (input, init) => {
      if (init?.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          if (Array.isArray(body?.messages)) {
            let mutated = false;
            for (const m of body.messages) {
              if (m?.role !== 'assistant' || m.reasoning_content) continue;
              let hit: string | undefined;
              for (const k of getKeys(m)) {
                if (cache.has(k)) {
                  hit = cache.get(k);
                  break;
                }
              }
              m.reasoning_content = hit ?? '';
              mutated = true;
            }
            if (mutated) {
              init = { ...init, body: JSON.stringify(body) };
            }
          }
        } catch {
          // body 不是 JSON 就直接透传
        }
      }
      return fetch(input as any, init as any);
    };

    return new ChatOpenAI({
      openAIApiKey: apiKey,
      configuration: { baseURL, fetch: customFetch },
      modelName,
      temperature,
      callbacks: [
        {
          handleLLMEnd: (output) => {
            const gens = output?.generations?.[0];
            if (!Array.isArray(gens)) return;
            for (const g of gens) {
              this.cacheReasoning((g as any).message ?? {});
            }
          },
        },
      ],
    });
  }

  /**
   * LCEL Chain 示例：Prompt → Model → StringOutputParser
   */
  buildChain(systemTemplate: string) {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemTemplate],
      ['human', '{input}'],
    ]);

    return prompt.pipe(this.defaultModel).pipe(new StringOutputParser());
  }
}
