import { Controller, Post, Get, Delete, Body, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { RagService } from './rag.service';
import { RagDocumentService } from './rag-document.service';
import {
  AddDocumentDto,
  AddWebDocumentDto,
  RagQueryDto,
  RagAnswerDto,
} from './dto/rag.dto';

/**
 * RAG 控制器 - Phase 4: 检索增强生成
 *
 * 提供以下 API：
 * 1. POST /rag/documents - 添加文本文档
 * 2. POST /rag/documents/web - 从网页加载文档
 * 3. POST /rag/query - RAG 问答
 * 4. POST /rag/query/stream - RAG 流式问答
 * 5. GET /rag/status - 获取知识库状态
 * 6. DELETE /rag/documents - 清空知识库
 */
@ApiTags('RAG - 检索增强生成 (Phase 4)')
@Controller('rag')
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly ragDocumentService: RagDocumentService,
  ) { }

  /**
   * 添加文本文档到知识库
   */
  @Post('documents')
  @ApiOperation({
    summary: '添加文档',
    description: '将文本内容添加到知识库，自动进行分块和向量化',
  })
  @ApiResponse({ status: 201, description: '文档添加成功' })
  async addDocument(@Body() dto: AddDocumentDto) {
    const result = await this.ragDocumentService.addDocument(dto.content, dto.metadata);
    return {
      success: true,
      message: `文档已添加，生成 ${result.chunksAdded} 个文档块`,
      chunksAdded: result.chunksAdded,
    };
  }

  /**
   * 从网页加载文档
   */
  @Post('documents/web')
  @ApiOperation({
    summary: '从网页加载文档',
    description: '抓取网页内容并添加到知识库',
  })
  @ApiResponse({ status: 201, description: '网页文档添加成功' })
  async addWebDocument(@Body() dto: AddWebDocumentDto) {
    const result = await this.ragDocumentService.addWebDocument(dto.url);
    return {
      success: true,
      message: `网页已加载，生成 ${result.chunksAdded} 个文档块`,
      chunksAdded: result.chunksAdded,
    };
  }

  /**
   * RAG 问答（一次性返回）
   */
  @Post('query')
  @ApiOperation({
    summary: 'RAG 问答',
    description: '基于知识库内容回答问题，返回答案和引用来源',
  })
  @ApiResponse({ status: 200, description: '问答成功', type: RagAnswerDto })
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

  /**
   * RAG 流式问答（SSE）
   */
  @Post('query/stream')
  @ApiOperation({
    summary: 'RAG 流式问答',
    description: '基于知识库内容回答问题，以 SSE 流式返回答案',
  })
  async queryStream(@Body() dto: RagQueryDto, @Res() res: Response) {
    // 设置 SSE 响应头
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

  /**
   * 获取知识库状态
   */
  @Get('status')
  @ApiOperation({
    summary: '获取知识库状态',
    description: '返回当前知识库的文档数量和就绪状态',
  })
  getStatus() {
    return this.ragDocumentService.getStatus();
  }

  /**
   * 清空知识库
   */
  @Delete('documents')
  @ApiOperation({
    summary: '清空知识库',
    description: '删除所有已添加的文档',
  })
  async clearDocuments() {
    await this.ragDocumentService.clearKnowledgeBase();
    return { success: true, message: '知识库已清空' };
  }
}
