这个系列记录一个有 React + NestJS 经验的前端开发者，从零学习 AI Agent 的全过程。上一篇我们用 LangGraph 实现了状态图 Agent——StateGraph、ReAct Agent、Human-in-the-Loop。这一篇进入 **Phase 4**——

**让 AI 不再"胡说八道"，而是基于你的私有文档来回答问题。用 Document Loaders 加载各种格式的文档；用 Text Splitters 把长文档切成语义连贯的块；用 Embeddings 把文本转成向量；用 Vector Store 存储和检索；最后用 RAG Chain 把检索和生成组合成完整的问答系统。**

全文分为四个部分：

- **Part 1：RAG 核心原理** —— 是什么、为什么、核心流程、和 Phase 1-3 的关系
- **Part 2：文档处理管线** —— Document Loaders + Text Splitters（五步构建法前两步）
- **Part 3：向量存储与检索** —— Embeddings + Vector Store + Retriever（五步构建法后三步）
- **Part 4：RAG Chain 实战** —— Prompt 设计 + Chain 构建 + 流式输出 + 完整执行链路

---

# Part 1：RAG 核心原理

## 1.1 LLM 的局限性：为什么需要 RAG？

Phase 1-3 我们一直在用 LLM 回答问题，但 LLM 有三个致命的局限：

1. **知识有截止日期**：GPT-4 的训练数据截止到某个时间点，问它"2024 年的新闻"它不知道
2. **无法访问私有数据**：你公司的产品文档、内部 wiki、客户数据——LLM 根本没见过
3. **容易"幻觉"**：不知道的事情它会编，而且编得很像真的

```plain
用户：我们公司的退款政策是什么？

Phase 1-3 的 LLM（纯靠记忆）：
  → "一般来说，退款政策是 30 天内可退..."（编的，不是你公司的政策）

Phase 4 的 RAG（基于检索）：
  → [先检索公司文档] → 找到《退款政策 v2.1》
  → "根据贵公司文档，退款政策为 7 天无理由退款..."（基于真实文档）
```

Phase 2 用 Tool Use 让 LLM 调用外部 API（天气、搜索等），Phase 3 用 LangGraph 让 Agent 自动编排多轮工具调用。但它们解决的是"获取实时信息"的问题——API 能提供的信息是有限的。

**如果你有 100 页的产品文档、500 篇技术博客、或者 10GB 的内部 wiki 呢？** 你不可能为每篇文档写一个 API。你需要的是——**让 AI 直接从你的文档中检索信息，然后基于检索结果回答问题。**

这就是 RAG。

**RAG（Retrieval-Augmented Generation）= 检索增强生成**，核心思想是：

> 回答问题前，先从知识库检索相关文档，然后让 LLM 基于检索到的内容来回答。

## 1.2 RAG 核心流程

RAG 有两个阶段：

```plain
阶段一：文档入库（离线，只做一次）
  原始文档 → 加载 → 分块 → 向量化 → 存入向量数据库

阶段二：检索问答（在线，每次提问都执行）
  用户问题 → 向量化 → 检索相关文档 → 文档+问题 → LLM → 回答
```

用一张图看整个流程：

```plain
┌─────────────────────────────────────────────────────────────────────┐
│ 阶段一：文档入库（Indexing）                                           │
│                                                                      │
│   [PDF/网页/Markdown/纯文本]                                          │
│          ↓                                                           │
│   [Document Loaders]  → 加载原始内容，转成 Document 对象                │
│          ↓                                                           │
│   [Text Splitters]    → 分块（Chunking），切成 500-1500 字符的小块      │
│          ↓                                                           │
│   [Embeddings]        → 向量化，把文本转成 1536 维向量                   │
│          ↓                                                           │
│   [Vector Store]      → 存储向量 + 原文（Chroma/Pgvector/内存）         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 阶段二：检索问答（Retrieval + Generation）                             │
│                                                                      │
│   "什么是 React Hooks？"                                              │
│          ↓                                                           │
│   [Embeddings]        → 把问题也转成向量                                │
│          ↓                                                           │
│   [Vector Store]      → 相似度搜索，找 top-K 最相关的文档块              │
│          ↓                                                           │
│   [RAG Prompt]        → 文档块 + 原始问题 组合成 Prompt                  │
│          ↓                                                           │
│   [LLM]               → 基于上下文生成回答（不再靠记忆瞎编）              │
│          ↓                                                           │
│   "React Hooks 是 React 16.8 引入的..."（带引用来源）                   │
└─────────────────────────────────────────────────────────────────────┘
```

**对比 Phase 2 的 Tool Use，理解 RAG 的定位：**

```plain
Phase 2（Tool Use）：
  用户: "北京天气怎么样？"
  → LLM 决定调用 get_weather 工具
  → fetch("https://wttr.in/北京")
  → 返回实时天气数据
  → LLM 基于 API 结果回答

Phase 4（RAG）：
  用户: "我们公司的退款政策是什么？"
  → Embeddings 把问题转成向量
  → Vector Store 搜索最相关的文档块
  → 找到《退款政策》文档的第 3 段
  → LLM 基于文档内容回答

区别：
  Tool Use → 调用 API 获取实时数据（天气、时间、搜索）
  RAG      → 从已有文档中检索知识（产品文档、技术博客、内部 wiki）
```

## 1.3 RAG vs 微调 vs 长上下文

三种让 LLM "学会"新知识的方式对比：

```plain
1. RAG（检索增强生成）
   原理：回答前先检索相关文档，注入 Prompt
   优点：实时更新、成本低、可追溯来源
   缺点：检索质量影响回答
   适合：文档会更新、需要标注来源、数据量大

2. 微调（Fine-tuning）
   原理：重新训练模型权重
   优点：知识内化、无需检索
   缺点：成本高（几千美元/次）、更新慢、易过拟合
   适合：领域特定的语气风格、固定不变的知识

3. 长上下文（Long Context）
   原理：把所有文档塞进 Prompt
   优点：简单粗暴、无需额外架构
   缺点：Token 贵、有上限（128K-200K）、无法扩展
   适合：文档量极小（< 50 页）
```

**大多数场景选 RAG**：
- 文档会更新（产品文档、新闻、wiki）→ RAG 只需重新入库，不用重新训练
- 需要标注来源（"这个回答基于《用户手册》第 3 章"）→ RAG 天然支持
- 成本敏感（微调一次几千美元，RAG 几乎免费）
- 数据量大（100MB 文档塞不进 Prompt，但 RAG 只检索最相关的几段）

## 1.4 RAG 和 Phase 1-3 的关系

**RAG 不替代前三个 Phase，而是在 LangChain 基础上新增了一条"知识管线"。**

```plain
Phase 1（原始 SDK）：
  └── 直接调 OpenAI SDK → 纯对话，靠模型预训练知识

Phase 2（LangChain + Tool Use）：
  ├── LangChainService → ChatOpenAI 模型封装
  ├── tools/           → 三个工具定义（天气、时间、搜索）
  └── agent.service.ts → 手写 Tool Use 循环

Phase 3（LangGraph 状态图）：
  ├── 复用 LangChainService → 获取模型实例
  ├── 复用 tools/           → 工具不用重新定义
  └── langgraph.service.ts → 图结构替代手写循环

Phase 4（RAG）：              ← 🆕
  ├── 新建 RagService         → 独立的 RAG 管线
  │     ├── Document Loaders  → 加载文档
  │     ├── Text Splitters    → 分块
  │     ├── Embeddings        → 向量化（⚠️ 和 Chat 模型不同！）
  │     ├── Vector Store      → 存储和检索
  │     └── RAG Chain         → 检索 + LLM 生成
  └── 复用 ConfigService      → 共用 .env 中的 API Key 和 Base URL
```

Phase 4 和前三个 Phase 有一个关键区别：**它需要两种不同的模型**。

```plain
Phase 1-3 只用一种模型：
  ChatOpenAI（Chat 模型）→ GLM-5 / GPT-4 等
  功能：对话、推理、生成文本

Phase 4 需要两种模型：
  1. ChatOpenAI（Chat 模型）→ GLM-5（OneAPI 平台）
     功能：基于检索到的文档生成回答（和 Phase 1-3 一样）

  2. OpenAIEmbeddings（Embedding 模型）→ text-embedding-v1（阿里云 DashScope）← 🆕
     功能：把文本转成向量（用于检索）
     ⚠️ Chat 模型和 Embedding 模型是完全不同的模型！
     ⚠️ 不能用 GLM-5 做 Embedding，也不能用 text-embedding-v1 做对话
     ⚠️ 两个模型可以在不同平台上——Chat 用 OneAPI，Embedding 用 DashScope
```

**为什么 Embedding 模型不能用 Chat 模型代替？**

