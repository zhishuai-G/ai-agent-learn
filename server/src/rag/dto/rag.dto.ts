import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

/**
 * 添加文档请求 DTO
 */
export class AddDocumentDto {
  @ApiProperty({ description: '文档内容', example: 'React Hooks 是 React 16.8 引入的新特性...' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '文档元数据（来源、标题等）' })
  @IsOptional()
  metadata?: Record<string, string>;
}

/**
 * 添加网页文档请求 DTO
 */
export class AddWebDocumentDto {
  @ApiProperty({ description: '网页 URL', example: 'https://react.dev/learn' })
  @IsString()
  url: string;
}

/**
 * RAG 问答请求 DTO
 */
export class RagQueryDto {
  @ApiProperty({ description: '用户问题', example: '什么是 React Hooks？' })
  @IsString()
  question: string;

  @ApiPropertyOptional({ description: '返回的相关文档数量', default: 4 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  topK?: number;
}

/**
 * 检索结果 DTO
 */
export class RetrievalResultDto {
  @ApiProperty({ description: '文档内容' })
  content: string;

  @ApiProperty({ description: '相关性分数' })
  score: number;

  @ApiPropertyOptional({ description: '文档元数据' })
  metadata?: Record<string, unknown>;
}

/**
 * RAG 问答响应 DTO
 */
export class RagAnswerDto {
  @ApiProperty({ description: 'AI 生成的答案' })
  answer: string;

  @ApiProperty({ description: '引用的来源文档', type: [RetrievalResultDto] })
  sources: RetrievalResultDto[];
}
