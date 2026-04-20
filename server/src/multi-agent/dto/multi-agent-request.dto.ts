import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/** Supervisor 模式请求 DTO — AI 开发团队 */
export class SupervisorRequestDto {
  @ApiProperty({
    description: '需求描述',
    example: '开发一个 React Todo 应用，支持添加、删除、标记完成',
  })
  @IsString()
  @IsNotEmpty({ message: 'requirement 不能为空' })
  requirement: string;

  @ApiPropertyOptional({
    description: '线程 ID（用于持久化对话状态）',
    example: 'team-001',
  })
  @IsOptional()
  @IsString()
  threadId?: string;
}

/** Swarm 模式请求 DTO — 智能客服 */
export class SwarmRequestDto {
  @ApiProperty({
    description: '用户消息',
    example: '我想了解你们的产品价格',
  })
  @IsString()
  @IsNotEmpty({ message: 'message 不能为空' })
  message: string;

  @ApiPropertyOptional({
    description: '线程 ID',
    example: 'swarm-001',
  })
  @IsOptional()
  @IsString()
  threadId?: string;
}