```plain
Chat 模型（GLM-5）：
  输入: "什么是 React Hooks？"
  输出: "React Hooks 是 React 16.8 引入的新特性..."（自然语言文本）

Embedding 模型（text-embedding-v1）：
  输入: "什么是 React Hooks？"
  输出: [0.12, -0.34, 0.56, ..., 0.78]（1536 维数值向量）

它们是两种完全不同的任务：
  Chat → 输入文本，输出文本（生成）
  Embedding → 输入文本，输出向量（表示）

向量是用来做相似度搜索的——两段文本的向量越接近，语义越相似。
Chat 模型没有这个能力。
```

## 1.5 项目结构

在 Phase 3 的基础上新增 `rag/` 模块：

```
server/src/
├── llm/                       # Phase 1（保留）
├── chat/                      # Phase 1（保留）
├── langchain/                 # Phase 2（保留）
│   ├── langchain.service.ts   # ChatOpenAI 封装
│   └── tools/                 # 三个工具
├── agent/                     # Phase 2（保留）
├── langgraph/                 # Phase 3（保留）
└── rag/                       # Phase 4 🆕
    ├── rag.module.ts          # NestJS 模块注册
    ├── rag.controller.ts      # 6 个 API 端点
    ├── rag.service.ts         # 核心：Document 处理 + RAG Chain
    └── dto/
        └── rag.dto.ts         # 请求/响应 DTO
```

四个阶段的模块并存：

```
AppModule
├── ChatModule → LlmModule（Phase 1：原始 OpenAI SDK）
├── AgentModule → LangChainModule（Phase 2：LangChain.js + 手写 Tool Use）
├── LangGraphModule → LangChainModule（Phase 3：LangGraph 状态图）
└── RagModule → LlmModule（Phase 4：RAG 检索增强生成）🆕
```

模块注册：

```typescript
// src/rag/rag.module.ts
@Module({
  imports: [LlmModule],          // 复用 Phase 1 的 ConfigService
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}

// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,       // Phase 1
    AgentModule,      // Phase 2
    LangGraphModule,  // Phase 3
    RagModule,        // Phase 4 🆕
  ],
})
export class AppModule {}
```

### 安装依赖

```bash
npm install @langchain/community @langchain/textsplitters @langchain/classic cheerio --legacy-peer-deps
```

```plain
包名                       用途
─────────────────────────  ──────────────────────────────────────
@langchain/community       Document Loaders（PDF、网页、CSV 等）
@langchain/textsplitters   Text Splitters（分块器）
@langchain/classic         MemoryVectorStore（内存向量存储）
cheerio                    CheerioWebBaseLoader 的依赖（解析 HTML）
```

> `@langchain/openai`（Phase 2 已安装）提供 `OpenAIEmbeddings`，不需要额外装。

### 环境变量配置

```plain
# .env

# ─── Phase 1-3 共用（Chat 模型） ───────────────────
OPENAI_API_KEY=sk-xxxxx          # OneAPI 的 API Key
OPENAI_BASE_URL=http://xxx/v1    # OneAPI 的 Base URL
OPENAI_MODEL=GLM-5               # Chat 模型

# ─── Phase 4 新增（Embedding 模型） ────────────────
# 🆕 Embedding 模型和 Chat 模型可以在不同平台上
# 本项目：Chat 用 OneAPI（智谱 GLM-5），Embedding 用阿里云 DashScope
EMBEDDING_API_KEY=sk-xxxxx                                          # DashScope 的 API Key
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  # DashScope OpenAI 兼容端点
EMBEDDING_MODEL=text-embedding-v1                                    # DashScope Embedding 模型
```

⚠️ **关键点：Chat 和 Embedding 的 API 配置是独立的。** 代码中会优先读 `EMBEDDING_*` 环境变量，如果没配就降级用 `OPENAI_*`（适合 Chat 和 Embedding 在同一平台的情况）。

**阿里云 DashScope Embedding 模型对比：**

```plain
模型名               维度    CMTEB 分数（越高越好）    推荐场景
───────────────────  ──────  ─────────────────────  ──────────────────
text-embedding-v1    1536    59.84                  基础场景（本项目使用）
text-embedding-v2    1536    62.17                  通用场景
text-embedding-v3    1024    68.92                  最新最强，推荐

DashScope 的优势：
  ✅ 中文效果好（专门为中文优化）
  ✅ 价格低廉（百炼平台免费额度较大）
  ✅ OpenAI 兼容 API（直接用 OpenAIEmbeddings）
  ✅ 无需翻墙

API 文档：https://help.aliyun.com/zh/model-studio/use-embedding-models
```

### API 端点预览

```plain
POST /rag/documents        → 添加文本文档到知识库
POST /rag/documents/web    → 从网页加载文档到知识库
POST /rag/query            → RAG 问答（一次性返回）
POST /rag/query/stream     → RAG 流式问答（SSE）
GET  /rag/status           → 获取知识库状态
DELETE /rag/documents      → 清空知识库
```

## 1.6 五步构建法概览

和 Phase 3 的 StateGraph"六步构建法"类似，RAG 也有清晰的构建步骤：

```plain
Step 1: Document Loaders  → 加载原始文档，转成 Document 对象
Step 2: Text Splitters    → 把长文档切成小块（Chunking）
Step 3: Embeddings        → 把文本块转成向量
Step 4: Vector Store      → 存储向量 + 支持相似度搜索
Step 5: RAG Chain         → 检索 + Prompt + LLM → 生成回答
```

```plain
对比 Phase 3 的六步构建法：

Phase 3（StateGraph）：                Phase 4（RAG）：
  Step 1: 定义 State                     Step 1: Document Loaders
  Step 2: 定义节点函数                     Step 2: Text Splitters
  Step 3: 定义条件路由                     Step 3: Embeddings
  Step 4: 构建图                          Step 4: Vector Store
  Step 5: 编译图                          Step 5: RAG Chain
  Step 6: 流式执行

  核心：图结构（Node + Edge）             核心：管线（Load → Split → Embed → Store → Retrieve）
  输入：用户消息                           输入：用户问题 + 文档库
  输出：工具调用 + 文本回答                输出：基于文档的回答 + 引用来源
```

接下来 Part 2-4 会按这五步逐一讲解。

---

# Part 2：文档处理管线

## 2.1 Document Loaders：加载各种格式

Document Loaders 是 RAG 管线的第一步——把各种格式的原始内容加载成 LangChain 的 `Document` 对象。

```typescript
// Document 对象的结构（来自 @langchain/core/documents）
interface Document {
  pageContent: string;              // 文本内容
  metadata: Record<string, any>;    // 元数据（来源、页码、URL 等）
}
```

`Document` 是 LangChain 中文档处理的统一数据结构，所有 Loader 都输出 `Document[]`，所有 Splitter 都接收 `Document[]`，所有 Vector Store 都存储 `Document`。**就像 React 中所有组件都返回 JSX 一样，是整个管线的"通用货币"。**

### 支持的格式（@langchain/community）

```plain
文件类型：
  PDFLoader          → PDF 文件（每页一个 Document）
  TextLoader         → 纯文本文件
  CSVLoader          → CSV 表格（每行一个 Document）
  DocxLoader         → Word 文档
  JSONLoader         → JSON 文件（可指定 jsonPointer 提取特定字段）
  UnstructuredLoader → 通用格式（需要 Unstructured API）

网页类型：
  CheerioWebBaseLoader   → 静态网页（本项目使用）
  PuppeteerWebBaseLoader → 动态渲染网页（需要 Puppeteer）
  RecursiveUrlLoader     → 递归爬取整个网站
  GithubRepoLoader       → GitHub 仓库

数据库/API：
  NotionLoader       → Notion 页面
  ConfluenceLoader   → Confluence 文档
  SlackLoader        → Slack 消息
```

### 本项目使用两种加载方式

**方式一：CheerioWebBaseLoader（加载网页）**

```typescript
// src/rag/rag.service.ts

import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';

async addWebDocument(url: string): Promise<{ chunksAdded: number }> {
  this.logger.log(`开始加载网页: ${url}`);

  // 1. 使用 Cheerio 加载网页（适合静态页面）
  const loader = new CheerioWebBaseLoader(url);
  const docs = await loader.load();
  // docs = [{ pageContent: "网页的纯文本内容...", metadata: { source: url } }]

  // 2. 分块（Step 2，下一节讲）
  const chunks = await this.textSplitter.splitDocuments(docs);
  this.logger.log(`网页加载完成: ${chunks.length} 块`);

  // 3. 添加到向量存储（Step 3-4，Part 3 讲）
  await this.vectorStore.addDocuments(chunks);
  this.documentCount += chunks.length;

  return { chunksAdded: chunks.length };
}
```

**CheerioWebBaseLoader 的内部工作原理：**

