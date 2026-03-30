import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatReplyDto } from './dto/chat-reply.dto';

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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '流式聊天 (SSE)',
    description: '发送消息，通过 Server-Sent Events 逐 token 推送响应。每条 SSE 数据格式: { content: string, done?: boolean }',
  })
  @SwaggerResponse({ status: 200, description: '流式聊天成功（SSE text/event-stream）' })
  @SwaggerResponse({ status: 400, description: '请求参数错误' })
  @SwaggerResponse({ status: 500, description: '服务器内部错误' })
  chatStream(@Body() body: ChatRequestDto): Observable<MessageEvent> {
    const { message, history, systemPrompt } = body;

    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          const stream = this.chatService.chatStream(
            message,
            history,
            systemPrompt,
          );
          for await (const chunk of stream) {
            subscriber.next({
              data: JSON.stringify({ content: chunk }),
            } as MessageEvent);
          }
          subscriber.next({
            data: JSON.stringify({ content: '', done: true }),
          } as MessageEvent);
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
    });
  }
}
