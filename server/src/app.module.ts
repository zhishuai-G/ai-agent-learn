import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { AgentModule } from './agent/agent.module';
import { LangGraphModule } from './langgraph/langgraph.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    // 加载 .env 文件，全局可用
    ConfigModule.forRoot({ isGlobal: true }),
    ChatModule,
    AgentModule,
    LangGraphModule, // Phase 3: LangGraph Agent 编排引擎
    RagModule, // Phase 4: RAG 检索增强生成
  ],
})
export class AppModule {}
