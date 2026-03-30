import { ApiProperty } from '@nestjs/swagger';

export class ChatReplyDto {
  @ApiProperty({ description: 'LLM 回复内容', example: 'LLM 是大语言模型的缩写...' })
  reply: string;
}
