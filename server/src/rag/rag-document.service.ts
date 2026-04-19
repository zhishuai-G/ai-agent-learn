import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'; // 文本分块器
import { OpenAIEmbeddings } from '@langchain/openai';                       // Embedding 模型（将文本转成向量）
import { Document } from '@langchain/core/documents';                       // LangChain 统一文档数据结构
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'; // 静态网页加载器
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'; // 内存向量存储（开发用）
import type { Embeddings } from '@langchain/core/embeddings';               // Embedding 模型接口类型

/**
 * RAG 文档管理服务
 *
 * RAG 两阶段流程：
 *
 * 【索引阶段 - 提前做】
 *   文档/网页 → 加载 → 分块 → Embedding（文本转向量）→ 存入向量库（向量 + 原文）
 *
 * 【检索阶段 - 用户提问时】
 *   问题 → Embedding（转向量）→ 与库中所有 chunk 计算余弦相似度 → 取最相关的 topK 块原文 → 给 LLM
 */
@Injectable()
export class RagDocumentService implements OnModuleInit {
  private readonly logger = new Logger(RagDocumentService.name);

  /**
   * 文本分块器
   * 为什么分块：LLM context 有限，无法塞整篇文档；分块后每块语义集中，向量化更精准
   * RecursiveCharacterTextSplitter：优先在段落/句子边界切，保证语义完整
   */
  private textSplitter: RecursiveCharacterTextSplitter;

  /**
   * Embedding 模型
   * 作用：把文本转成高维向量（如 1536 维）
   * 语义相近的文本 → 向量在空间中距离近；语义无关的文本 → 向量距离远
   * 例："React Hooks" 和 "useState 函数" 向量相近，"今天天气" 向量很远
   */
  private embeddings: Embeddings;

  /**
   * 内存向量存储
   * 每个 chunk 存两份数据：
   *   向量（[-0.12, 0.34, ...]）→ 用于相似度检索
   *   原文（"Hooks are..."）    → 检索到后塞给 LLM 阅读
   * 注意：内存存储，服务重启后数据丢失
   */
  private vectorStore: MemoryVectorStore;

  /** 已存入的 chunk 总数，用于前端显示知识库状态 */
  private documentCount = 0;

