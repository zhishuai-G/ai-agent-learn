import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

/**
 * LangChain 服务 - 封装 LangChain.js 核心组件
 *
 * Phase 2 学习要点：
 * 1. ChatOpenAI：LangChain 对 OpenAI 兼容模型的封装
 * 2. LCEL（LangChain Expression Language）：用 .pipe() 串联组件
 * 3. Prompt Template：模板化 Prompt 管理
 * 4. Output Parser：解析模型输出
 */
@Injectable()
export class LangChainService {
  private model: ChatOpenAI;

  constructor(private configService: ConfigService) {
    this.model = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
      modelName: this.configService.get<string>('OPENAI_MODEL') || 'GLM-5',
      temperature: Number(this.configService.get<string>('OPENAI_TEMPERATURE', '0.7')),
    });
  }

  /**
   * 获取底层 ChatOpenAI 模型实例
   * 用于 bindTools、withStructuredOutput 等场景
   */
  getModel(): ChatOpenAI {
    return this.model;
  }

  /**
   * LCEL Chain 示例：Prompt → Model → StringOutputParser
   *
   * 这就是 LangChain 最核心的范式：
   * 用 .pipe() 把组件串成一条可执行的链
   */
  buildChain(systemTemplate: string) {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', systemTemplate],
      ['human', '{input}'],
    ]);

    return prompt.pipe(this.model).pipe(new StringOutputParser());
  }
}
