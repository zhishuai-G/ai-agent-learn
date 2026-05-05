/**
 * Phase 5: Multi-Agent 核心服务
 *
 * 提供两种多 Agent 协作模式：
 * 1. Supervisor 模式 — AI 开发团队（PM → Architect → Developer → Reviewer）
 * 2. Swarm 模式 — 智能客服（销售 ↔ 技术支持 自动交接）
 */

// NestJS 核心装饰器和生命周期接口
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// NestJS 配置服务，读取 .env 环境变量
import { ConfigService } from '@nestjs/config';
// Phase 2 封装的 LangChain 服务，提供 ChatOpenAI 模型实例
import { LangChainService } from '../langchain/langchain.service';
// LangGraph 预构建的 ReAct Agent 工厂函数（Phase 3 学过）
import { createReactAgent } from '@langchain/langgraph/prebuilt';
// Supervisor 编排：中心调度者分配任务给专业 Agent
import { createSupervisor } from '@langchain/langgraph-supervisor';
// Swarm 协作：Agent 之间直接交接控制权，无中心调度
import { createSwarm } from '@langchain/langgraph-swarm';
// Redis 状态持久化，支持同一 threadId 的对话记忆
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
// LangChain 消息类型，用于构建 LLM 输入
import { HumanMessage } from '@langchain/core/messages';
// 多 Agent SSE 事件流工具，将 LangGraph streamEvents 转为前端可用的格式
import { streamMultiAgent } from './multi-agent-stream.util';
// 事件类型定义，供 controller 类型推断使用
import type { MultiAgentEvent } from './multi-agent-stream.util';
// Supervisor 模式的四个专业 Agent 工具（语义标记工具）
import {
  analyzeRequirementTool,  // PM 需求分析工具
  designArchitectureTool,  // Architect 架构设计工具
  writeCodeTool,           // Developer 编码工具
  reviewCodeTool,          // Reviewer 审查工具
} from './agents/tools';
// 所有 Agent 的系统提示词
import {
  SUPERVISOR_PROMPT,       // Supervisor 调度提示词
  PM_PROMPT,               // 产品经理提示词
  ARCHITECT_PROMPT,        // 架构师提示词
  DEVELOPER_PROMPT,        // 开发者提示词
  REVIEWER_PROMPT,         // 审查者提示词
  SALES_PROMPT,            // 销售顾问提示词
  TECH_SUPPORT_PROMPT,     // 技术支持提示词
} from './agents/prompts';
// Phase 2 定义的通用工具，Swarm 模式的 Agent 复用
import { weatherTool, timeTool, searchTool } from '../langchain/tools';

// 重新导出事件类型，供 controller 使用（避免 controller 直接引用 util 文件）
export type { MultiAgentEvent };

@Injectable() // NestJS 依赖注入标记
export class MultiAgentService implements OnModuleInit, OnModuleDestroy {
  // NestJS 日志器，输出格式：[MultiAgentService] xxx
  private readonly logger = new Logger(MultiAgentService.name);
  // Redis checkpointer 实例，用于 LangGraph 状态持久化
  // ! 表示确定性赋值（在 onModuleInit 中初始化）
  private checkpointer!: RedisSaver;

  constructor(
    // 注入 LangChain 服务，获取 ChatOpenAI 模型实例
    private readonly langchainService: LangChainService,
    // 注入配置服务，读取 REDIS_URL 等环境变量
    private readonly configService: ConfigService,
  ) {}

  /**
   * 模块初始化时连接 Redis
   * 用 onModuleInit 而非 constructor 是因为 RedisSaver.fromUrl 是异步操作
   */
  async onModuleInit() {
    // 从 .env 读取 Redis 连接地址，默认 localhost:6379
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    try {
      // 创建 Redis checkpointer 实例（LangGraph 状态持久化需要 Redis 8.0+）
      this.checkpointer = await RedisSaver.fromUrl(redisUrl);
      this.logger.log(`Redis checkpointer connected: ${redisUrl}`);
    } catch (error) {
      // Redis 连接失败不影响核心功能，只是状态无法持久化（重启后对话丢失）
      this.logger.warn(
        `Redis 连接失败 (${redisUrl})，Multi-Agent 状态持久化将不可用: ${error.message}`,
      );
    }
  }

  /**
   * 模块销毁时断开 Redis 连接，优雅退出
   */
  async onModuleDestroy() {
    if (this.checkpointer) {
      await this.checkpointer.end(); // 关闭 Redis 连接
      this.logger.log('Redis checkpointer disconnected');
    }
  }

  // ==================== Supervisor 模式：AI 开发团队 ====================