  constructor(private configService: ConfigService) {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,    // 每块最大 1000 字符，太大超 LLM context，太小丢失上下文
      chunkOverlap: 200,  // 相邻块重叠 200 字符，防止关键句子被切断导致语义断裂
      separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', ''], // 优先在段落/句子边界切，中文友好
    });

    this.embeddings = new OpenAIEmbeddings({
      // 优先用独立的 Embedding API Key（如 DashScope），没配则 fallback 到主模型 API Key
      openAIApiKey:
        this.configService.get<string>('EMBEDDING_API_KEY') ||
        this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        // 优先用独立的 Embedding Base URL，没配则 fallback 到主模型 Base URL
        baseURL:
          this.configService.get<string>('EMBEDDING_BASE_URL') ||
          this.configService.get<string>('OPENAI_BASE_URL'),
      },
      // Embedding 模型名，DashScope 用 text-embedding-v1，OpenAI 用 text-embedding-3-small 等
      modelName:
        this.configService.get<string>('EMBEDDING_MODEL') ||
        'text-embedding-v1',
      batchSize: 25, // 每次批量发送的 chunk 数，DashScope 上限 25，OpenAI 默认 512
    });
  }

  async onModuleInit() {
    // 服务启动时创建空的内存向量存储，传入 embeddings 供后续向量化使用
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this.logger.log('RAG 文档服务初始化完成，向量存储已就绪');
  }

  /**
   * 添加纯文本文档到知识库
   * 适合：直接粘贴的文档、FAQ、产品说明等
   */
  async addDocument(
    content: string,
    metadata?: Record<string, string>,
  ): Promise<{ chunksAdded: number }> {
    // 将字符串包装成 LangChain Document 对象（统一数据结构，携带 pageContent + metadata）
    const doc = new Document({
      pageContent: content,   // 原始文本内容
      metadata: metadata || {}, // 附加信息（来源、标题等），会随 chunk 一起存储
    });

    // 按 chunkSize/chunkOverlap 规则切块，返回 Document[] 数组
    const chunks = await this.textSplitter.splitDocuments([doc]);
    this.logger.log(
      `文档分块完成: ${content.length} 字符 → ${chunks.length} 块`,
    );
    // DEBUG 模式下打印每块前 100 字符，用于确认切块是否合理
    chunks.forEach((chunk, i) => {
      this.logger.debug(`[chunk ${i + 1}] ${chunk.pageContent.slice(0, 100).replace(/\n/g, ' ')}...`);
    });

    // addDocuments 内部做两件事：
    // 1. 调用 this.embeddings 将每个 chunk.pageContent 转成向量（调用 Embedding API）
    // 2. 将「向量 + 原文 + metadata」打包存入内存
    await this.vectorStore.addDocuments(chunks);
    this.documentCount += chunks.length; // 累加 chunk 总数

    return { chunksAdded: chunks.length };
  }

  /**
   * 从网页 URL 加载文档
   *
   * CheerioWebBaseLoader：静态 HTML 解析，不执行 JS
   * 适合：服务端渲染的静态网站
   * 不适合：Next.js/React SPA（内容靠 JS 渲染，Cheerio 拿不到）
   *         → SPA 网站需改用 PlaywrightWebBaseLoader（启动无头浏览器渲染后再抓）
   */
  async addWebDocument(url: string): Promise<{ chunksAdded: number }> {
    this.logger.log(`开始加载网页: ${url}`);

    const loader = new CheerioWebBaseLoader(url); // 创建网页加载器，指定目标 URL
    const docs = await loader.load();             // 发送 HTTP 请求，解析 HTML，提取文本内容

    // 打印原始内容总长度，用于判断是否抓到有效内容
    // 若长度很小（几十字符）或内容是 JS 代码，说明该网站需要换 Playwright
    this.logger.log(`网页原始内容长度: ${docs.map(d => d.pageContent.length).reduce((a, b) => a + b, 0)} 字符`);
    // 打印前 200 字符预览，直观判断内容质量
    this.logger.debug(`原始内容前 200 字符: ${docs[0]?.pageContent.slice(0, 200).replace(/\n/g, ' ')}`);

    // 对加载到的文档内容进行分块（同 addDocument 逻辑）
    const chunks = await this.textSplitter.splitDocuments(docs);
    this.logger.log(`网页加载完成: ${chunks.length} 块`);
    // 只打前 3 块，避免日志刷屏，足够判断内容是否正常
    chunks.slice(0, 3).forEach((chunk, i) => {
      this.logger.debug(`[chunk ${i + 1} 完整内容]\n${chunk.pageContent}\n${'─'.repeat(60)}`);
    });

    // 将所有 chunk 向量化并存入内存（向量 + 原文）
    await this.vectorStore.addDocuments(chunks);

    // 额外验证：单独对第一个 chunk 调用 embedQuery，打印向量维度和前 5 个值
    // 正常：1536 维，值域约 -3 ~ 3；异常（如 API 超时）：此行会抛错
    const sampleEmbedding = await this.embeddings.embedQuery(chunks[0].pageContent);
    this.logger.debug(`[embedding 维度] ${sampleEmbedding.length} 维，前5值: [${sampleEmbedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);

    this.documentCount += chunks.length;

    return { chunksAdded: chunks.length };
  }

  /**
   * 检索与用户问题最相关的文档块
   *
   * 流程：
   * 1. 将 query 调用 Embedding API 转成向量
   * 2. 计算 query 向量与内存中所有 chunk 向量的余弦相似度
   *    余弦相似度 = cos(两向量夹角)，值越接近 1 表示语义越相近
   * 3. 按相似度降序取前 topK 个 chunk，返回其原文 + 分数 + metadata
   * 4. RagService 拿到这些原文后拼入 Prompt，让 LLM 基于它们回答用户问题
   */
  async retrieve(
    query: string,
    topK = 4, // 默认取相似度最高的 4 个 chunk，可按需调整（多了 token 消耗大，少了可能漏关键信息）
  ): Promise<Array<{ content: string; score: number; metadata: Record<string, unknown> }>> {
    // similaritySearchWithScore 返回 [Document, score][] 数组
    // score 是距离值（越小越相似），前端展示时用 1-score 转成相似度百分比
    const results = await this.vectorStore.similaritySearchWithScore(
      query, // 用户问题（内部自动向量化后再计算）
      topK,  // 返回最相关的前 K 个
    );

    return results.map(([doc, score]) => ({
      content: doc.pageContent, // 原文，后续作为"参考资料"拼入 LLM 的 Prompt
      score,                    // 相似度分数，供前端显示"相似度: 0.85"
      metadata: doc.metadata,   // 来源信息（url、title 等），供前端显示引用来源
    }));
  }

  /** 获取知识库状态，供前端显示"已加载 X 个文档块" */
  getStatus(): { documentCount: number; isReady: boolean } {
    return {
      documentCount: this.documentCount,
      isReady: this.documentCount > 0, // 有 chunk 才算就绪，否则 RAG 无意义
    };
  }

  /** 清空知识库：重建一个空的 MemoryVectorStore，原有所有向量和原文全部丢弃 */
  async clearKnowledgeBase(): Promise<void> {
    this.vectorStore = new MemoryVectorStore(this.embeddings); // 重新实例化，旧数据自动 GC
    this.documentCount = 0;
    this.logger.log('知识库已清空');
  }
}
