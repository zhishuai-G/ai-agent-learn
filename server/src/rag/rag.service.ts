import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import type { Embeddings } from '@langchain/core/embeddings';

/**
 * RAG 服务 - Phase 4: 检索增强生成
 *
 * 核心流程：
 * 用户问题 → 向量化 → 检索相关文档 → 文档 + 问题 → LLM → 回答
 *
 * 学习要点：
 * 1. Document Loaders: 从各种来源加载文档
 * 2. Text Splitters: 将长文档分割成适合检索的块（chunking）
 * 3. Embeddings: 将文本转换为向量表示
 * 4. Vector Store: 存储向量并支持相似度搜索
 * 5. RAG Chain: 组合检索和生成的完整管线
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);

  /** 文本分块器 - 递归字符分块（推荐方式） */
  private textSplitter: RecursiveCharacterTextSplitter;

  /** 向量嵌入模型 */
  private embeddings: Embeddings;

  /** 内存向量存储（生产环境可换成 Chroma/Pgvector） */
  private vectorStore: MemoryVectorStore;

  /** LLM 模型 */
  private llm: ChatOpenAI;

  /** 已加载的文档数量 */
  private documentCount = 0;

  constructor(private configService: ConfigService) {
    // 1. 初始化文本分块器
    // chunkSize: 每块最大字符数
    // chunkOverlap: 相邻块之间的重叠字符数（保证上下文连贯性）
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', ''], // 中文友好分隔符
    });

    // 2. 初始化 Embedding 模型
    // 使用阿里云 DashScope 的 Embedding API（OpenAI 兼容格式）
    // Chat 模型和 Embedding 模型在不同平台，所以用单独的 API Key 和 Base URL
    // DashScope 支持：text-embedding-v1 / text-embedding-v2 / text-embedding-v3
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey:
        this.configService.get<string>('EMBEDDING_API_KEY') ||
        this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        baseURL:
          this.configService.get<string>('EMBEDDING_BASE_URL') ||
          this.configService.get<string>('OPENAI_BASE_URL'),
      },
      modelName:
        this.configService.get<string>('EMBEDDING_MODEL') ||
        'text-embedding-v1',
      batchSize: 25, // DashScope 每次最多 25 条，OpenAI 默认 512 会超限
    });

    // 3. 初始化 LLM
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
      modelName: 'GLM-5',
      temperature: 0.3, // RAG 场景使用较低温度，让回答更准确
    });
  }

  async onModuleInit() {
    // 初始化空的向量存储
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this.logger.log('RAG 服务初始化完成，向量存储已就绪');
  }

  /**
   * 添加文档到知识库
   *
   * 流程：原始文档 → 分块 → 向量化 → 存储
   */
  async addDocument(
    content: string,
    metadata?: Record<string, string>,
  ): Promise<{ chunksAdded: number }> {
    // 1. 创建 Document 对象
    const doc = new Document({
      pageContent: content,
      metadata: metadata || {},
    });

    // 2. 分块
    const chunks = await this.textSplitter.splitDocuments([doc]);
    this.logger.log(
      `文档分块完成: ${content.length} 字符 → ${chunks.length} 块`,
    );

    // 3. 添加到向量存储（自动进行向量化）
    await this.vectorStore.addDocuments(chunks);
    this.documentCount += chunks.length;

    return { chunksAdded: chunks.length };
  }

  /**
   * 从网页加载文档
   *
   * 使用 Cheerio 加载器解析网页内容
   */
  async addWebDocument(url: string): Promise<{ chunksAdded: number }> {
    this.logger.log(`开始加载网页: ${url}`);

    // 1. 使用 Cheerio 加载网页
    const loader = new CheerioWebBaseLoader(url);
    const docs = await loader.load();

    // 2. 分块
    const chunks = await this.textSplitter.splitDocuments(docs);
    this.logger.log(`网页加载完成: ${chunks.length} 块`);

    // 3. 添加到向量存储
    await this.vectorStore.addDocuments(chunks);
    this.documentCount += chunks.length;

    return { chunksAdded: chunks.length };
  }

  /**
   * 检索相关文档
   *
   * 使用向量相似度搜索找到最相关的文档块
   */
  async retrieve(
    query: string,
    topK = 4,
  ): Promise<Array<{ content: string; score: number; metadata: Record<string, unknown> }>> {
    // similaritySearchWithScore 返回文档和相似度分数
    const results = await this.vectorStore.similaritySearchWithScore(
      query,
      topK,
    );

    return results.map(([doc, score]) => ({
      content: doc.pageContent,
      score: score,
      metadata: doc.metadata,
    }));
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
    // 1. 检索相关文档
    const retrievedDocs = await this.retrieve(question, topK);

    if (retrievedDocs.length === 0) {
      return {
        answer: '抱歉，知识库中没有找到相关信息。请先添加一些文档。',
        sources: [],
      };
    }

    // 2. 构建 RAG Prompt
    const ragPrompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `你是一个专业的问答助手。请基于以下提供的上下文信息来回答用户的问题。

要求：
- 只使用上下文中的信息来回答，不要编造内容
- 如果上下文中没有足够的信息，请诚实地说"根据现有资料无法回答"
- 回答要准确、简洁、有条理
- 如果可能，请标注信息来源

上下文信息：
{context}`,
      ],
      ['human', '{question}'],
    ]);

    // 3. 构建 RAG Chain
    const ragChain = RunnableSequence.from([
      {
        context: () =>
          retrievedDocs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n'),
        question: new RunnablePassthrough(),
      },
      ragPrompt,
      this.llm,
      new StringOutputParser(),
    ]);

    // 4. 执行问答
    const answer = await ragChain.invoke(question);

    return {
      answer,
      sources: retrievedDocs,
    };
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
    // 1. 检索相关文档
    const retrievedDocs = await this.retrieve(question, topK);

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

    // 2. 构建 RAG Prompt
    const ragPrompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `你是一个专业的问答助手。请基于以下提供的上下文信息来回答用户的问题。

要求：
- 只使用上下文中的信息来回答，不要编造内容
- 如果上下文中没有足够的信息，请诚实地说"根据现有资料无法回答"
- 回答要准确、简洁、有条理

上下文信息：
{context}`,
      ],
      ['human', '{question}'],
    ]);

    // 3. 构建 RAG Chain（流式）
    const ragChain = RunnableSequence.from([
      {
        context: () =>
          retrievedDocs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n'),
        question: new RunnablePassthrough(),
      },
      ragPrompt,
      this.llm,
      new StringOutputParser(),
    ]);

    // 4. 流式执行
    const stream = await ragChain.stream(question);

    for await (const chunk of stream) {
      yield { type: 'token', data: chunk };
    }

    yield { type: 'done', data: null };
  }

  /**
   * 获取知识库状态
   */
  getStatus(): { documentCount: number; isReady: boolean } {
    return {
      documentCount: this.documentCount,
      isReady: this.documentCount > 0,
    };
  }

  /**
   * 清空知识库
   */
  async clearKnowledgeBase(): Promise<void> {
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this.documentCount = 0;
    this.logger.log('知识库已清空');
  }
}
