/**
 * Phase 6: MCP Module
 *
 * 注册 MCP 相关的 Controller 和 Service，
 * 导入 LangChainModule 获取 ChatOpenAI 模型实例。
 */
import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { LangChainModule } from '../langchain/langchain.module';

@Module({
  imports: [LangChainModule],    // 导入 LangChain 模块获取模型实例
  controllers: [McpController],  // 注册 MCP Controller
  providers: [McpService],       // 注册 MCP Service
})
export class McpModule {}
