import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class ChatMessageDto {
  @ApiProperty({ description: '消息角色', enum: ['system', 'user', 'assistant'], example: 'user' })
  @IsString()
  role: 'system' | 'user' | 'assistant';

  @ApiProperty({ description: '消息内容', example: '你好' })
  @IsString()
  content: string;
}

export class ChatRequestDto {
  @ApiProperty({ description: '用户消息', example: '什么是 LLM？' })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({
    description: '对话历史',
    type: [ChatMessageDto],
    example: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮助你的吗？' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @ApiPropertyOptional({
    description: '系统提示词（角色设定）',
    example: '你是一位资深的前端架构师，擅长 React 和 NestJS',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description: '是否开启深度思考（使用推理模型）',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  deepThink?: boolean;
}
