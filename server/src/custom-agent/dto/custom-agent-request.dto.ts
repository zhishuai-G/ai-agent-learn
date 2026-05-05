import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, ArrayMinSize } from 'class-validator';

/** 可选工具名称 */
export const AVAILABLE_TOOLS = ['get_weather', 'get_current_time', 'web_search'] as const;
export type AvailableTool = typeof AVAILABLE_TOOLS[number];

/** 创建自定义 Agent 配置 */
export class CreateCustomAgentDto {
  @ApiProperty({ description: 'Agent 名称', example: '旅行助手' })
  @IsString()
  @IsNotEmpty({ message: 'name 不能为空' })
  name: string;

  @ApiProperty({
    description: '系统提示词',
    example: '你是一位旅行助手，帮助用户规划旅行路线、查询天气和时间。',
  })
  @IsString()
  @IsNotEmpty({ message: 'systemPrompt 不能为空' })
  systemPrompt: string;

  @ApiProperty({
    description: '启用的工具列表',
    example: ['get_weather', 'get_current_time'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: '至少选择一个工具' })
  tools: AvailableTool[];

  @ApiPropertyOptional({ description: '模型名称', enum: ['minimax-m2.7', 'kimi-k2.6', 'glm-5.1'] })
  @IsOptional()
  @IsString()
  model?: string;
}

/** 自定义 Agent 聊天请求 */
export class CustomAgentChatDto {
  @ApiProperty({ description: 'Agent 配置 ID', example: 'agent-001' })
  @IsString()
  @IsNotEmpty()
  agentId: string;

  @ApiProperty({ description: '用户消息', example: '帮我查一下北京天气' })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({ description: '线程 ID' })
  @IsOptional()
  @IsString()
  threadId?: string;
}
