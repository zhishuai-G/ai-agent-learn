import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import type { Embeddings } from '@langchain/core/embeddings';

/**
 * RAG 文档管理服务
 *
 * 职责：文档加载、分块、向量化、检索、知识库生命周期管理
 * 与 RagService（问答逻辑）分离，遵循单一职责原则
 */
@Injectable()
export class RagDocumentService implements OnModuleInit {
  private readonly logger = new Logger(RagDocumentService.name);

  /** 文本分块器 - 递归字符分块（推荐方式） */
  private textSplitter: RecursiveCharacterTextSplitter;

  /** 向量嵌入模型 */
  private embeddings: Embeddings;

  /** 内存向量存储（生产环境可换成 Chroma/Pgvector） */
  private vectorStore: MemoryVectorStore;

  /** 已加载的文档数量 */
  private documentCount = 0;

  constructor(private configService: ConfigService) {
    // 初始化文本分块器
    // chunkSize: 每块最大字符数
    // chunkOverlap: 相邻块之间的重叠字符数（保证上下文连贯性）
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', ''], // 中文友好分隔符
    });

    // 初始化 Embedding 模型
    // 使用阿里云 DashScope 的 Embedding API（OpenAI 兼容格式）
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
  }

  async onModuleInit() {
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this.logger.log('RAG 文档服务初始化完成，向量存储已就绪');
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
    const doc = new Document({
      pageContent: content,
      metadata: metadata || {},
    });

    const chunks = await this.textSplitter.splitDocuments([doc]);
    this.logger.log(
      `文档分块完成: ${content.length} 字符 → ${chunks.length} 块`,
    );

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

    const loader = new CheerioWebBaseLoader(url);
    const docs = await loader.load();

    const chunks = await this.textSplitter.splitDocuments(docs);
    this.logger.log(`网页加载完成: ${chunks.length} 块`);

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
