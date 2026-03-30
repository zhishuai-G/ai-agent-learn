import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    // 加载 .env 文件，全局可用
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,
  ],
})
export class AppModule {}
