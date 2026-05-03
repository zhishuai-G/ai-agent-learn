import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { AgentService } from './agent.service';
import { AgentRequestDto } from './dto/agent-request.dto';
import { SkipTransform } from '../common/interceptors/transform.interceptor';

@ApiTags('Agent - 智能助手 (Phase 2)')
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * 智能助手聊天（带工具调用）
   *
   * SSE 事件格式：
   * - { type: 'tool_call', name: '...', args: {...}, id: '...' }   → 正在调用工具
   * - { type: 'tool_result', name: '...', result: '...', id: '...' } → 工具返回结果
   * - { type: 'content', content: '...' }                          → 最终回答
   * - { type: 'done' }                                             → 对话结束
   */
  @Post('chat')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '智能助手聊天（Tool Use）',
    description:
      '发送消息，AI 会自主判断是否需要调用工具（查天气、查时间、搜索知识），通过 SSE 实时推送工具调用过程和最终回答',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应（text/event-stream）' })
  @SwaggerResponse({ status: 400, description: '请求参数错误' })
  async agentChat(
    @Body() body: AgentRequestDto,
    @Res() res: Response,
  ) {
    const { message, history, systemPrompt } = body;

    // SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = this.agentService.chat(message, history, systemPrompt);
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
    } finally {
      res.end();
    }
  }
}