```plain
CheerioWebBaseLoader(url) 做了什么？

1. fetch(url)              → 发 HTTP 请求获取 HTML
2. cheerio.load(html)      → 解析 DOM（类似 jQuery 的服务端版本）
3. $('body').text()        → 提取 <body> 内的纯文本
                              自动去掉 <script>、<style>、<nav> 等无用标签
4. 返回 Document 对象:
   {
     pageContent: "提取到的纯文本...",
     metadata: { source: "https://example.com/page" }
   }

注意：Cheerio 不执行 JavaScript。
  ✅ 能处理：静态 HTML 页面、SSR 渲染的页面
  ❌ 不能处理：React/Vue SPA（内容靠 JS 动态渲染）
  → 如果目标是 SPA，要用 PuppeteerWebBaseLoader（底层用无头浏览器）
```

**方式二：手动创建 Document（纯文本）**

```typescript
// src/rag/rag.service.ts

import { Document } from '@langchain/core/documents';

async addDocument(
  content: string,
  metadata?: Record<string, string>,
): Promise<{ chunksAdded: number }> {
  // 1. 手动创建 Document 对象
  // 用户通过 API 传入纯文本，我们包装成 Document
  const doc = new Document({
    pageContent: content,
    metadata: metadata || {},  // 可以传来源、标题、主题等自定义元数据
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
```

**两种方式的对比：**

```plain
CheerioWebBaseLoader（网页加载）：
  输入：URL
  过程：fetch → 解析 HTML → 提取纯文本 → 自动创建 Document
  适合：加载在线文档、博客文章、产品页面

手动创建 Document（纯文本）：
  输入：字符串 content + 可选 metadata
  过程：new Document({ pageContent, metadata })
  适合：用户直接输入文本、从数据库读取的内容、其他 Loader 不支持的格式

两种方式的后续流程完全一样：
  Document → textSplitter.splitDocuments() → vectorStore.addDocuments()
```

## 2.2 Text Splitters：分块策略

**为什么要分块？** 这是 RAG 中最关键的一步，直接影响检索质量。

```plain
不分块会怎样？

假设你有一篇 10000 字的文章，用户问"什么是 useEffect？"

不分块：
  整篇文章 → 1 个向量 → 检索时返回整篇文章
  问题：
  1. LLM 上下文长度有限，塞不下太多篇长文章
  2. 文章大部分内容和问题无关（噪声太多）
  3. 长文本向量化后，语义会"稀释"——一篇文章涵盖 10 个主题，向量是 10 个主题的"平均值"
     → 和任何单一主题的匹配度都不高

分块：
  10000 字 → 10 个 1000 字的块
  用户问"useEffect" → 只命中讲 useEffect 的那 1-2 个块
  结果：
  1. LLM 只需要处理 1-2 个小块，而不是整篇文章
  2. 检索更精准——向量只代表一个主题，相似度计算更准确
  3. 可以从不同文章中检索，拼出最相关的上下文
```

### 分块策略对比

```plain
1. 固定大小分块（CharacterTextSplitter）
   每 N 个字符切一刀
   问题：可能切断句子，破坏语义
   例如："北京今天天气|很好，温度 28°C"（切断了"天气很好"）

2. 递归字符分块（RecursiveCharacterTextSplitter）★ 推荐
   按优先级尝试分隔符：段落 → 句子 → 词 → 字符
   尽量在自然边界切分，保持语义完整
   本项目使用这种方式

3. 语义分块（SemanticChunker）
   用 Embedding 计算相邻句子的相似度
   相似度骤降的地方切分（说明话题变了）
   效果最好但最慢（每句话都要调 Embedding API）

4. Markdown/HTML 分块（MarkdownTextSplitter / HTMLSectionSplitter）
   按文档结构切分（标题、段落、列表、代码块）
   适合结构化文档
```

**本项目用 RecursiveCharacterTextSplitter**——在分块质量和性能之间取得最好的平衡。

### RecursiveCharacterTextSplitter 配置

```typescript
// src/rag/rag.service.ts

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// 在 constructor 中初始化
this.textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,      // 每块最大 1000 字符
  chunkOverlap: 200,    // 相邻块重叠 200 字符
  separators: [         // 中文友好分隔符（按优先级从高到低）
    '\n\n',   // 1. 先尝试按段落分（双换行）
    '\n',     // 2. 再尝试按行分（单换行）
    '。',     // 3. 再尝试按中文句号分
    '！',     // 4. 中文感叹号
    '？',     // 5. 中文问号
    '，',     // 6. 再尝试按中文逗号分
    ' ',      // 7. 再尝试按空格分（英文单词边界）
    '',       // 8. 最后按字符分（兜底方案）
  ],
});
```

### 参数详解

**chunkSize（每块最大字符数）：**

```plain
chunkSize = 1000 意味着每个块最多 1000 个字符。

太大（比如 5000）：
  ❌ 检索不精准——一个块涵盖多个主题，向量变成"万金油"
  ❌ 占用更多 LLM 上下文窗口
  ✅ 上下文更完整，信息量大

太小（比如 100）：
  ❌ 缺乏上下文——一个块可能只有半句话，LLM 理解困难
  ❌ 块太多，向量存储和检索成本增加
  ✅ 检索更精准

推荐范围：500-1500 字符（中文）
  - 技术文档：800-1200
  - 新闻/博客：500-1000
  - 法律/合同：1000-1500（需要更多上下文）

本项目用 1000——中间值，适合大多数场景。
```

**chunkOverlap（相邻块重叠区域）：**

```plain
chunkOverlap = 200 意味着相邻两个块有 200 个字符的重叠。

为什么要重叠？防止信息断裂。

不重叠的问题：
  块 1 结尾："React Hooks 可以让你在函数组件中"
  块 2 开头："使用 state 和其他 React 特性。"
  → 如果用户问"React Hooks 能做什么？"
  → 块 1 的向量里有"React Hooks"但没有答案
  → 块 2 的向量里有答案但没有"React Hooks"
  → 两个块都可能匹配不上！

有重叠（200 字符）：
  块 1 结尾："React Hooks 可以让你在函数组件中使用 state 和其他 React 特性。"
  块 2 开头："React Hooks 可以让你在函数组件中使用 state 和其他 React 特性。useState 是..."
  → 块 2 包含完整的句子，检索命中率更高

推荐：chunkSize 的 10%-20%
  chunkSize=1000 → chunkOverlap=100~200
```

**separators（分隔符优先级）：**

```plain
RecursiveCharacterTextSplitter 的"递归"就体现在这里。

它会按 separators 数组的顺序，从高优先级到低优先级依次尝试切分。
如果用高优先级分隔符切出来的块超过了 chunkSize，就降级用下一个分隔符再切。

执行过程（以一段 2500 字的文章为例）：

1. 先用 '\n\n'（段落）切：
   → 得到 5 个段落，每段 ~500 字
   → 全部 < 1000，OK ✅

2. 但如果某段有 1800 字，超过 chunkSize：
   → 对这一段用 '\n'（行）再切
   → 得到 3 个部分

3. 如果某行还有 1200 字：
   → 对这一行用 '。'（句号）再切
   → 直到每块都 ≤ 1000 字符

4. 最极端情况：一句话超过 1000 字（几乎不可能）
   → 用 '' 按字符切

这就是"递归"的含义——层层降级，在最自然的边界切分。
```

### 分块效果示例

```plain
原始文档（2500 字符）：

  # React Hooks 入门

  ## 什么是 Hooks？

  Hooks 是 React 16.8 引入的新特性，它让你在函数组件中
  使用 state 和其他 React 特性，而不需要写 class 组件。
  在 Hooks 出现之前，只有 class 组件才能使用 state...
  [约 800 字]

  ## useState 基础

  useState 是最常用的 Hook，用于在函数组件中添加状态。
  它接受一个初始值参数，返回一个数组...
  [约 900 字]

  ## useEffect 使用

  useEffect 用于处理副作用，比如数据获取、订阅、
  手动修改 DOM...
  [约 800 字]

分块后（chunkSize=1000, chunkOverlap=200）：

  Chunk 0 (约 950 字符)：
    pageContent: "# React Hooks 入门\n\n## 什么是 Hooks？\n\nHooks 是 React 16.8..."
    metadata: { source: "react-hooks", chunk: 0 }
    ← 按 '\n\n' 切分，包含标题和第一节

  Chunk 1 (约 980 字符)：
    pageContent: "...使用 state 和其他 React 特性...\n\n## useState 基础\n\nuseState 是..."
    metadata: { source: "react-hooks", chunk: 1 }
    ← 和 Chunk 0 重叠约 200 字符（第一节结尾部分）

  Chunk 2 (约 920 字符)：
    pageContent: "...它接受一个初始值参数...\n\n## useEffect 使用\n\nuseEffect 用于..."
    metadata: { source: "react-hooks", chunk: 2 }
    ← 和 Chunk 1 重叠约 200 字符（useState 节结尾部分）

注意：
  - 切分发生在 '\n\n'（段落边界），语义完整
  - 相邻块有 ~200 字符重叠，防止信息断裂
  - 每个块都有 metadata，记录来源和序号
```

---

# Part 3：向量存储与检索

## 3.1 Embeddings：文本向量化

