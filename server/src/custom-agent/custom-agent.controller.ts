import { Controller, Post, Get, Delete, Body, Param, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { CustomAgentService } from './custom-agent.service';
import { CreateCustomAgentDto, CustomAgentChatDto } from './dto/custom-agent-request.dto';
import { SkipTransform } from '../common/interceptors/transform.interceptor';

@ApiTags('Custom Agent - 自定义 Agent (毕业项目)')
@Controller('custom-agent')
export class CustomAgentController {
  constructor(private readonly customAgentService: CustomAgentService) {}

  /** 创建自定义 Agent 配置 */
  @Post()
  @ApiOperation({ summary: '创建自定义 Agent', description: '配置 Agent 的名称、提示词和工具列表' })
  @SwaggerResponse({ status: 201, description: '创建成功' })
  create(@Body() body: CreateCustomAgentDto) {
    return this.customAgentService.create(body.name, body.systemPrompt, body.tools, body.model);
  }

  /** 列出所有自定义 Agent */
  @Get()
  @ApiOperation({ summary: '列出所有自定义 Agent' })
  list() {
    return this.customAgentService.list();
  }

  /** 使用自定义 Agent 聊天 */
  @Post('chat')
  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '自定义 Agent 聊天', description: '基于保存的 Agent 配置动态创建 Agent 并流式聊天' })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async chat(@Body() body: CustomAgentChatDto, @Res() res: Response) {
    const { agentId, message, threadId } = body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = this.customAgentService.chat(agentId, message, threadId);
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

  /** 删除自定义 Agent */
  @Delete(':id')
  @ApiOperation({ summary: '删除自定义 Agent' })
  remove(@Param('id') id: string) {
    this.customAgentService.delete(id);
    return { deleted: true };
  }
}
