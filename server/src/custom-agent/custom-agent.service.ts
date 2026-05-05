import { Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangChainService } from '../langchain/langchain.service';
import { weatherTool, timeTool, searchTool } from '../langchain/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { HumanMessage } from '@langchain/core/messages';
import { streamMultiAgent } from '../multi-agent/multi-agent-stream.util';
import type { MultiAgentEvent } from '../multi-agent/multi-agent-stream.util';
import type { AvailableTool } from './dto/custom-agent-request.dto';

export interface CustomAgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  tools: AvailableTool[];
  model?: string;
  createdAt: number;
}

// 事件类型复用 MultiAgentEvent
export type CustomAgentEvent = MultiAgentEvent;

/** 工具名 → 工具实例映射 */
const TOOL_MAP: Record<string, typeof weatherTool | typeof timeTool | typeof searchTool> = {
  get_weather: weatherTool,
  get_current_time: timeTool,
  web_search: searchTool,
};

@Injectable()
export class CustomAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomAgentService.name);
  private agents = new Map<string, CustomAgentConfig>();
  private checkpointer!: RedisSaver;

  constructor(
    private readonly langchainService: LangChainService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    try {
      this.checkpointer = await RedisSaver.fromUrl(redisUrl);
      this.logger.log(`Redis checkpointer connected: ${redisUrl}`);
    } catch (error) {
      this.logger.warn(`Redis 连接失败，状态持久化将不可用: ${error.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.checkpointer) {
      await this.checkpointer.end();
    }
  }

  /** 创建 Agent 配置 */
  create(name: string, systemPrompt: string, tools: AvailableTool[], model?: string): CustomAgentConfig {
    const id = `agent-${Date.now()}`;
    const config: CustomAgentConfig = { id, name, systemPrompt, tools, model, createdAt: Date.now() };
    this.agents.set(id, config);
    this.logger.log(`Custom Agent created: ${name} (${id}), tools: ${tools.join(', ')}`);
    return config;
  }

  /** 列出所有 Agent 配置 */
  list(): CustomAgentConfig[] {
    return Array.from(this.agents.values());
  }

  /** 获取单个 Agent 配置 */
  get(id: string): CustomAgentConfig {
    const config = this.agents.get(id);
    if (!config) throw new NotFoundException(`Agent 配置不存在: ${id}`);
    return config;
  }

  /** 删除 Agent 配置 */
  delete(id: string): void {
    if (!this.agents.has(id)) throw new NotFoundException(`Agent 配置不存在: ${id}`);
    this.agents.delete(id);
    this.logger.log(`Custom Agent deleted: ${id}`);
  }

  /** 使用自定义 Agent 聊天 */
  async *chat(agentId: string, message: string, threadId?: string): AsyncGenerator<CustomAgentEvent> {
    const config = this.get(agentId);

    // 根据配置的工具列表查找工具实例
    const tools = config.tools
      .map(name => TOOL_MAP[name])
      .filter(Boolean);

    if (tools.length === 0) {
      yield { type: 'error', content: 'Agent 没有可用的工具' };
      yield { type: 'done' };
      return;
    }

    const llm = this.langchainService.getModel(config.model);
    const agent = createReactAgent({
      llm,
      tools,
      prompt: config.systemPrompt,
      ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
    });

    const runConfig = {
      configurable: { thread_id: threadId || `custom-${Date.now()}` },
      recursionLimit: 20,
    };

    this.logger.log(`Custom Agent chat started: ${config.name}, thread: ${runConfig.configurable.thread_id}`);

    yield* streamMultiAgent(agent, { messages: [new HumanMessage(message)] }, runConfig);
    yield { type: 'done' };
  }
}