Embedding 是 RAG 管线中**最核心**的概念——把文本转换成**高维向量**（一串数字），使得语义相似的文本在向量空间中距离更近。

```plain
"北京天气怎么样？"  → [0.12, -0.34, 0.56, ..., 0.78]  （1536 维向量）
"北京今天温度多少？" → [0.11, -0.33, 0.57, ..., 0.79]  （很接近！语义相似）
"今天吃什么？"      → [-0.45, 0.22, -0.18, ..., 0.33]  （差很远，语义不同）
```

**为什么 1536 维？** 不同模型的维度不同：
- OpenAI text-embedding-3-small：1536 维
- OpenAI text-embedding-3-large：3072 维
- DashScope text-embedding-v1：1536 维（本项目使用）
- DashScope text-embedding-v3：1024 维（最新最强）
- 智谱 embedding-2：1024 维
- 智谱 embedding-3：2048 维

维度越高，表达能力越强，但计算和存储成本也越高。

### 向量相似度的直观理解

```plain
想象一个 3 维空间（为了便于理解，实际是 1536 维）：

  "React Hooks" → 空间中的点 A
  "React useState" → 空间中的点 B（离 A 很近）
  "Vue 组合式 API" → 空间中的点 C（离 A 中等距离）
  "Python 装饰器" → 空间中的点 D（离 A 很远）

  当用户问"什么是 React Hooks？"时：
  1. 问题也被转成向量 → 点 Q
  2. 计算 Q 到所有文档块的距离
  3. Q 离 A 最近，离 B 也很近 → 返回 A 和 B 对应的文档块
  4. LLM 基于 A 和 B 的内容回答问题

  这就是"语义搜索"——不是搜索关键词匹配，而是搜索"意思最接近的"。

  对比关键词搜索：
    关键词搜索 "React Hooks" → 只找包含这两个词的文档
    语义搜索 "React Hooks"   → 还能找到"React 函数组件中的状态管理"（没有这两个词但意思相关）
```

### OpenAI Embeddings 配置

```typescript
// src/rag/rag.service.ts

import { OpenAIEmbeddings } from '@langchain/openai';

// 在 constructor 中初始化
// 使用阿里云 DashScope 的 Embedding API（OpenAI 兼容格式）
// Chat 模型和 Embedding 模型在不同平台，所以用单独的 API Key 和 Base URL
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
  batchSize: 25, // ⚠️ DashScope 每次最多 25 条，不设会报 400
});
```

**`batchSize: 25` 是什么意思？**

```plain
LangChain 的 OpenAIEmbeddings 在批量向量化时（embedDocuments），
会把文本列表按 batchSize 分批，每批发一次 API 请求。

默认值是 512（OpenAI 原生支持的上限）。
但 DashScope 的批量限制是 25 条/次。

如果不设 batchSize：
  网页分块 → 60 个 chunk → 一次发 60 条 → DashScope 返回 400 ❌
  "batch size is invalid, it should not be larger than 25"

设了 batchSize: 25：
  网页分块 → 60 个 chunk → 分 3 批（25 + 25 + 10） → 每批单独请求 → 全部成功 ✅
```
OpenAIEmbeddings 是 LangChain 对 OpenAI Embedding API 的封装。
它兼容所有实现了 OpenAI Embedding API 规范的服务——
包括 OpenAI 原生、阿里云 DashScope、智谱 GLM、Azure OpenAI 等。

本项目的配置：
  apiKey  → EMBEDDING_API_KEY（DashScope 的 Key）
  baseURL → https://dashscope.aliyuncs.com/compatible-mode/v1
  model   → text-embedding-v1

内部流程：
  embedQuery("什么是 React？")
    → POST https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings
       { model: "text-embedding-v1", input: "什么是 React？" }
    → 返回: { data: [{ embedding: [0.12, -0.34, ...] }] }
    → 提取向量: [0.12, -0.34, ...]

两个关键方法：
  embedQuery(text)        → 单条文本向量化（检索时用，把问题转成向量）
  embedDocuments(texts[]) → 批量向量化（入库时用，把所有文档块转成向量）
```

**为什么用 `EMBEDDING_API_KEY` 和 `EMBEDDING_BASE_URL` 单独配置？**

```plain
本项目的实际情况：
  Chat 模型    → OneAPI 平台（https://oneapi-xxx/v1）
  Embedding 模型 → 阿里云 DashScope（https://dashscope.aliyuncs.com/compatible-mode/v1）

两个平台的 API Key 和 Base URL 都不同，所以需要分开配置。

代码中的降级策略：
  apiKey:  EMBEDDING_API_KEY  || OPENAI_API_KEY
  baseURL: EMBEDDING_BASE_URL || OPENAI_BASE_URL

  → 优先用 EMBEDDING_* 的配置
  → 如果没配（Chat 和 Embedding 在同一平台），降级用 OPENAI_*
  → 这样两种部署方式都支持
```

### 向量化过程详解

```typescript
// 单条文本向量化（检索时用）
const vector = await this.embeddings.embedQuery('什么是 React Hooks？');
// vector = [0.12, -0.34, 0.56, ..., 0.78]（1536 维，text-embedding-v1 模型）
// vector.length = 1536（DashScope text-embedding-v1 模型）

// 批量向量化（文档入库时使用）
const vectors = await this.embeddings.embedDocuments([
  'React Hooks 是 React 16.8 引入的新特性...',
  'useState 是最常用的 Hook...',
  'useEffect 用于处理副作用...',
]);
// vectors = [[...], [...], [...]]（3 个向量，每个 1536 维）
```

```plain
入库时的向量化流程：

  addDocument("React Hooks 是 React 16.8 引入的新特性...")
    ↓
  textSplitter.splitDocuments([doc])
    ↓
  得到 chunks = [chunk0, chunk1, chunk2]
    ↓
  vectorStore.addDocuments(chunks)
    ↓ 内部自动调用：
  embeddings.embedDocuments([
    chunk0.pageContent,
    chunk1.pageContent,
    chunk2.pageContent,
  ])
    ↓
  POST /embeddings API × 1 次（批量请求，不是 3 次）
    ↓
  得到 3 个向量
    ↓
  存储：{ 向量: [...], 原文: chunk.pageContent, 元数据: chunk.metadata }
```

## 3.2 Vector Store：向量存储

Vector Store 负责两件事：**存储向量 + 支持相似度搜索**。

### 向量数据库选型

```plain
开发/原型阶段（本项目使用）：
  MemoryVectorStore  → 纯内存，重启数据丢失，零配置
                        优点：不需要安装任何外部服务
                        缺点：生产环境不能用，数据不持久化

轻量级（本地开发升级方案）：
  Chroma             → 轻量嵌入式，数据存本地文件
                        pip install chromadb && chromadb run
  FAISS              → Facebook 开源，纯内存但可导出

生产环境：
  Pgvector           → PostgreSQL 扩展，已有 PG 的项目首选
  Pinecone           → 全托管云服务，不想运维
  Milvus             → 高性能分布式，大规模数据
  Qdrant             → Rust 实现，性能好
  Weaviate           → 支持混合搜索（向量+关键词）

怎么选？
  本地开发/学习 → MemoryVectorStore（本项目）
  已有 PostgreSQL → Pgvector（加个扩展就行）
  不想运维 → Pinecone（云服务，按量付费）
  大规模数据（百万级文档） → Milvus / Qdrant
```

### MemoryVectorStore 初始化

```typescript
// src/rag/rag.service.ts

import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import type { Embeddings } from '@langchain/core/embeddings';

// 类成员变量
private vectorStore: MemoryVectorStore;
private embeddings: Embeddings;

async onModuleInit() {
  // 初始化空的向量存储（传入 Embedding 模型）
  // MemoryVectorStore 需要知道用什么模型做向量化
  // 因为 addDocuments 时它要自动调 embeddings.embedDocuments()
  this.vectorStore = new MemoryVectorStore(this.embeddings);
  this.logger.log('RAG 服务初始化完成，向量存储已就绪');
}
```

**为什么在 `onModuleInit` 中初始化而不是 `constructor` 中？**

```plain
constructor 中可以初始化同步的对象（textSplitter、embeddings、llm）。
vectorStore 的初始化虽然目前是同步的（MemoryVectorStore），
但放在 onModuleInit 中是 NestJS 的最佳实践——
它确保所有依赖注入完成后再初始化，且支持 async 操作。

如果以后切换到 Chroma 或 Pgvector，初始化会变成 async：
  this.vectorStore = await Chroma.fromTexts([], [], this.embeddings, { url: '...' });

放在 onModuleInit 中不需要改代码结构。
```

### 文档入库（addDocuments）

```typescript
// 分块后的文档自动向量化并存储
await this.vectorStore.addDocuments(chunks);
```

**这一行做了很多事：**

```plain
vectorStore.addDocuments(chunks) 内部流程：

