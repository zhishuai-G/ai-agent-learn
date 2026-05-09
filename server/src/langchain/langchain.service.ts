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

  private createModel(apiKey: string, baseURL: string, modelName: string, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      openAIApiKey: apiKey,
      configuration: { baseURL },
      modelName,
      temperature,
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
