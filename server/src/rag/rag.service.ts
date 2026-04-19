import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';                          // LLM 对话模型
import { ChatPromptTemplate } from '@langchain/core/prompts';            // Prompt 模板构建器
import { StringOutputParser } from '@langchain/core/output_parsers';     // 将 LLM 输出解析为纯字符串
import {
  RunnableSequence,    // 将多个步骤串成流水线（链式调用）
  RunnablePassthrough, // 透传输入，不做任何处理（用于把 question 原样传下去）
} from '@langchain/core/runnables';
import { RagDocumentService } from './rag-document.service'; // 文档管理服务（向量存储 + 检索）

/**
 * RAG 服务
 *
 * 职责：RAG 问答链的构建与执行
 * 文档的加载/分块/向量化/检索 委托给 RagDocumentService
 *
 * 核心流程（用户每次提问时执行）：
 *   问题 → 检索相关 chunk → 拼入 Prompt → LLM 生成回答
 */
@Injectable()
export class RagService {
  /** 对话 LLM，用于最终根据检索结果生成回答 */
  private llm: ChatOpenAI;

  constructor(
    private configService: ConfigService,
    private ragDocumentService: RagDocumentService, // 注入文档服务，用于检索 chunk
  ) {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),   // 从 .env 读取 API Key
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),     // 从 .env 读取代理地址
      },
      modelName: this.configService.get<string>('OPENAI_MODEL', 'GLM-5'), // 模型名，默认 GLM-5
      temperature: 0.3, // RAG 场景用低温度：减少模型"发挥"，让回答更忠实于检索内容
    });
  }

  /**
   * 构建 RAG Prompt 模板
   *
   * Prompt 结构：
   *   system: 角色设定 + 约束（只能用上下文回答）+ 检索到的 chunk 原文
   *   human:  用户的实际问题
   *
   * {context} 和 {question} 是占位符，运行时由 buildRagChain 填入
   */
  private buildRagPrompt(withSourceAnnotation = true) {
    // 普通问答时要求标注来源，流式问答时不要求（避免影响流式体验）
    const sourceInstruction = withSourceAnnotation
      ? '\n- 如果可能，请标注信息来源'
      : '';

    return ChatPromptTemplate.fromMessages([
      [
        'system',
        // 系统 Prompt：告诉 LLM 它的角色和行为约束
        // {context} 占位符 → 运行时替换为检索到的 chunk 原文（参考资料）
        `你是一个专业的问答助手。请基于以下提供的上下文信息来回答用户的问题。

要求：
- 只使用上下文中的信息来回答，不要编造内容
- 如果上下文中没有足够的信息，请诚实地说"根据现有资料无法回答"
- 回答要准确、简洁、有条理${sourceInstruction}

上下文信息：
{context}`,
      ],
      ['human', '{question}'], // 用户问题占位符 → 运行时替换为实际问题
    ]);
  }

  /**
   * 构建 RAG Chain（流水线）
   *
   * Chain 执行顺序：
   *   Step 1: 准备输入变量（context + question）
   *   Step 2: 填充 Prompt 模板（{context} 和 {question} 替换为真实值）
   *   Step 3: 调用 LLM（发送完整 Prompt，获取回答）
   *   Step 4: 解析输出（将 LLM 返回的 AIMessage 对象转成纯字符串）
   */
  private buildRagChain(
    retrievedDocs: Array<{ content: string }>, // 已检索到的 chunk 列表
    withSourceAnnotation = true,
  ) {
    return RunnableSequence.from([
      {
        // Step 1a: 将所有 chunk 原文拼成 context 字符串，格式 "[1] 内容\n\n[2] 内容..."
        context: () =>
          retrievedDocs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n'),
        // Step 1b: question 直接透传（RunnablePassthrough 不做任何处理，原样传给下一步）
        question: new RunnablePassthrough(),
      },
      this.buildRagPrompt(withSourceAnnotation), // Step 2: 用 context + question 填充 Prompt 模板
      this.llm,                                  // Step 3: 将填充好的 Prompt 发给 LLM
      new StringOutputParser(),                  // Step 4: 把 LLM 的 AIMessage 对象转成纯字符串
    ]);
  }

  /**
   * RAG 一次性问答（返回完整答案）
   * 适合：不需要流式、直接拿到结果的场景
   */
  async query(
    question: string,
    topK = 4, // 检索最相关的前 4 个 chunk 作为参考资料
  ): Promise<{ answer: string; sources: Array<{ content: string; score: number; metadata: Record<string, unknown> }> }> {
    // 第一步：检索（问题向量化 → 与 chunk 向量计算相似度 → 返回 topK 个最相关 chunk）
    const retrievedDocs = await this.ragDocumentService.retrieve(question, topK);

    // 知识库为空时提前返回，避免无意义的 LLM 调用
    if (retrievedDocs.length === 0) {
      return {
        answer: '抱歉，知识库中没有找到相关信息。请先添加一些文档。',
        sources: [],
      };
    }

    // 第二步：构建 Chain（context + question → Prompt → LLM → 字符串）
    const ragChain = this.buildRagChain(retrievedDocs);
    // 第三步：执行 Chain，invoke 会等待 LLM 生成完整回答后一次性返回
    const answer = await ragChain.invoke(question);

    return { answer, sources: retrievedDocs }; // 同时返回答案和引用来源
  }

  /**
   * RAG 流式问答（SSE 逐 token 推送）
   *
   * 使用 AsyncGenerator（async *）：函数可以多次 yield，每次 yield 推送一个事件给前端
   * 事件类型：
   *   source → 检索结果（先推送，让前端立即显示引用来源）
   *   token  → LLM 生成的每个文字片段（逐字显示效果）
   *   done   → 结束信号
   */
  async *queryStream(
    question: string,
    topK = 4,
  ): AsyncGenerator<{ type: 'source' | 'token' | 'done'; data: unknown }> {
    // 第一步：检索最相关的 chunk
    const retrievedDocs = await this.ragDocumentService.retrieve(question, topK);

    // 立即推送检索来源，前端收到后马上渲染"引用来源"面板（不用等 LLM 生成完）
    yield { type: 'source', data: retrievedDocs };

    // 知识库为空：推送提示文字后结束
    if (retrievedDocs.length === 0) {
      yield {
        type: 'token',
        data: '抱歉，知识库中没有找到相关信息。请先添加一些文档。',
      };
      yield { type: 'done', data: null };
      return; // 终止 generator
    }

    // 第二步：构建 Chain（流式问答不要求标注来源，保持输出简洁）
    const ragChain = this.buildRagChain(retrievedDocs, false);
    // 第三步：stream() 返回异步迭代器，LLM 每生成一个 token 就 yield 一次
    const stream = await ragChain.stream(question);

    // 逐 token 推送给前端，实现打字机效果
    for await (const chunk of stream) {
      yield { type: 'token', data: chunk }; // chunk 是每次 LLM 输出的文字片段（1~几个字）
    }

    yield { type: 'done', data: null }; // 推送结束信号，前端停止 loading
  }
}