1. 提取所有块的文本：
   texts = chunks.map(c => c.pageContent)
   → ["React Hooks 是...", "useState 是...", "useEffect 用于..."]

2. 批量向量化：
   vectors = await this.embeddings.embedDocuments(texts)
   → [[0.12, -0.34, ...], [0.45, 0.23, ...], [-0.11, 0.67, ...]]

3. 存储到内存中（MemoryVectorStore 的实现）：
   this.memoryVectors.push(
     { content: "React Hooks 是...",  vector: [0.12, -0.34, ...],  metadata: {...} },
     { content: "useState 是...",     vector: [0.45, 0.23, ...],   metadata: {...} },
     { content: "useEffect 用于...", vector: [-0.11, 0.67, ...],  metadata: {...} },
   )

   如果是 Pgvector，就是 INSERT INTO embeddings (content, vector, metadata) VALUES ...
   如果是 Pinecone，就是 pinecone.upsert(vectors)
   但上层 API 完全一样——这就是 LangChain 抽象层的价值
```

### 相似度搜索（similaritySearchWithScore）

```typescript
// src/rag/rag.service.ts

async retrieve(
  query: string,
  topK = 4,
): Promise<Array<{ content: string; score: number; metadata: Record<string, unknown> }>> {
  // similaritySearchWithScore：返回最相似的 K 个文档 + 相似度分数
  const results = await this.vectorStore.similaritySearchWithScore(
    query,
    topK,
  );

  return results.map(([doc, score]) => ({
    content: doc.pageContent,
    score: score,           // 相似度分数（距离越小越相似，MemoryVectorStore 用余弦距离）
    metadata: doc.metadata, // 元数据（来源、页码等）
  }));
}
```

**`similaritySearchWithScore` 的内部流程：**

```plain
similaritySearchWithScore("什么是 React Hooks？", 4) 内部流程：

1. 把查询文本向量化：
   queryVector = await embeddings.embedQuery("什么是 React Hooks？")
   → [0.13, -0.32, 0.55, ...]

2. 遍历所有已存储的文档向量，计算距离：
   doc1: "React Hooks 是..."    → cosineDistance(queryVector, doc1.vector) = 0.15  ← 很近！
   doc2: "useState 是最常用的..." → cosineDistance(queryVector, doc2.vector) = 0.23  ← 比较近
   doc3: "Vue 组合式 API..."    → cosineDistance(queryVector, doc3.vector) = 0.45  ← 中等
   doc4: "useEffect 用于..."    → cosineDistance(queryVector, doc4.vector) = 0.28  ← 比较近
   doc5: "Python 装饰器..."     → cosineDistance(queryVector, doc5.vector) = 0.89  ← 很远

3. 按距离排序，返回 top-K（K=4）：
   [(doc1, 0.15), (doc2, 0.23), (doc4, 0.28), (doc3, 0.45)]

4. 返回结果给调用方

MemoryVectorStore 用暴力搜索（遍历所有向量）。
生产级向量数据库用近似最近邻（ANN）算法——不遍历全部，牺牲少量精度换巨大速度提升。
```

**score 的含义：**

```plain
MemoryVectorStore 使用余弦距离（cosine distance）：
  score = 0     → 完全相同
  score = 0~0.3 → 非常相似
  score = 0.3~0.6 → 有一定相关性
  score = 0.6~1.0 → 不太相关
  score = 1.0   → 完全无关

注意：不同向量数据库的 score 含义可能不同：
  - MemoryVectorStore → 余弦距离（越小越相似）
  - Pinecone → 余弦相似度（越大越相似，范围 0~1）
  - Pgvector → 取决于配置的距离函数

使用时需要看具体数据库的文档。
```

## 3.3 Retriever：检索器封装

LangChain 提供 `Retriever` 接口，把"从 VectorStore 搜索"封装成一个统一的可调用对象：

```typescript
// 把 VectorStore 转成 Retriever
const retriever = this.vectorStore.asRetriever({
  k: 4,                     // 返回 top-4 结果
  searchType: 'similarity', // 或 'mmr'（最大边际相关性）
});

// 使用 Retriever
const docs = await retriever.invoke('什么是 React Hooks？');
// docs = [Document, Document, Document, Document]
```

**本项目没有使用 `asRetriever()`，而是直接调 `similaritySearchWithScore()`。**

```plain
为什么？

asRetriever() 返回 Document[]，没有相似度分数。
similaritySearchWithScore() 返回 [Document, score][]，有分数。

我们需要分数来：
1. 返回给前端展示（让用户知道检索到的文档有多相关）
2. 后续可以做阈值过滤（score > 0.8 的文档太不相关就不用了）

如果你不需要分数，asRetriever() 更简洁，还能直接塞进 LangChain 的 Chain 里。
```

**searchType 对比：**

```plain
similarity（相似度搜索）：
  返回和查询向量最接近的 K 个文档
  问题：可能返回很多重复/相似的内容
  例如：知识库里有 5 段都在讲 useState，全部返回了，但其实只需要 1 段

mmr（Maximum Marginal Relevance，最大边际相关性）：
  在相似度和多样性之间平衡
  第 1 个结果选最相似的
  第 2 个结果选"和查询相似 + 和第 1 个不同"的
  第 3 个结果选"和查询相似 + 和前 2 个都不同"的
  避免返回过于相似的文档

什么时候用 mmr？
  知识库中有很多相似内容（比如同一主题的多篇文章）
  需要"广度"而不只是"深度"
```

---

# Part 4：RAG Chain 实战

## 4.1 RagService 完整初始化

在看 RAG Chain 之前，先看 `RagService` 的完整初始化过程：

```typescript
// src/rag/rag.service.ts

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);

  /** 文本分块器 */
  private textSplitter: RecursiveCharacterTextSplitter;
  /** 向量嵌入模型 */
  private embeddings: Embeddings;
  /** 内存向量存储 */
  private vectorStore: MemoryVectorStore;
  /** LLM 模型 */
  private llm: ChatOpenAI;
  /** 已加载的文档数量 */
  private documentCount = 0;

  constructor(private configService: ConfigService) {
    // Step 2: 初始化 Text Splitter
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', ''],
    });

    // Step 3: 初始化 Embedding 模型
    // ⚠️ 这是 Embedding 模型，不是 Chat 模型！
    // Chat 模型和 Embedding 模型可能在不同平台，所以分开配置
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
        this.configService.get<string>('EMBEDDING_MODEL') || 'text-embedding-v1',
      batchSize: 25, // DashScope 批量限制 25 条/次
    });

    // Step 5 的一部分: 初始化 Chat 模型（用于 RAG Chain 的生成环节）
    this.llm = new ChatOpenAI({
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
      modelName: 'GLM-5',
      temperature: 0.3,  // RAG 场景用低温度——回答要准确，不要有创造性
    });
  }

  async onModuleInit() {
    // Step 4: 初始化 Vector Store
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this.logger.log('RAG 服务初始化完成，向量存储已就绪');
  }
```

**`temperature: 0.3` 为什么比 Phase 1-3 低？**

```plain
Phase 1-3（对话/Agent）：temperature = 0.7~1.0
  → 需要创造性、多样性（不同的对话方式、不同的回答角度）

Phase 4（RAG）：temperature = 0.3
  → 需要准确性、一致性
  → 回答必须忠实于检索到的文档内容
  → 不希望 LLM "发挥创造力"——那就是幻觉

temperature 越低 → 输出越确定、越保守
temperature 越高 → 输出越随机、越有创造力
```

## 4.2 RAG Prompt 设计

RAG 的核心是把检索到的文档注入 Prompt，让 LLM "看着文档回答"：

```typescript
// src/rag/rag.service.ts

import { ChatPromptTemplate } from '@langchain/core/prompts';

// 在 query() 方法内部构建
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
```

**Prompt 设计要点（每一条都有原因）：**

```plain
1. "你是一个专业的问答助手"
   → 角色设定，让 LLM 进入"问答"模式而非"闲聊"模式

2. "只使用上下文中的信息来回答，不要编造内容"
   → ⭐ 最关键的一条！这是 RAG 区别于普通对话的核心
   → 没有这条，LLM 会混合自己的预训练知识和检索到的文档
   → 有了这条，LLM 被限制在"只看你给的文档"

3. "如果上下文中没有足够的信息，请诚实地说'根据现有资料无法回答'"
   → 降低幻觉的关键手段
   → 没有这条：LLM 找不到答案时会编一个
   → 有了这条：LLM 会说"我不知道"（这才是正确的行为）

4. "如果可能，请标注信息来源"
   → 让 LLM 在回答中引用文档来源
   → 用户可以去验证回答的准确性

5. {context} 占位符
   → 运行时替换为检索到的文档块
   → 格式：[1] 第一段文档\n\n[2] 第二段文档\n\n...

6. {question} 占位符
   → 运行时替换为用户的原始问题
```

**对比 Phase 1 的 Prompt：**

```plain
Phase 1（纯对话）：
  System: "你是一个有用的助手"
  Human: "什么是 React Hooks？"
  → LLM 纯靠记忆回答（可能有幻觉）

