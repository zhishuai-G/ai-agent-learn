import { Controller, Post, Body, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatReplyDto } from './dto/chat-reply.dto';
import { SkipTransform } from '../common/interceptors/transform.interceptor';

@ApiTags('Chat - 聊天')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '普通聊天', description: '发送消息，一次性返回完整的 LLM 响应' })
  @SwaggerResponse({ status: 200, description: '聊天成功', type: ChatReplyDto })
  @SwaggerResponse({ status: 400, description: '请求参数错误' })
  @SwaggerResponse({ status: 500, description: '服务器内部错误' })
  async chat(@Body() body: ChatRequestDto) {
    const { message, history, systemPrompt } = body;
    const reply = await this.chatService.chat(message, history, systemPrompt);
    return { reply };
  }

  @Post('stream')
  @SkipTransform()
  @ApiOperation({
    summary: '流式聊天 (SSE)',
    description: '发送消息，通过 Server-Sent Events 逐 token 推送响应。每条 SSE 数据格式: { content: string, done?: boolean }',
  })
  @SwaggerResponse({ status: 200, description: '流式聊天成功（SSE text/event-stream）' })
  @SwaggerResponse({ status: 400, description: '请求参数错误' })
  @SwaggerResponse({ status: 500, description: '服务器内部错误' })
  async chatStream(
    @Body() body: ChatRequestDto,
    @Res() res: Response,
  ) {
    const { message, history, systemPrompt, deepThink } = body;

    // 手动设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const stream = this.chatService.chatStream(
        message,
        history,
        systemPrompt,
        deepThink,
      );
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
