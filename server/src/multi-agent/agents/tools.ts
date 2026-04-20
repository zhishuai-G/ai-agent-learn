/**
 * Phase 5: Multi-Agent 系统 — Agent 专用工具
 *
 * 这些工具是"语义标记"工具 —— 真正的分析/代码生成由 LLM 在响应中完成，
 * 工具的作用是在 SSE 事件流中创建可视化的结构化事件。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** PM Agent 工具：需求分析与任务拆分 */
export const analyzeRequirementTool = tool(
  async ({ requirement }: { requirement: string }) => {
    return `需求分析完成。已将需求「${requirement}」拆分为子任务并生成任务列表。`;
  },
  {
    name: 'analyze_requirement',
    description: '分析用户需求，将其拆分为具体的开发子任务，输出结构化的任务列表',
    schema: z.object({
      requirement: z.string().describe('用户的原始需求描述'),
    }),
  },
);

/** Architect Agent 工具：技术方案设计 */
export const designArchitectureTool = tool(
  async ({ tasks, techStack }: { tasks: string; techStack?: string }) => {
    return `技术方案设计完成。已根据任务列表确定架构模式和技术栈选型。`;
  },
  {
    name: 'design_architecture',
    description: '根据任务列表设计技术架构方案，包括技术栈选型、模块划分、接口设计',
    schema: z.object({
      tasks: z.string().describe('需要设计方案的任务列表'),
      techStack: z.string().optional().describe('指定的技术栈偏好'),
    }),
  },
);

/** Developer Agent 工具：代码编写 */
export const writeCodeTool = tool(
  async ({ task, architecture }: { task: string; architecture: string }) => {
    return `代码编写完成。已按照技术方案实现功能代码。`;
  },
  {
    name: 'write_code',
    description: '根据技术方案和任务要求编写实现代码',
    schema: z.object({
      task: z.string().describe('具体的编码任务'),
      architecture: z.string().describe('技术方案/架构说明'),
    }),
  },
);

/** Reviewer Agent 工具：代码审查 */
export const reviewCodeTool = tool(
  async ({ code, standards }: { code: string; standards?: string }) => {
    return `代码审查完成。已检查代码质量、规范性和潜在问题。`;
  },
  {
    name: 'review_code',
    description: '审查代码质量，检查是否符合最佳实践，提出改进建议',
    schema: z.object({
      code: z.string().describe('需要审查的代码或代码摘要'),
      standards: z.string().optional().describe('代码审查标准'),
    }),
  },
);