Phase 4（RAG）：
  System: "你是一个专业的问答助手...上下文信息：
    [1] React Hooks 是 React 16.8 引入的新特性...
    [2] useState 是最常用的 Hook..."
  Human: "什么是 React Hooks？"
  → LLM 基于[1][2]的内容回答（有据可依）
```

## 4.3 RAG Chain 构建

用 `RunnableSequence` 组装完整的 RAG Chain——这和 Phase 3 的 StateGraph 图结构是不同的编排方式：

```plain
Phase 3（StateGraph）：
  图结构 → 节点之间可以有条件路由、循环
  适合：需要循环决策的 Agent（调工具 → 看结果 → 决定下一步）

Phase 4（RunnableSequence）：
  线性管道 → 一步一步顺序执行
  适合：固定流程的处理管线（检索 → 注入上下文 → 调 LLM → 提取输出）
```

```typescript
// src/rag/rag.service.ts

import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';

async query(
  question: string,
  topK = 4,
): Promise<{ answer: string; sources: Array<...> }> {
  // 1. 检索相关文档
  const retrievedDocs = await this.retrieve(question, topK);

  if (retrievedDocs.length === 0) {
    return {
      answer: '抱歉，知识库中没有找到相关信息。请先添加一些文档。',
      sources: [],
    };
  }

  // 2. 构建 RAG Prompt（上一节定义的）
  const ragPrompt = ChatPromptTemplate.fromMessages([...]);

  // 3. ⭐ 构建 RAG Chain
  const ragChain = RunnableSequence.from([
    {
      // 第一步：准备输入数据
      // context: 把检索到的文档格式化成编号列表
      context: () =>
        retrievedDocs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n'),
      // question: 把原始问题直接透传
      question: new RunnablePassthrough(),
    },
    ragPrompt,                // 第二步：填充 Prompt 模板
    this.llm,                // 第三步：调用 LLM
    new StringOutputParser(), // 第四步：提取字符串输出
  ]);

  // 4. 执行 Chain
  const answer = await ragChain.invoke(question);

  // 5. 返回答案 + 引用来源
  return {
    answer,
    sources: retrievedDocs,
  };
}
```

**Chain 中每一步做了什么？详细展开：**

```plain
ragChain.invoke("什么是 React Hooks？") 的执行过程：

╔═══════════════════════════════════════════════════════════════════╗
║ Step 1: 准备输入数据                                               ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  输入: "什么是 React Hooks？"                                      ║
║                                                                   ║
║  {                                                                ║
║    context: () => retrievedDocs.map(...)                          ║
║      → 执行函数，返回:                                              ║
║        "[1] React Hooks 是 React 16.8 引入的新特性...\n\n          ║
║         [2] useState 是最常用的 Hook..."                           ║
║                                                                   ║
║    question: new RunnablePassthrough()                            ║
║      → 直接透传输入值: "什么是 React Hooks？"                       ║
║  }                                                                ║
║                                                                   ║
║  输出:                                                             ║
║  {                                                                ║
║    context: "[1] React Hooks...\n\n[2] useState...",              ║
║    question: "什么是 React Hooks？"                                ║
║  }                                                                ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
╔═══════════════════════════════════════════════════════════════════╗
║ Step 2: ragPrompt（填充模板）                                       ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ChatPromptTemplate 用 context 和 question 替换占位符：              ║
║                                                                   ║
║  System: "你是一个专业的问答助手...                                   ║
║    上下文信息：                                                      ║
║    [1] React Hooks 是 React 16.8 引入的新特性...                    ║
║    [2] useState 是最常用的 Hook..."                                 ║
║                                                                   ║
║  Human: "什么是 React Hooks？"                                     ║
║                                                                   ║
║  输出: ChatPromptValue（消息数组）                                    ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
╔═══════════════════════════════════════════════════════════════════╗
║ Step 3: this.llm（调用 LLM）                                       ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ChatOpenAI.invoke(messages)                                      ║
║    → POST {baseURL}/chat/completions                              ║
║    → model: "GLM-5"                                               ║
║    → temperature: 0.3                                             ║
║    → messages: [SystemMessage, HumanMessage]                      ║
║                                                                   ║
║  输出: AIMessage({                                                 ║
║    content: "根据提供的文档，React Hooks 是 React 16.8 引入的新特性。║
║    它让你在函数组件中使用 state 和其他 React 特性[1]。               ║
║    最常用的 Hook 包括 useState、useEffect 等[2]。"                  ║
║  })                                                               ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
╔═══════════════════════════════════════════════════════════════════╗
║ Step 4: StringOutputParser（提取文本）                               ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  AIMessage.content → "根据提供的文档，React Hooks 是..."            ║
║                                                                   ║
║  输出: string                                                      ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
最终返回:
{
  answer: "根据提供的文档，React Hooks 是 React 16.8 引入的新特性...",
  sources: [
    { content: "React Hooks 是...", score: 0.15, metadata: {...} },
    { content: "useState 是...", score: 0.23, metadata: {...} }
  ]
}
```

**`RunnablePassthrough` 是什么？**

```plain
RunnablePassthrough 是 LangChain 中的"透传器"——
输入什么就原样输出什么，不做任何处理。

在这里的作用：
  ragChain.invoke("什么是 React Hooks？")
  → 第一步需要构造 { context, question }
  → context 用函数从 retrievedDocs 生成
  → question 需要的就是原始输入 "什么是 React Hooks？"
  → RunnablePassthrough() 把输入值直接透传给 question

类比 JavaScript：
  const identity = (x) => x;  // 这就是 RunnablePassthrough
```

## 4.4 流式 RAG 问答

支持 SSE 流式输出——LLM 的回答逐 token 返回，用户体验更好（不用等全部生成完）：

```typescript
// src/rag/rag.service.ts

async *queryStream(
  question: string,
  topK = 4,
): AsyncGenerator<{ type: 'source' | 'token' | 'done'; data: unknown }> {
  // 1. 检索相关文档
  const retrievedDocs = await this.retrieve(question, topK);

  // ⭐ 先 yield 检索到的来源
  // 前端收到后可以立即展示"正在基于这些文档回答..."
  yield { type: 'source', data: retrievedDocs };

  if (retrievedDocs.length === 0) {
    yield { type: 'token', data: '抱歉，知识库中没有找到相关信息。请先添加一些文档。' };
    yield { type: 'done', data: null };
    return;
  }

  // 2. 构建 RAG Chain（和 query() 方法完全一样）
  const ragPrompt = ChatPromptTemplate.fromMessages([...]);
  const ragChain = RunnableSequence.from([
    {
      context: () => retrievedDocs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n'),
      question: new RunnablePassthrough(),
    },
    ragPrompt,
    this.llm,
    new StringOutputParser(),
  ]);

  // 3. ⭐ 流式执行：ragChain.stream() 替代 ragChain.invoke()
  const stream = await ragChain.stream(question);

  // 4. 逐 token yield
  for await (const chunk of stream) {
    yield { type: 'token', data: chunk };
  }

  yield { type: 'done', data: null };
}
```

**`ragChain.invoke()` vs `ragChain.stream()` 的区别：**

```plain
invoke(question)：
  → 等待 LLM 生成完所有内容
  → 一次性返回完整字符串
  → 用户要等几秒才能看到回答

stream(question)：
  → LLM 每生成一个 token 就立即 yield
  → 前端逐字显示，像打字机一样
  → 用户几乎立即就能看到开头

流式执行过程：
  stream("什么是 React Hooks？")
    → chunk1: "根据"
    → chunk2: "提供"
    → chunk3: "的"
    → chunk4: "文档"
    → chunk5: "，"
    → chunk6: "React"
    → chunk7: " Hooks"
    → chunk8: " 是"
    → ...（每个 chunk 通常是 1-3 个 token）
```

**SSE 事件格式（前端收到的完整事件流）：**

```plain
data: {"type":"source","data":[{"content":"React Hooks 是...","score":0.15,...}]}
                                              ← 前端立即展示引用来源

data: {"type":"token","data":"根据"}            ← 逐 token 显示
data: {"type":"token","data":"提供"}
data: {"type":"token","data":"的"}
data: {"type":"token","data":"文档"}
data: {"type":"token","data":"，"}
data: {"type":"token","data":"React"}
data: {"type":"token","data":" Hooks"}
data: {"type":"token","data":" 是"}
data: {"type":"token","data":" React"}
data: {"type":"token","data":" 16.8"}
data: {"type":"token","data":" 引入的"}
data: {"type":"token","data":"新特性。"}
...
data: {"type":"done","data":null}              ← 流结束

对比 Phase 3 的 SSE 事件：
  Phase 3: type = node | tool_call | tool_result | content | interrupt | done
  Phase 4: type = source | token | done

  Phase 3 更复杂（因为有工具调用和中断），Phase 4 更简单（就是 检索→回答）
