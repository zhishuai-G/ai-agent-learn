import { Module } from '@nestjs/common';
import { CustomAgentController } from './custom-agent.controller';
import { CustomAgentService } from './custom-agent.service';
import { LangChainModule } from '../langchain/langchain.module';

@Module({
  imports: [LangChainModule],
  controllers: [CustomAgentController],
  providers: [CustomAgentService],
})
export class CustomAgentModule {}
