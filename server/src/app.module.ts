import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [
    // 加载 .env 文件，全局可用
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,
    AgentModule,
  ],
})
export class AppModule {}
