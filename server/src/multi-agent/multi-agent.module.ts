import { Module } from '@nestjs/common';
import { MultiAgentController } from './multi-agent.controller';
import { MultiAgentService } from './multi-agent.service';
import { LangChainModule } from '../langchain/langchain.module';

@Module({
  imports: [LangChainModule],
  controllers: [MultiAgentController],
  providers: [MultiAgentService],
})
export class MultiAgentModule {}
