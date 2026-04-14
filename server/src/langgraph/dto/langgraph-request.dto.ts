import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MessageDto {
  @ApiProperty({ description: '消息角色', enum: ['user', 'assistant'], example: 'user' })
  @IsString()
  role: 'user' | 'assistant';

  @ApiProperty({ description: '消息内容', example: '你好' })
  @IsString()
  content: string;
}

export class LangGraphRequestDto {
  @ApiProperty({ description: '用户消息', example: '帮我搜索一下 React 19 的新特性' })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({
    description: '线程 ID（用于多轮对话，通过 checkpointer 持久化）',
    example: 'thread-001',
  })
  @IsOptional()
  @IsString()
  threadId?: string;

  @ApiPropertyOptional({
    description: '对话历史',
    type: [MessageDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  history?: MessageDto[];

  @ApiPropertyOptional({ description: '系统提示词' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

export class LangGraphResumeDto {
  @ApiProperty({ description: '线程 ID', example: 'thread-001' })
  @IsString()
  @IsNotEmpty()
  threadId: string;

  @ApiPropertyOptional({
    description: '人工审核后的输入（用于 interrupt 恢复）',
    example: '确认执行',
  })
  @IsOptional()
  @IsString()
  humanInput?: string;
}
