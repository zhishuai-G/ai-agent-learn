import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/** MCP Agent 聊天请求 DTO */
export class McpChatRequestDto {
  @ApiProperty({
    description: '用户消息',
    example: '今天北京天气怎么样？',
  })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({
    description: '线程 ID（用于持久化对话状态）',
    example: 'mcp-001',
  })
  @IsOptional()
  @IsString()
  threadId?: string;

  @ApiPropertyOptional({ description: '模型名称', enum: ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k2.6'] })
  @IsOptional()
  @IsString()
  model?: string;
}
