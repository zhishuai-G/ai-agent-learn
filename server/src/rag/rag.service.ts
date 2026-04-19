import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { RagDocumentService } from './rag-document.service';

/**
 * RAG 服务 - Phase 4: 检索增强生成
 *
 * 职责：RAG 问答链的构建与执行（query / queryStream）
 * 文档管理委托给 RagDocumentService
 */
@Injectable()
export class RagService {
  /** LLM 模型 */
  private llm: ChatOpenAI;

  constructor(
    private configService: ConfigService,
    private ragDocumentService: RagDocumentService,
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
      modelName: this.configService.get<string>('OPENAI_MODEL', 'GLM-5'),
      temperature: 0.3, // RAG 场景使用较低温度，让回答更准确
    });
  }

  /** 构建 RAG Prompt 模板 */
  private buildRagPrompt(withSourceAnnotation = true) {
    const sourceInstruction = withSourceAnnotation
      ? '\n- 如果可能，请标注信息来源'
      : '';

    return ChatPromptTemplate.fromMessages([
      [
        'system',
        `你是一个专业的问答助手。请基于以下提供的上下文信息来回答用户的问题。

要求：
- 只使用上下文中的信息来回答，不要编造内容
- 如果上下文中没有足够的信息，请诚实地说"根据现有资料无法回答"
- 回答要准确、简洁、有条理${sourceInstruction}

上下文信息：
{context}`,
      ],
      ['human', '{question}'],
    ]);
  }

  /** 构建 RAG Chain */
  private buildRagChain(
    retrievedDocs: Array<{ content: string }>,
    withSourceAnnotation = true,
  ) {
    return RunnableSequence.from([
      {
        context: () =>
          retrievedDocs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n'),
        question: new RunnablePassthrough(),
      },
      this.buildRagPrompt(withSourceAnnotation),
      this.llm,
      new StringOutputParser(),
    ]);
  }

  /**
   * RAG 问答 - 核心方法
   *
   * 完整流程：
   * 1. 检索相关文档
   * 2. 将文档作为上下文注入 prompt
   * 3. LLM 基于上下文生成答案
   */
  async query(
    question: string,
    topK = 4,
  ): Promise<{ answer: string; sources: Array<{ content: string; score: number; metadata: Record<string, unknown> }> }> {
    const retrievedDocs = await this.ragDocumentService.retrieve(question, topK);

    if (retrievedDocs.length === 0) {
      return {
        answer: '抱歉，知识库中没有找到相关信息。请先添加一些文档。',
        sources: [],
      };
    }

    const ragChain = this.buildRagChain(retrievedDocs);
    const answer = await ragChain.invoke(question);

    return { answer, sources: retrievedDocs };
  }

  /**
   * RAG 流式问答
   *
   * 与普通问答相同，但答案以流式方式返回
   */
  async *queryStream(
    question: string,
    topK = 4,
  ): AsyncGenerator<{ type: 'source' | 'token' | 'done'; data: unknown }> {
    const retrievedDocs = await this.ragDocumentService.retrieve(question, topK);

    // 先返回检索到的来源
    yield { type: 'source', data: retrievedDocs };

    if (retrievedDocs.length === 0) {
      yield {
        type: 'token',
        data: '抱歉，知识库中没有找到相关信息。请先添加一些文档。',
      };
      yield { type: 'done', data: null };
      return;
    }

    const ragChain = this.buildRagChain(retrievedDocs, false);
    const stream = await ragChain.stream(question);

    for await (const chunk of stream) {
      yield { type: 'token', data: chunk };
    }

    yield { type: 'done', data: null };
  }
}
