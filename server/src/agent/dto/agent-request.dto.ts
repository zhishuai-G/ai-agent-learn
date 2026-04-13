import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AgentMessageDto {
  @ApiProperty({ description: '消息角色', enum: ['user', 'assistant'], example: 'user' })
  @IsString()
  role: 'user' | 'assistant';

  @ApiProperty({ description: '消息内容', example: '你好' })
  @IsString()
  content: string;
}

export class AgentRequestDto {
  @ApiProperty({ description: '用户消息', example: '北京今天天气怎么样？' })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({
    description: '对话历史',
    type: [AgentMessageDto],
    example: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！我是智能助手，可以帮你查天气、查时间、搜索技术知识。' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentMessageDto)
  history?: AgentMessageDto[];

  @ApiPropertyOptional({
    description: '系统提示词（角色设定）',
    example: '你是一位智能助手，可以使用工具来帮助用户获取信息。',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}
