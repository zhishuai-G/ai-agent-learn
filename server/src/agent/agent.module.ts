import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { LangChainModule } from '../langchain/langchain.module';

@Module({
  imports: [LangChainModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