```

## 4.5 Controller 层

```typescript
// src/rag/rag.controller.ts

@ApiTags('RAG - 检索增强生成')
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // ─── 文档管理 ─────────────────────────────────────────────────

  /** 添加文本文档到知识库 */
  @Post('documents')
  @ApiOperation({ summary: '添加文档', description: '将文本内容添加到知识库，自动进行分块和向量化' })
  async addDocument(@Body() dto: AddDocumentDto) {
    const result = await this.ragService.addDocument(dto.content, dto.metadata);
    return {
      success: true,
      message: `文档已添加，生成 ${result.chunksAdded} 个文档块`,
      chunksAdded: result.chunksAdded,
    };
  }

  /** 从网页加载文档 */
  @Post('documents/web')
  @ApiOperation({ summary: '从网页加载文档', description: '抓取网页内容并添加到知识库' })
  async addWebDocument(@Body() dto: AddWebDocumentDto) {
    const result = await this.ragService.addWebDocument(dto.url);
    return {
      success: true,
      message: `网页已加载，生成 ${result.chunksAdded} 个文档块`,
      chunksAdded: result.chunksAdded,
    };
  }

  // ─── RAG 问答 ─────────────────────────────────────────────────

  /** RAG 问答（一次性返回） */
  @Post('query')
  @ApiOperation({ summary: 'RAG 问答', description: '基于知识库内容回答问题，返回答案和引用来源' })
  async query(@Body() dto: RagQueryDto): Promise<RagAnswerDto> {
    const result = await this.ragService.query(dto.question, dto.topK);
    return {
      answer: result.answer,
      sources: result.sources.map((s) => ({
        content: s.content,
        score: s.score,
        metadata: s.metadata,
      })),
    };
  }

  /** RAG 流式问答（SSE） */
  @Post('query/stream')
  @ApiOperation({ summary: 'RAG 流式问答', description: '基于知识库内容回答问题，以 SSE 流式返回答案' })
  async queryStream(@Body() dto: RagQueryDto, @Res() res: Response) {
    // 设置 SSE 响应头——和 Phase 1/2/3 完全一样的模式
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const event of this.ragService.queryStream(
        dto.question,
        dto.topK,
      )) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({ type: 'error', data: error.message })}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  // ─── 知识库管理 ────────────────────────────────────────────────

  /** 获取知识库状态 */
  @Get('status')
  @ApiOperation({ summary: '获取知识库状态', description: '返回当前知识库的文档数量和就绪状态' })
  getStatus() {
    return this.ragService.getStatus();
  }

  /** 清空知识库 */
  @Delete('documents')
  @ApiOperation({ summary: '清空知识库', description: '删除所有已添加的文档' })
  async clearDocuments() {
    await this.ragService.clearKnowledgeBase();
    return { success: true, message: '知识库已清空' };
  }
}
```

**Controller 和前三个 Phase 的对比：**

```plain
Phase 1（ChatController）：
  POST /chat/completions → 纯对话

Phase 2（AgentController）：
  POST /agent/chat → Tool Use 循环

Phase 3（LangGraphController）：
  POST /langgraph/chat   → StateGraph Agent
  POST /langgraph/react  → ReAct Agent
  POST /langgraph/hitl   → Human-in-the-Loop
  POST /langgraph/hitl/resume → 恢复执行

Phase 4（RagController）：
  POST   /rag/documents     → 文档入库（🆕 之前没有）
  POST   /rag/documents/web → 网页入库（🆕 之前没有）
  POST   /rag/query         → 问答
  POST   /rag/query/stream  → 流式问答
  GET    /rag/status        → 状态查询（🆕 知识库管理）
  DELETE /rag/documents     → 清空知识库（🆕 知识库管理）

关键区别：Phase 4 多了"文档管理"类的 API——因为 RAG 需要先入库才能查询。
Phase 1-3 不需要入库，LLM 的知识来自模型自身或 API 调用。
```

### DTO 设计

```typescript
// src/rag/dto/rag.dto.ts

/** 添加文档请求 */
export class AddDocumentDto {
  @IsString()
  content: string;               // 文档内容

  @IsOptional()
  metadata?: Record<string, string>;  // 可选元数据（来源、标题等）
}

/** 添加网页文档请求 */
export class AddWebDocumentDto {
  @IsString()
  url: string;                   // 网页 URL
}

/** RAG 问答请求 */
export class RagQueryDto {
  @IsString()
  question: string;              // 用户问题

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  topK?: number;                 // 返回的相关文档数量（默认 4）
}

/** RAG 问答响应 */
export class RagAnswerDto {
  answer: string;                // AI 生成的答案
  sources: RetrievalResultDto[]; // 引用的来源文档
}
```

## 4.6 知识库管理方法

```typescript
// src/rag/rag.service.ts

/** 获取知识库状态 */
getStatus(): { documentCount: number; isReady: boolean } {
  return {
    documentCount: this.documentCount,
    isReady: this.documentCount > 0,  // 至少有 1 个文档块才算就绪
  };
}

/** 清空知识库 */
async clearKnowledgeBase(): Promise<void> {
  // 重新创建一个空的 MemoryVectorStore，旧的被 GC 回收
  this.vectorStore = new MemoryVectorStore(this.embeddings);
  this.documentCount = 0;
  this.logger.log('知识库已清空');
}
```

```plain
为什么清空是"重新创建"而不是"删除数据"？

MemoryVectorStore 没有提供 clear() 方法。
它把所有向量存在一个内部数组里（this.memoryVectors）。

最简单的清空方式就是重新 new 一个。
旧的实例没有引用后会被 JavaScript GC 回收。

如果用生产级向量数据库（如 Pgvector），
就需要执行 DELETE FROM embeddings; 或类似的 SQL。
```

## 4.7 完整执行链路

以"添加文档 → 提问 → 获得回答"的完整流程为例：

```plain
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 用户添加文档到知识库                                                │
│                                                                      │
│    POST /rag/documents                                               │
│    {                                                                 │
│      "content": "React Hooks 是 React 16.8 引入的新特性。它让你在    │
│       函数组件中使用 state 和其他 React 特性。最常用的 Hooks 包括      │
│       useState、useEffect、useContext、useReducer 等。useState 用于   │
│       在函数组件中添加状态，useEffect 用于处理副作用。",               │
│      "metadata": { "source": "react-docs", "topic": "hooks" }       │
│    }                                                                 │
│                                                                      │
│    RagController.addDocument(dto)                                    │
│      ↓                                                               │
│    RagService.addDocument(content, metadata)                         │
│      ├── new Document({ pageContent, metadata })                     │
│      │     → Document 对象                                            │
│      │                                                               │
│      ├── textSplitter.splitDocuments([doc])                          │
│      │     → RecursiveCharacterTextSplitter                          │
│      │     → 尝试按 '\n\n' 切 → 没有段落分隔符                         │
│      │     → 尝试按 '。' 切 → 按句号切成 2-3 块                        │
│      │     → chunks = [chunk0, chunk1]                               │
│      │                                                               │
│      └── vectorStore.addDocuments(chunks)                            │
│            ├── embeddings.embedDocuments(["React Hooks 是...", ...])  │
│            │     → POST /embeddings API                              │
│            │     → [[0.12, -0.34, ...], [0.45, 0.23, ...]]          │
│            └── 存储 { 向量 + 原文 + 元数据 } 到内存                    │
│                                                                      │
│    响应: { success: true, chunksAdded: 2 }                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌──────────────────────────────┴──────────────────────────────────────┐
│ 2. 用户提问                                                          │
│                                                                      │
│    POST /rag/query                                                   │
│    { "question": "什么是 React Hooks？", "topK": 4 }                 │
│                                                                      │
│    RagController.query(dto)                                          │
│      ↓                                                               │
│    RagService.query(question, topK)                                  │
│      │                                                               │
│      ├── Step A: retrieve("什么是 React Hooks？", 4)                  │
│      │     ├── embeddings.embedQuery("什么是 React Hooks？")          │
│      │     │     → POST /embeddings API                              │
│      │     │     → queryVector = [0.13, -0.32, 0.55, ...]            │
│      │     │                                                         │
│      │     └── vectorStore.similaritySearchWithScore(query, 4)       │
│      │           ├── 计算 queryVector 和所有文档向量的余弦距离          │
│      │           │     chunk0: distance = 0.15  ← 最相似！            │
│      │           │     chunk1: distance = 0.23  ← 也相关             │
│      │           │                                                   │
│      │           └── 返回 [(chunk0, 0.15), (chunk1, 0.23)]           │
│      │                                                               │
│      ├── Step B: 构建 RAG Chain                                      │
│      │     context = "[1] React Hooks 是...\n\n[2] useState 是..."   │
│      │     ragPrompt → System + Human                                │
│      │     ragChain = [输入 → ragPrompt → LLM → StringOutputParser]  │
│      │                                                               │
│      └── Step C: ragChain.invoke("什么是 React Hooks？")              │
│            ├── 填充 Prompt 模板                                       │
│            ├── POST /chat/completions API（GLM-5）                    │
│            │     → AIMessage: "根据文档，React Hooks 是 React 16.8   │
│            │       引入的新特性，它让你在函数组件中使用 state..."        │
│            └── StringOutputParser 提取文本                            │
│                                                                      │
│    响应:                                                              │
│    {                                                                 │
│      "answer": "根据文档，React Hooks 是 React 16.8 引入的新特性...",│
│      "sources": [                                                    │
│        { "content": "React Hooks 是...", "score": 0.15,              │
│          "metadata": { "source": "react-docs" } },                   │
│        { "content": "useState 是...", "score": 0.23,                 │
│          "metadata": { "source": "react-docs" } }                    │
│      ]                                                               │
│    }                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 4.8 测试

