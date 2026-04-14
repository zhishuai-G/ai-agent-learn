import { Module } from '@nestjs/common';
import { LangGraphController } from './langgraph.controller';
import { LangGraphService } from './langgraph.service';
import { LangChainModule } from '../langchain/langchain.module';

@Module({
  imports: [LangChainModule],
  controllers: [LangGraphController],
  providers: [LangGraphService],
})
export class LangGraphModule {}