  /**
   * 运行 AI 开发团队
   *
   * 流程：用户需求 → PM 分析 → Architect 设计 → Developer 编码 → Reviewer 审查
   * 审查不通过时自动打回 Developer 重写（最多 2 轮）
   *
   * @param requirement 用户的需求描述
   * @param threadId 可选的对话线程 ID，同一 ID 共享对话记忆
   * @yields MultiAgentEvent SSE 事件流
   */
  async *runDevTeam(
    requirement: string,
    threadId?: string,
    model?: string,
  ): AsyncGenerator<MultiAgentEvent> {
    // 获取 ChatOpenAI 模型实例（复用 Phase 2 的 LangChainService）
    const llm = this.langchainService.getModel(model);

    // ---- 1. 创建四个专业 Agent ----
    // 每个 Agent 都是一个 createReactAgent（Phase 3 学过的 ReAct Agent）
    // 拥有独立的提示词（角色定义）和专属工具（专业分工）

    // PM Agent：只配备需求分析工具
    const pmAgent = createReactAgent({
      llm,                                    // 复用同一个 LLM 模型
      tools: [analyzeRequirementTool],     // PM 专属工具：分析需求
      prompt: PM_PROMPT,                  // PM 角色提示词
      name: 'pm',                         // Agent 名称，Supervisor 靠 name 路由
    });

    // Architect Agent：只配备架构设计工具
    const architectAgent = createReactAgent({
      llm,
      tools: [designArchitectureTool],    // Architect 专属工具：设计方案
      prompt: ARCHITECT_PROMPT,
      name: 'architect',
    });

    // Developer Agent：只配备编码工具
    const developerAgent = createReactAgent({
      llm,
      tools: [writeCodeTool],             // Developer 专属工具：编写代码
      prompt: DEVELOPER_PROMPT,
      name: 'developer',
    });

    // Reviewer Agent：只配备代码审查工具
    const reviewerAgent = createReactAgent({
      llm,
      tools: [reviewCodeTool],            // Reviewer 专属工具：审查代码
      prompt: REVIEWER_PROMPT,
      name: 'reviewer',
    });

    // ---- 2. 创建 Supervisor 编排图 ----
    // createSupervisor 会自动为每个 Agent 生成 transfer_to_xxx 工具
    // Supervisor 通过 LLM 推理决定调用哪个 transfer_to_xxx
    // 注意：createReactAgent 和 createSupervisor 之间有轻微的泛型类型不兼容，
    // 这是 @langchain 包之间的已知问题，使用 as any 绕过
    const supervisorGraph = createSupervisor({
      llm,  // Supervisor 自己也用 LLM 来决定调度（不是硬编码路由！）
      agents: [pmAgent, architectAgent, developerAgent, reviewerAgent] as any,
      prompt: SUPERVISOR_PROMPT,  // 定义工作流程的提示词
    });

    // ---- 3. 编译图（带 checkpointer 以支持状态持久化）----
    // compile() 将声明式图定义转为可执行的状态机
    // checkpointer 让同一 thread_id 的多次请求共享对话记忆
    const app = supervisorGraph.compile({
      ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}), // 有 Redis 才持久化
    });

    // 运行时配置
    const config = {
      configurable: {
        // 线程 ID：相同 ID 的请求共享 LangGraph 状态（对话历史、Agent 输出等）
        thread_id: threadId || `team-${Date.now()}`, // 未指定则自动生成
      },
      recursionLimit: 50, // 最大递归深度：4 个 Agent + 可能的审查打回循环，设 50 留余量
    };

    this.logger.log(`Supervisor Dev Team started, thread: ${config.configurable.thread_id}`);

    // ---- 4. 流式执行 ----
    // streamMultiAgent 将 LangGraph 的 streamEvents 转为前端需要的 MultiAgentEvent
    // yield* 委托生成器，将内部事件逐个抛出
    yield* streamMultiAgent(
      app,
      { messages: [new HumanMessage(requirement)] }, // 初始输入：用户需求作为 HumanMessage
      config,
    );

    // 所有 Agent 执行完毕后，发送 done 事件
    yield { type: 'done' };
  }

  // ==================== Swarm 模式：智能客服 ====================

  /**
   * 运行智能客服系统
   *
   * 销售顾问和技术支持 Agent 通过 handoff 自动交接控制权，
   * 根据用户问题内容自动选择合适的专家。
   *
   * @param message 用户消息
   * @param threadId 可选的对话线程 ID
   * @yields MultiAgentEvent SSE 事件流
   */
  async *runSwarm(
    message: string,
    threadId?: string,
    model?: string,
  ): AsyncGenerator<MultiAgentEvent> {
    const llm = this.langchainService.getModel(model);

    // ---- 1. 创建客服 Agent（复用 Phase 2 已有工具）----
    // 和 Supervisor 不同，Swarm 的 Agent 通过提示词引导自主交接

    // Sales Agent：销售顾问，只能用搜索工具
    const salesAgent = createReactAgent({
      llm,
      tools: [searchTool],               // 只需要搜索产品信息
      prompt: SALES_PROMPT,              // 提示词中包含"遇到技术问题交给 tech_support"
      name: 'sales',
    });

    // Tech Support Agent：技术支持，配备更多工具
    const techAgent = createReactAgent({
      llm,
      tools: [searchTool, timeTool, weatherTool], // 技术问题可能需要查时间、天气等
      prompt: TECH_SUPPORT_PROMPT,       // 提示词中包含"遇到价格问题交给 sales"
      name: 'tech_support',
    });

    // ---- 2. 创建 Swarm 协作图 ----
    // createSwarm 会自动为每个 Agent 生成 handoff 工具（transfer_to_sales、transfer_to_tech_support）
    // Agent 的 LLM 根据提示词引导，自行决定是否调用 transfer 工具
    // 和 Supervisor 的区别：没有中心调度者，Agent 之间直接交接
    const swarmGraph = createSwarm({
      agents: [salesAgent, techAgent] as any,  // as any 绕过类型不兼容
      defaultActiveAgent: 'sales',              // 用户第一条消息默认由 Sales 处理
    });

    // ---- 3. 编译 ----
    const app = swarmGraph.compile({
      ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
    });

    const config = {
      configurable: {
        thread_id: threadId || `swarm-${Date.now()}`, // Swarm 模式的线程 ID 前缀
      },
      recursionLimit: 30, // Swarm 只有 2 个 Agent，交接次数有限，30 足够
    };

    this.logger.log(`Swarm Customer Service started, thread: ${config.configurable.thread_id}`);

    // ---- 4. 流式执行 ----
    yield* streamMultiAgent(
      app,
      { messages: [new HumanMessage(message)] }, // 用户消息作为初始输入
      config,
    );

    yield { type: 'done' };
  }
}
