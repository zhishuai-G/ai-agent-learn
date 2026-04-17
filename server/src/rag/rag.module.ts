import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { LlmModule } from '../llm/llm.module';

/**
 * RAG 模块 - Phase 4: 检索增强生成
 *
 * 学习要点：
 * 1. Document Loaders: 加载各种格式的文档
 * 2. Text Splitters: 将文档分割成适合检索的块
 * 3. Embeddings: 将文本转换为向量
 * 4. Vector Store: 存储和检索向量
 * 5. RAG Chain: 检索 + 生成的完整流程
 */
@Module({
  imports: [LlmModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
