/**
 * Phase 5: Multi-Agent 核心服务
 *
 * 提供两种多 Agent 协作模式：
 * 1. Supervisor 模式 — AI 开发团队（PM → Architect → Developer → Reviewer）
 * 2. Swarm 模式 — 智能客服（销售 ↔ 技术支持 自动交接）
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangChainService } from '../langchain/langchain.service';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createSupervisor } from '@langchain/langgraph-supervisor';
import { createSwarm } from '@langchain/langgraph-swarm';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { HumanMessage } from '@langchain/core/messages';
import { streamMultiAgent } from './multi-agent-stream.util';
import type { MultiAgentEvent } from './multi-agent-stream.util';
import {
  analyzeRequirementTool,
  designArchitectureTool,
  writeCodeTool,
  reviewCodeTool,
} from './agents/tools';
import {
  SUPERVISOR_PROMPT,
  PM_PROMPT,
  ARCHITECT_PROMPT,
  DEVELOPER_PROMPT,
  REVIEWER_PROMPT,
  SALES_PROMPT,
  TECH_SUPPORT_PROMPT,
} from './agents/prompts';
import { weatherTool, timeTool, searchTool } from '../langchain/tools';

// 重新导出，供 controller 使用
export type { MultiAgentEvent };

@Injectable()
export class MultiAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MultiAgentService.name);
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
      this.logger.warn(
        `Redis 连接失败 (${redisUrl})，Multi-Agent 状态持久化将不可用: ${error.message}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.checkpointer) {
      await this.checkpointer.end();
      this.logger.log('Redis checkpointer disconnected');
    }
  }

  // ==================== Supervisor 模式：AI 开发团队 ====================

  /**
   * 运行 AI 开发团队
   *
   * 流程：用户需求 → PM 分析 → Architect 设计 → Developer 编码 → Reviewer 审查
   * 审查不通过时自动打回 Developer 重写（最多 2 轮）
   */
  async *runDevTeam(
    requirement: string,
    threadId?: string,
  ): AsyncGenerator<MultiAgentEvent> {
    const model = this.langchainService.getModel();

    // 1. 创建四个专业 Agent
    const pmAgent = createReactAgent({
      llm: model,
      tools: [analyzeRequirementTool],
      prompt: PM_PROMPT,
      name: 'pm',
    });

    const architectAgent = createReactAgent({
      llm: model,
      tools: [designArchitectureTool],
      prompt: ARCHITECT_PROMPT,
      name: 'architect',
    });

    const developerAgent = createReactAgent({
      llm: model,
      tools: [writeCodeTool],
      prompt: DEVELOPER_PROMPT,
      name: 'developer',
    });

    const reviewerAgent = createReactAgent({
      llm: model,
      tools: [reviewCodeTool],
      prompt: REVIEWER_PROMPT,
      name: 'reviewer',
    });

    // 2. 创建 Supervisor 编排图
    // 注意：createReactAgent 和 createSupervisor 之间有轻微的泛型类型不兼容，
    // 这是 @langchain 包之间的已知问题，使用 as any 绕过
    const supervisorGraph = createSupervisor({
      llm: model,
      agents: [pmAgent, architectAgent, developerAgent, reviewerAgent] as any,
      prompt: SUPERVISOR_PROMPT,
    });

    // 3. 编译（带 checkpointer 以支持状态持久化）
    const app = supervisorGraph.compile({
      ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
    });

    const config = {
      configurable: {
        thread_id: threadId || `team-${Date.now()}`,
      },
      recursionLimit: 50,
    };

    this.logger.log(`Supervisor Dev Team started, thread: ${config.configurable.thread_id}`);

    // 4. 流式执行
    yield* streamMultiAgent(
      app,
      { messages: [new HumanMessage(requirement)] },
      config,
    );

    yield { type: 'done' };
  }

  // ==================== Swarm 模式：智能客服 ====================

  /**
   * 运行智能客服系统
   *
   * 销售顾问和技术支持 Agent 通过 handoff 自动交接控制权，
   * 根据用户问题内容自动选择合适的专家。
   */
  async *runSwarm(
    message: string,
    threadId?: string,
  ): AsyncGenerator<MultiAgentEvent> {
    const model = this.langchainService.getModel();

    // 1. 创建客服 Agent（复用已有工具）
    const salesAgent = createReactAgent({
      llm: model,
      tools: [searchTool],
      prompt: SALES_PROMPT,
      name: 'sales',
    });

    const techAgent = createReactAgent({
      llm: model,
      tools: [searchTool, timeTool, weatherTool],
      prompt: TECH_SUPPORT_PROMPT,
      name: 'tech_support',
    });

    // 2. 创建 Swarm（自动为每个 Agent 生成 handoff 工具）
    const swarmGraph = createSwarm({
      agents: [salesAgent, techAgent] as any,
      defaultActiveAgent: 'sales',
    });

    // 3. 编译
    const app = swarmGraph.compile({
      ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
    });

    const config = {
      configurable: {
        thread_id: threadId || `swarm-${Date.now()}`,
      },
      recursionLimit: 30,
    };

    this.logger.log(`Swarm Customer Service started, thread: ${config.configurable.thread_id}`);

    // 4. 流式执行
    yield* streamMultiAgent(
      app,
      { messages: [new HumanMessage(message)] },
      config,
    );

    yield { type: 'done' };
  }
}
