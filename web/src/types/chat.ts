import type { Dispatch, SetStateAction } from 'react'

export interface AgentFlowAgent {
  name: string
  status: 'pending' | 'active' | 'done'
}

export interface AgentFlowState {
  agents: AgentFlowAgent[]
  handoffs: { from: string; to: string }[]
}

export const AGENT_DISPLAY_INFO: Record<string, { icon: string; label: string; color: string }> = {
  pm: { icon: '📋', label: 'PM', color: '#6366f1' },
  architect: { icon: '🏗️', label: 'Architect', color: '#8b5cf6' },
  developer: { icon: '💻', label: 'Developer', color: '#059669' },
  reviewer: { icon: '🔍', label: 'Reviewer', color: '#d97706' },
  sales: { icon: '💼', label: 'Sales', color: '#2563eb' },
  tech_support: { icon: '🛠️', label: 'Tech Support', color: '#7c3aed' },
  supervisor: { icon: '🎯', label: 'Supervisor', color: '#dc2626' },
}

export interface ToolCallInfo {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'calling' | 'done'
}

export interface RagSource {
  content: string
  score: number
  metadata: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  thinkContent?: string
  isThinking?: boolean
  thinkDuration?: number
  toolCalls?: ToolCallInfo[]
  // Phase 3: LangGraph
  activeNode?: string
  interrupted?: boolean
  interruptContent?: string
  // Phase 4: RAG
  ragSources?: RagSource[]
  // Phase 5: Multi-Agent
  agentName?: string
}

export type ChatMode = 'chat' | 'agent' | 'langgraph' | 'rag' | 'multi-agent' | 'mcp'
export type LangGraphSubMode = 'chat' | 'react' | 'hitl'
export type MultiAgentSubMode = 'supervisor' | 'swarm'
export type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>

// 开发环境通过 Vite proxy 代理到后端 (localhost:3000)
// 生产环境需要配置 nginx 或 CDN 反向代理
export const API_BASE = '/api'

export const TOOL_DISPLAY_NAME: Record<string, { icon: string; label: string }> = {
  get_weather: { icon: '🌤️', label: '天气查询' },
  get_current_time: { icon: '🕐', label: '时间查询' },
  web_search: { icon: '🔍', label: '百科搜索' },
  // Phase 5: Multi-Agent
  analyze_requirement: { icon: '📋', label: '需求分析' },
  design_architecture: { icon: '🏗️', label: '架构设计' },
  write_code: { icon: '💻', label: '编写代码' },
  review_code: { icon: '🔍', label: '代码审查' },
  search: { icon: '🔍', label: '信息搜索' },
}

export const NODE_DISPLAY_NAME: Record<string, { icon: string; label: string }> = {
  agent: { icon: '🧠', label: 'Agent 推理' },
  tools: { icon: '🔧', label: '工具执行' },
}

// 从原始文本中分离 <think>...</think> 内容
export function parseThinkContent(raw: string): { thinkContent: string; content: string; isThinking: boolean } {
  const thinkStart = raw.indexOf('<think>')
  if (thinkStart === -1) {
    return { thinkContent: '', content: raw, isThinking: false }
  }

  const thinkEnd = raw.indexOf('</think>')
  if (thinkEnd === -1) {
    return {
      thinkContent: raw.slice(thinkStart + 7),
      content: '',
      isThinking: true,
    }
  }

  return {
    thinkContent: raw.slice(thinkStart + 7, thinkEnd),
    content: raw.slice(thinkEnd + 8).trim(),
    isThinking: false,
  }
}

// 不可变更新：创建新对象替代直接 mutation，兼容 React 18 StrictMode
export function updateLastAssistant(
  prev: ChatMessage[],
  updater: (last: ChatMessage) => Partial<ChatMessage>,
): ChatMessage[] {
  const last = prev[prev.length - 1]
  if (!last || last.role !== 'assistant') return prev
  return [...prev.slice(0, -1), { ...last, ...updater(last) }]
}
