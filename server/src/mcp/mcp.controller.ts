/**
 * Phase 6: MCP Controller
 *
 * 提供两个端点：
 * 1. POST /mcp/chat   — MCP Agent 聊天（通过 MCP 协议动态发现工具）
 * 2. GET  /mcp/tools  — 列出 MCP Server 提供的所有工具（演示动态发现）
 *
 * 对比 Phase 2 的 AgentController：
 * - Phase 2：Agent 用硬编码的 [weatherTool, timeTool, searchTool]
 * - Phase 6：Agent 用 MCP Client 动态获取的工具，加工具不改 Agent 代码
 */
import { Controller, Post, Get, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { McpService } from './mcp.service';
import { McpChatRequestDto } from './dto/mcp-request.dto';
import { SkipTransform } from '../common/interceptors/transform.interceptor';

@ApiTags('MCP - 工具协议与标准化 (Phase 6)')
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  /**
   * MCP Agent 聊天 — 工具通过 MCP 协议动态获取
   *
   * 和 Phase 2 的 /agent/chat 功能相同，但工具来源不同：
   * - Phase 2：工具在代码里 import，和 Agent 绑死
   * - Phase 6：工具通过 MCP Server 动态提供，运行时发现
   *
   * SSE 事件流包含：
   * - tools_discovered：发现了哪些 MCP 工具
   * - agent_start/agent_end：Agent 执行状态
   * - tool_call/tool_result：工具调用链路
   * - content：最终回答
   * - done：结束
   */
  @Post('chat')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'MCP Agent 聊天',
    description:
      '通过 MCP 协议动态发现工具，使用 ReAct Agent 回答用户问题。' +
      '和 Phase 2 的 /agent/chat 功能相同，但工具来源从硬编码变为 MCP 动态获取。' +
      '返回 SSE 流，包含 tools_discovered/agent_start/tool_call/tool_result/content/done 事件。',
  })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async chat(
    @Body() body: McpChatRequestDto,
    @Res() res: Response,
  ) {
    const { message, threadId, model } = body;

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = this.mcpService.chat(message, threadId, model);
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

  /**
   * 列出 MCP Server 提供的工具
   *
   * 这个端点展示 MCP 的"动态发现"能力：
   * - 不需要在代码里硬编码工具列表
   * - 通过 MCP 协议实时查询 Server 注册了哪些工具
   * - 如果 Server 新增了工具，下次查询就能看到
   */
  @Get('tools')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '列出 MCP 工具',
    description:
      '通过 MCP 协议动态发现所有可用工具，展示 MCP 的动态发现能力。' +
      '返回工具名称和描述列表。',
  })
  @SwaggerResponse({ status: 200, description: '工具列表' })
  async listTools() {
    const tools = await this.mcpService.listTools();
    return {
      serverName: 'tools',
      toolCount: tools.length,
      tools,
    };
  }
}
