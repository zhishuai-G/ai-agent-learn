# Phase 4: RAG (检索增强生成)

## 目录

- [4.1 RAG 核心原理](#41-rag-核心原理)
- [4.2 文档处理管线](#42-文档处理管线)
- [4.3 向量数据库](#43-向量数据库)
- [4.4 检索策略](#44-检索策略)
- [4.5 高级 RAG 模式](#45-高级-rag-模式)
- [4.6 练习项目](#46-练习项目)

---

## 4.1 RAG 核心原理

### 核心流程

```
用户问题 → 向量化 → 检索相关文档 → 文档 + 问题 → LLM → 回答
```

### 为什么需要 RAG

- LLM 知识有截止日期，无法获取最新信息
- LLM 无法访问私有数据（企业文档、产品文档等）
- 减少幻觉：基于真实文档回答
- 成本更低：比微调模型便宜很多

---

## 4.2 文档处理管线

### Document Loaders

```typescript
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { RecursiveUrlLoader } from '@langchain/community/document_loaders/web/recursive_url';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';

// 加载 PDF
const pdfDocs = await new PDFLoader('path/to/file.pdf').load();

// 加载网页
const webDocs = await new CheerioWebBaseLoader('https://...').load();
```

### Text Splitters

```typescript
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,        // 每块大小
  chunkOverlap: 200,      // 重叠区域
  separators: ['\n\n', '\n', '。', '，', ' '], // 中文友好分隔符
});

const chunks = await splitter.splitDocuments(docs);
```

### 分块策略对比

- **固定大小分块**: 简单但可能切断语义
- **递归字符分块**: 按段落 > 句子 > 词逐级分割（推荐）
- **语义分块**: 基于 embedding 相似度分块（效果好但较慢）
- **Markdown/HTML 分块**: 按文档结构分块（结构化文档推荐）

---

## 4.3 向量数据库

### Embedding

```typescript
import { OpenAIEmbeddings } from '@langchain/openai';

const embeddings = new OpenAIEmbeddings({
  modelName: 'text-embedding-3-small', // 性价比高
});

// 单条向量化
const vector = await embeddings.embedQuery('什么是React Hooks?');
// 批量向量化
const vectors = await embeddings.embedDocuments(['doc1', 'doc2']);
```

### 向量数据库选型

| 数据库 | 特点 | 适合场景 |
|--------|------|----------|
| Chroma | 轻量，内嵌式 | 开发/原型 |
| Pgvector | PostgreSQL 扩展 | 已有 PG 的项目 |
| Pinecone | 全托管云服务 | 不想运维 |
| Milvus | 高性能，分布式 | 大规模生产 |
| FAISS | Meta 开源，纯内存 | 小规模快速搜索 |

### Chroma 集成示例

```typescript
import { Chroma } from '@langchain/community/vectorstores/chroma';

// 创建并存储
const vectorStore = await Chroma.fromDocuments(chunks, embeddings, {
  collectionName: 'my-docs',
  url: 'http://localhost:8000',
});

// 检索
const results = await vectorStore.similaritySearch('React性能优化', 4);
```

---

## 4.4 检索策略

### 基础检索

```typescript
// 作为 retriever 使用
const retriever = vectorStore.asRetriever({
  k: 4,                    // 返回 top-4 结果
  searchType: 'similarity', // 或 'mmr' (多样性)
});

const docs = await retriever.invoke('问题');
```

### 高级检索技术

1. **Multi-Query Retriever**: LLM 生成多个查询变体，扩大检索范围
2. **Contextual Compression**: 检索后压缩文档，只保留相关部分
3. **Ensemble Retriever**: 结合向量检索 + 关键词检索 (BM25)
4. **Parent Document Retriever**: 检索小块，返回父文档（上下文更完整）

### RAG Chain

```typescript
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { createRetrievalChain } from 'langchain/chains/retrieval';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', '基于以下上下文回答问题。如果不确定，说不知道。\n\n{context}'],
  ['human', '{input}'],
]);

const documentChain = await createStuffDocumentsChain({ llm: model, prompt });
const retrievalChain = await createRetrievalChain({
  retriever,
  combineDocsChain: documentChain,
});

const result = await retrievalChain.invoke({ input: '...' });
// result.answer + result.context (引用来源)
```

---

## 4.5 高级 RAG 模式

### Agentic RAG (LangGraph + RAG)

将 RAG 集成到 LangGraph Agent 中，Agent 可以：
- 动态决定是否需要检索
- 评估检索结果质量，决定是否重新检索
- 组合多个知识源

```
用户问题 → Agent → [需要检索?]
                      ├→ 是 → 检索 → [结果够好?]
                      │                ├→ 否 → 重写查询 → 再检索
                      │                └→ 是 → 生成回答
                      └→ 否 → 直接回答
```

### Self-RAG

LLM 自我评估检索结果的相关性和回答的可靠性：
1. 检索文档
2. LLM 评估文档相关性（grading）
3. 基于相关文档生成回答
4. LLM 评估回答是否有幻觉
5. 不合格则重试

### Corrective RAG (CRAG)

在检索结果不理想时，自动切换到网络搜索补充信息。

---

## 4.6 练习项目

### 项目: 智能文档问答系统

**目标**: 构建一个可以上传文档并智能问答的全栈应用

**功能要求**:
1. 文档上传（PDF、Markdown、网页 URL）
2. 自动分块、向量化、存储
3. 基于文档内容的智能问答
4. 引用来源标注（显示答案来自哪个文档的哪一段）
5. Agentic RAG: Agent 判断是否需要检索，支持追问

**技术要点**:
- NestJS: 文件上传 + 文档处理管线 + RAG chain
- Chroma/Pgvector: 向量存储
- React: 文档管理界面 + 对话界面 + 引用来源高亮
- LangGraph: 将 RAG 纳入 Agent 图中
