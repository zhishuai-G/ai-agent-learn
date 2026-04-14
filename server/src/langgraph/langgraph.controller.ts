import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { LangGraphService } from './langgraph.service';
import { LangGraphRequestDto, LangGraphResumeDto } from './dto/langgraph-request.dto';
import { SkipTransform } from '../common/interceptors/transform.interceptor';

/**
 * Phase 3 - LangGraph API
 *
 * 提供三种 Agent 模式的 API 端点：
 * 1. /langgraph/chat          → 自定义 StateGraph Agent
 * 2. /langgraph/react         → 预构建 ReAct Agent
 * 3. /langgraph/hitl          → Human-in-the-Loop Agent
 * 4. /langgraph/hitl/resume   → 恢复被中断的执行
 */
@ApiTags('LangGraph - Agent 编排引擎 (Phase 3)')
@Controller('langgraph')
export class LangGraphController {
  constructor(private readonly langGraphService: LangGraphService) {}

  /**
   * 自定义 StateGraph Agent
   *
   * 展示手动构建 StateGraph 的完整流程：
   * Annotation → Node → Edge → ConditionalEdges → compile → stream
   */
  @Post('chat')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '自定义 StateGraph Agent',
    description:
      '使用手动构建的 StateGraph 实现 Agent，展示 Node/Edge/条件路由的完整流程。支持通过 threadId 维持多轮对话。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async stateGraphChat(
    @Body() body: LangGraphRequestDto,
    @Res() res: Response,
  ) {
    const { message, threadId, history, systemPrompt } = body;
    this.setupSSE(res);

    try {
      const stream = this.langGraphService.chatWithStateGraph(
        message, threadId, history, systemPrompt,
      );
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
   * 预构建 ReAct Agent
   *
   * 使用 createReactAgent 快速创建 Agent，
   * 内部自动构建 StateGraph + Tool Use 循环
   */
  @Post('react')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '预构建 ReAct Agent',
    description:
      '使用 createReactAgent 创建的 Agent，内置 Tool Use 循环。支持通过 threadId 维持多轮对话。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async reactAgentChat(
    @Body() body: LangGraphRequestDto,
    @Res() res: Response,
  ) {
    const { message, threadId, systemPrompt } = body;
    this.setupSSE(res);

    try {
      const stream = this.langGraphService.chatWithReactAgent(
        message, threadId, systemPrompt,
      );
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
   * Human-in-the-Loop Agent
   *
   * Agent 在调用工具前会暂停，等待人工确认。
   * 收到 interrupt 事件后，前端应展示待执行的工具调用，
   * 用户确认后调用 /langgraph/hitl/resume 恢复执行。
   */
  @Post('hitl')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Human-in-the-Loop Agent',
    description:
      '带人工审核的 Agent。Agent 想调用工具时会自动暂停，返回 interrupt 事件。需要传 threadId 用于后续恢复。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应，可能包含 interrupt 事件' })
  async hitlChat(
    @Body() body: LangGraphRequestDto,
    @Res() res: Response,
  ) {
    const { message, threadId, systemPrompt } = body;
    this.setupSSE(res);

    try {
      const stream = this.langGraphService.chatWithHumanInTheLoop(
        message, threadId || `hitl-${Date.now()}`, systemPrompt,
      );
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
   * 恢复被中断的 Agent
   *
   * 在 Human-in-the-Loop 场景中，用户确认后调用此接口，
   * Agent 会从检查点恢复执行工具调用。
   */
  @Post('hitl/resume')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '恢复被中断的 Agent 执行',
    description: '用户确认工具调用后，传入 threadId 恢复 Agent 从检查点继续执行。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async hitlResume(
    @Body() body: LangGraphResumeDto,
    @Res() res: Response,
  ) {
    this.setupSSE(res);

    try {
      const stream = this.langGraphService.resumeExecution(body.threadId);
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
