/**
 * Phase 6: MCP Service — MCP Client 端核心服务
 *
 * 这是 Phase 6 的核心学习内容：
 * 1. MultiServerMCPClient — 管理 MCP Server 连接，支持同时连接多个 Server
 * 2. client.getTools() — 动态发现工具（运行时从 MCP Server 获取，不再硬编码）
 * 3. 将 MCP 工具注入 createReactAgent — 和 Phase 3 用法一致！
 *
 * 对比 Phase 2-5 的硬编码方式：
 * ```typescript
 * // Phase 2: 工具直接 import 后绑定到 Agent
 * import { weatherTool, timeTool, searchTool } from '../langchain/tools';
 * const agent = createReactAgent({ tools: [weatherTool, timeTool, searchTool] });
 *
 * // Phase 6: 工具通过 MCP 协议动态获取
 * const mcpTools = await mcpClient.getTools();
 * const agent = createReactAgent({ tools: mcpTools });
 * ```
 *
 * 关键区别：
 * - 加工具不用改 Agent 代码 → 只需在 MCP Server 里 server.tool() 注册新工具
 * - 多个 Agent 共享工具 → 多个 Agent 连同一个 MCP Server 即可
 * - 运行时动态发现 → Agent 启动时自动获取最新的工具列表
 */

// NestJS 核心装饰器和生命周期接口
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// NestJS 配置服务，读取 .env 环境变量
import { ConfigService } from '@nestjs/config';
// Phase 2 封装的 LangChain 服务，提供 ChatOpenAI 模型实例
import { LangChainService } from '../langchain/langchain.service';
// LangGraph 预构建的 ReAct Agent 工厂函数（Phase 3 学过）
import { createReactAgent } from '@langchain/langgraph/prebuilt';
// Redis 状态持久化，支持同一 threadId 的对话记忆
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
// LangChain 消息类型
import { HumanMessage } from '@langchain/core/messages';
// ---- MCP 核心依赖 ----
// MultiServerMCPClient：管理多个 MCP Server 连接的客户端
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
// 多 Agent SSE 事件流工具（Phase 5 已有，这里复用）
import { streamMultiAgent } from '../multi-agent/multi-agent-stream.util';
import type { MultiAgentEvent } from '../multi-agent/multi-agent-stream.util';
// path 模块用于解析 MCP Server 脚本路径
import * as path from 'path';

// 重新导出事件类型
export type { MultiAgentEvent };

