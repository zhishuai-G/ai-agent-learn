import type { Dispatch, SetStateAction } from 'react'

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
}

export type ChatMode = 'chat' | 'agent' | 'langgraph' | 'rag'
export type LangGraphSubMode = 'chat' | 'react' | 'hitl'
export type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>

export const API_BASE = 'http://localhost:3500'

export const TOOL_DISPLAY_NAME: Record<string, { icon: string; label: string }> = {
  get_weather: { icon: '🌤️', label: '天气查询' },
  get_current_time: { icon: '🕐', label: '时间查询' },
  web_search: { icon: '🔍', label: '百科搜索' },
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
