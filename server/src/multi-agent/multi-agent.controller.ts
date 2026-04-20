/**
 * Phase 5: Multi-Agent Controller
 *
 * 提供两个 SSE 流式端点：
 * 1. POST /multi-agent/supervisor — AI 开发团队（Supervisor 模式）
 * 2. POST /multi-agent/swarm     — 智能客服（Swarm 模式）
 */
import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { MultiAgentService } from './multi-agent.service';
import { SupervisorRequestDto, SwarmRequestDto } from './dto/multi-agent-request.dto';
import { SkipTransform } from '../common/interceptors/transform.interceptor';

@ApiTags('Multi-Agent - 多 Agent 协作系统 (Phase 5)')
@Controller('multi-agent')
export class MultiAgentController {
  constructor(private readonly multiAgentService: MultiAgentService) {}

  /**
   * AI 开发团队 — Supervisor 模式
   *
   * 用户提交需求描述，由 Supervisor 协调 PM → Architect → Developer → Reviewer
   * 四个 Agent 依次协作完成。支持 Code Review 不通过时自动打回重写。
   */
  @Post('supervisor')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'AI 开发团队（Supervisor 模式）',
    description:
      '提交需求描述，由 PM→Architect→Developer→Reviewer 四个 Agent 协作完成。' +
      'Supervisor 负责调度任务分配。支持 Code Review 不通过时自动打回重写循环。' +
      '返回 SSE 流，包含 agent_start/handoff/content/tool_call/tool_result/agent_end/done 事件。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async supervisorChat(
    @Body() body: SupervisorRequestDto,
    @Res() res: Response,
  ) {
    const { requirement, threadId } = body;
    this.setupSSE(res);

    try {
      const stream = this.multiAgentService.runDevTeam(requirement, threadId);
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      this.writeError(res, error);
    } finally {
      res.end();
    }
  }

  /**
   * 智能客服 — Swarm 模式
   *
   * Agent 之间通过 handoff 自动交接控制权。
   * 销售顾问和技术支持根据用户问题内容自动切换。
   */
  @Post('swarm')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '智能客服（Swarm 模式）',
    description:
      'Agent 之间通过 handoff 自动交接控制权。销售顾问和技术支持根据用户问题自动切换。' +
      '返回 SSE 流，包含 agent_start/handoff/content/agent_end/done 事件。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async swarmChat(
    @Body() body: SwarmRequestDto,
    @Res() res: Response,
  ) {
    const { message, threadId } = body;
    this.setupSSE(res);

    try {
      const stream = this.multiAgentService.runSwarm(message, threadId);
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      this.writeError(res, error);
    } finally {
      res.end();
    }
  }

  // ---- 辅助方法 ----

  private setupSSE(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  private writeError(res: Response, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
  }
}