/** MCP Agent 事件类型 —— 复用 Phase 5 的 MultiAgentEvent */
export interface McpAgentEvent {
  type: 'tool_call' | 'tool_result' | 'content' | 'done' | 'error' | 'mcp_connected' | 'tools_discovered';
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
  result?: string;
  content?: string;
  error?: string;
  tools?: string[];
  serverName?: string;
}

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  // Redis checkpointer 实例
  private checkpointer!: RedisSaver;
  // MCP Client 实例——管理与 MCP Server 的连接
  private mcpClient!: MultiServerMCPClient;

  constructor(
    private readonly langchainService: LangChainService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 模块初始化：连接 Redis + 初始化 MCP Client
   *
   * MCP Client 的生命周期管理是关键：
   * - OnModuleInit 时创建连接（连接 MCP Server 子进程）
   * - OnModuleDestroy 时关闭连接（清理子进程资源）
   */
  async onModuleInit() {
    // ---- 1. 连接 Redis（和 Phase 5 一样） ----
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    try {
      this.checkpointer = await RedisSaver.fromUrl(redisUrl);
      this.logger.log(`Redis checkpointer connected: ${redisUrl}`);
    } catch (error) {
      this.logger.warn(
        `Redis 连接失败 (${redisUrl})，MCP Agent 状态持久化将不可用: ${error.message}`,
      );
    }

    // ---- 2. 初始化 MCP Client ----
    // 计算 MCP Server 脚本的路径
    // 在编译后的代码中，tools-server.js 会在 dist/mcp/mcp-server/ 目录下
    const serverScriptPath = path.resolve(__dirname, 'mcp-server', 'tools-server.js');

    try {
      /**
       * MultiServerMCPClient 配置说明：
       *
       * mcpServers: 定义要连接的 MCP Server 列表
       * - key（如 'tools'）是 Server 的别名，用于日志和错误报告
       * - transport: 'stdio' 表示通过子进程通信
       * - command: 启动 Server 的命令（node）
       * - args: 传给命令的参数（Server 脚本路径）
       *
       * 类比：这就像在配置文件里声明"我要连接哪些插座"
       * 而不是在代码里硬接电线
       */
      this.mcpClient = new MultiServerMCPClient({
        mcpServers: {
          // 'tools' 是给这个 MCP Server 起的别名
          tools: {
            transport: 'stdio',                // stdio 传输：本地子进程通信
            command: 'node',                   // 用 node 启动 Server
            args: [serverScriptPath],          // Server 脚本路径
          },
        },
      });

      this.logger.log(`MCP Client initialized, server script: ${serverScriptPath}`);
    } catch (error) {
      this.logger.error(`MCP Client 初始化失败: ${error.message}`);
    }
  }

  /**
   * 模块销毁时清理资源
   *
   * 重要：MCP Client 管理着子进程，必须正确关闭
   * 否则会导致 zombie 进程
   */
  async onModuleDestroy() {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close();
        this.logger.log('MCP Client connections closed');
      } catch (error) {
        this.logger.warn(`MCP Client close failed: ${error.message}`);
      }
    }

    if (this.checkpointer) {
      await this.checkpointer.end();
      this.logger.log('Redis checkpointer disconnected');
    }
  }

  // ==================== MCP Agent 聊天 ====================

  /**
   * 使用 MCP 工具的 Agent 聊天
   *
   * 核心流程：
   * 1. 通过 MCP Client 动态获取工具（getTools）
   * 2. 将 MCP 工具注入 createReactAgent（和 Phase 3 一模一样！）
   * 3. 流式执行 Agent
   *
   * 这就是 MCP 最大的价值：
   * - Agent 代码完全不知道有哪些工具
   * - 工具列表由 MCP Server 决定
   * - 加新工具只需在 Server 里注册，不用改 Agent 代码
   *
   * @param message 用户消息
   * @param threadId 可选的对话线程 ID
   * @yields McpAgentEvent SSE 事件流
   */
  async *chat(
    message: string,
    threadId?: string,
    model?: string,
  ): AsyncGenerator<McpAgentEvent> {
    if (!this.mcpClient) {
      yield { type: 'error', error: 'MCP Client 未初始化' };
      yield { type: 'done' };
      return;
    }

    try {
      // ---- 1. 动态发现工具 ----
      /**
       * getTools() 是 MCP 的核心！
       *
       * 它做了以下事情：
       * 1. 通过 MCP 协议向 Server 发送 tools/list 请求
       * 2. Server 返回所有已注册工具的元信息（name、description、inputSchema）
       * 3. 将 MCP 工具格式转换为 LangChain Tool 格式
       *
       * 返回的是标准的 LangChain StructuredTool[]，
       * 可以直接传给 createReactAgent 的 tools 参数
       */
      const mcpTools = await this.mcpClient.getTools();

      // 通知前端：发现了哪些工具
      const toolNames = mcpTools.map((t) => t.name);
      this.logger.log(`MCP 动态发现 ${mcpTools.length} 个工具: ${toolNames.join(', ')}`);

      yield {
        type: 'tools_discovered',
        tools: toolNames,
        serverName: 'tools',
      };

      // ---- 2. 创建 Agent（注入 MCP 工具）----
      /**
       * 关键对比！
       *
       * Phase 3（硬编码）：
       * ```typescript
       * import { weatherTool, timeTool, searchTool } from '../langchain/tools';
       * const agent = createReactAgent({ tools: [weatherTool, timeTool, searchTool] });
       * ```
       *
       * Phase 6（MCP 动态注入）：
       * ```typescript
       * const mcpTools = await mcpClient.getTools(); // 动态获取！
       * const agent = createReactAgent({ tools: mcpTools });
       * ```
       *
       * 注意：createReactAgent 的用法完全不变！
       * MCP 只改变了"工具从哪来"，不改变"Agent 怎么用工具"
       */
      const llm = this.langchainService.getModel(model);
      const agent = createReactAgent({
        llm,
        tools: mcpTools,  // MCP 动态获取的工具，不再 import 硬编码的工具！
        ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
      });

      const config = {
        configurable: {
          thread_id: threadId || `mcp-${Date.now()}`,
        },
        recursionLimit: 20,
      };

      this.logger.log(`MCP Agent started, thread: ${config.configurable.thread_id}`);

      // ---- 3. 流式执行（复用 Phase 5 的 streamMultiAgent）----
      yield* streamMultiAgent(
        agent,
        { messages: [new HumanMessage(message)] },
        config,
      ) as AsyncGenerator<McpAgentEvent>;

      yield { type: 'done' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP Agent error: ${errorMessage}`);
      yield { type: 'error', error: errorMessage };
      yield { type: 'done' };
    }
  }

  // ==================== 工具发现 API ====================

  /**
   * 列出 MCP Server 提供的所有工具
   *
   * 这个方法展示了 MCP 的"动态发现"能力：
   * - 不需要知道 Server 注册了哪些工具
   * - 运行时向 Server 查询即可
   * - 如果 Server 新增了工具，下次查询就能发现
   */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    if (!this.mcpClient) {
      throw new Error('MCP Client 未初始化');
    }

    const tools = await this.mcpClient.getTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description || '',
    }));
  }
}