### 启动服务

```bash
cd server && npm run start:dev
```

看到这些路由就说明 Phase 4 成功注册了：

```
Mapped {/rag/documents, POST} route
Mapped {/rag/documents/web, POST} route
Mapped {/rag/query, POST} route
Mapped {/rag/query/stream, POST} route
Mapped {/rag/status, GET} route
Mapped {/rag/documents, DELETE} route
```

### Step 1：查看知识库状态（应该为空）

```bash
curl http://localhost:3500/rag/status
```

预期输出：

```json
{"documentCount":0,"isReady":false}
```

### Step 2：添加文档到知识库

```bash
curl -X POST http://localhost:3500/rag/documents \
  -H "Content-Type: application/json" \
  -d '{
    "content": "React Hooks 是 React 16.8 引入的新特性。它让你在函数组件中使用 state 和其他 React 特性，而不需要写 class 组件。最常用的 Hooks 包括 useState、useEffect、useContext、useReducer 等。useState 用于在函数组件中添加状态，useEffect 用于处理副作用，比如数据获取、订阅、手动修改 DOM 等。",
    "metadata": { "source": "react-docs", "topic": "hooks" }
  }'
```

预期输出：

```json
{"success":true,"message":"文档已添加，生成 1 个文档块","chunksAdded":1}
```

### Step 3：再次查看状态

```bash
curl http://localhost:3500/rag/status
```

预期输出：

```json
{"documentCount":1,"isReady":true}
```

### Step 4：RAG 问答

```bash
curl -X POST http://localhost:3500/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question": "什么是 React Hooks？"}'
```

预期输出：

```json
{
  "answer": "根据提供的文档，React Hooks 是 React 16.8 引入的新特性。它让你在函数组件中使用 state 和其他 React 特性，而不需要写 class 组件。最常用的 Hooks 包括 useState、useEffect、useContext、useReducer 等。",
  "sources": [
    {
      "content": "React Hooks 是 React 16.8 引入的新特性...",
      "score": 0.15,
      "metadata": { "source": "react-docs", "topic": "hooks" }
    }
  ]
}
```

### Step 5：流式问答

```bash
curl -X POST http://localhost:3500/rag/query/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "useEffect 有什么用？"}'
```

预期输出：

```
data: {"type":"source","data":[{"content":"React Hooks 是...","score":0.23,...}]}
data: {"type":"token","data":"根据"}
data: {"type":"token","data":"文档"}
data: {"type":"token","data":"，"}
data: {"type":"token","data":"useEffect"}
data: {"type":"token","data":" 用于"}
data: {"type":"token","data":"处理"}
data: {"type":"token","data":"副作用"}
...
data: {"type":"done","data":null}
```

### Step 6：添加更多文档，验证检索

```bash
# 添加第二篇文档
curl -X POST http://localhost:3500/rag/documents \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Vue 3 的组合式 API（Composition API）是 Vue 3 的核心新特性。它通过 setup 函数提供了一种更灵活的方式来组织组件逻辑。核心函数包括 ref、reactive、computed、watch 等。ref 用于创建响应式引用，reactive 用于创建响应式对象。",
    "metadata": { "source": "vue-docs", "topic": "composition-api" }
  }'

# 现在知识库有两篇文档
curl http://localhost:3500/rag/status
# {"documentCount":2,"isReady":true}

# 问 React 相关问题——应该只引用 React 文档
curl -X POST http://localhost:3500/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question": "useState 怎么用？"}'
# → sources 中应该只有 react-docs 的文档，不会引用 vue-docs

# 问 Vue 相关问题——应该只引用 Vue 文档
curl -X POST http://localhost:3500/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Vue 的 ref 是什么？"}'
# → sources 中应该只有 vue-docs 的文档
```

### Step 7：清空知识库

```bash
curl -X DELETE http://localhost:3500/rag/documents
# {"success":true,"message":"知识库已清空"}

curl http://localhost:3500/rag/status
# {"documentCount":0,"isReady":false}
```

---

# 小结

## 概念速查表

```plain
概念                    作用                                  类比
──────────────────────  ──────────────────────────────────── ──────────────────────
RAG                     检索增强生成，让 LLM 基于文档回答       开卷考试 vs 闭卷考试
Document                LangChain 的文档统一格式               { content, metadata }
Document Loaders        加载各种格式文档为 Document 对象        fs.readFile() 但支持 PDF/网页/CSV
CheerioWebBaseLoader    加载静态网页                           jQuery 的服务端版本
Text Splitters          把长文档切成小块                        String.split() 但保持语义完整
RecursiveCharacter...   递归字符分块器（推荐）                   层层降级切分，先段落再句子再字符
chunkSize               每块最大字符数                          maxLength
chunkOverlap            相邻块重叠字符数                        防止信息断裂
Embeddings              把文本转成高维向量                       编码器，文本 → [0.12, -0.34, ...]
OpenAIEmbeddings        OpenAI 兼容的 Embedding API 封装       和 ChatOpenAI 类似但用途不同
Vector Store            存储向量 + 支持相似度搜索                数据库，但搜索的是"语义相似"
MemoryVectorStore       内存向量存储（开发用）                   localStorage（重启丢失）
similaritySearch        相似度搜索                              数据库 WHERE 但比的是向量距离
RAG Chain               检索 + Prompt + LLM 的完整管线          工厂流水线
RunnableSequence        线性管道编排                            Promise.then().then()
RunnablePassthrough     透传输入                               (x) => x
StringOutputParser      从 AIMessage 提取文本                   response.data.content
ChatPromptTemplate      Prompt 模板（带占位符）                  模板字符串 `${context}`
temperature 0.3         低温度，回答更确定                       RAG 要准确不要创造力
```

## 核心要点

1. **RAG = 让 LLM 开卷考试**：Phase 1-3 是闭卷（纯靠模型记忆），Phase 4 是开卷（先查文档再回答）。闭卷容易编答案（幻觉），开卷基于真实文档（可追溯）

2. **Embedding 模型 ≠ Chat 模型**：这是 Phase 4 最容易踩的坑。Chat 模型（GLM-5）输入文本输出文本，Embedding 模型（text-embedding-v1）输入文本输出向量。两者不能互换，本项目中它们甚至在不同平台（OneAPI vs DashScope），需要在 `.env` 中用 `EMBEDDING_*` 单独配置

3. **分块是 RAG 质量的关键**：chunkSize 太大检索不精准（噪声多），太小缺乏上下文（信息不足）。RecursiveCharacterTextSplitter 在自然边界切分，是最佳默认选择

4. **向量搜索是"语义搜索"而非"关键词搜索"**：用户问"React 函数组件的状态管理"能匹配到"useState Hook"——即使没有完全一样的关键词

5. **RAG Chain 是线性管道**：检索 → 注入上下文 → LLM 生成 → 提取输出。和 Phase 3 的 StateGraph（有循环、有条件路由）不同，RAG Chain 是固定流程

6. **Phase 1/2/3/4 可以共存且互补**：简单对话用原始 SDK，工具调用用 LangChain，复杂编排用 LangGraph，知识问答用 RAG——选择合适的能力层级

```plain
Phase 1 → LLM 自己回答（可能编）
Phase 2 → LLM 调 API 获取实时数据（天气、搜索）
Phase 3 → LLM 自动编排多轮工具调用（复杂任务）
Phase 4 → LLM 基于你的文档回答（私有知识）
```

下一步可以做什么？

1. **换成生产级向量数据库**：MemoryVectorStore → Pgvector（已有 PostgreSQL）或 Chroma（轻量级本地）
2. **支持更多文档格式**：PDFLoader、CSVLoader、MarkdownTextSplitter
3. **高级检索策略**：Multi-Query Retriever（把一个问题改写成多个来提高召回率）、Ensemble Retriever（向量+关键词混合搜索）
4. **Agentic RAG**：把 RAG 整合到 LangGraph Agent 中，让 Agent 自己决定"要不要检索文档"——Phase 3 + Phase 4 的结合
5. **前端界面**：文档上传 + 对话界面 + 引用来源高亮展示
