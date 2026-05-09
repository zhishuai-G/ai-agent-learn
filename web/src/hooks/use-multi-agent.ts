import { useState, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ChatMessage, SetMessages, MultiAgentSubMode, AgentFlowState } from '../types/chat'
import { API_BASE, updateLastAssistant } from '../types/chat'
import { readSSE } from '../utils/sse'

// LangGraph 内部路由节点，不需要创建消息
const INTERNAL_AGENT_NODES = new Set(['__start__', '__end__', 'tools', 'supervisor'])

// 将 LangGraph 节点名映射为展示用的 Agent 名称（用于消息创建）
function mapAgentName(name: string, subMode: MultiAgentSubMode): string | null {
  if (INTERNAL_AGENT_NODES.has(name)) return null
  // Supervisor 模式下，agent 节点是 Supervisor 的 LLM 运行节点
  if (name === 'agent') return subMode === 'supervisor' ? 'supervisor' : null
  return name
}

// 将 handoff 事件中的节点名映射为展示名称（保留 supervisor 用于交接展示）
function mapHandoffAgent(name: string, subMode: MultiAgentSubMode): string | null {
  if (['__start__', '__end__', 'tools'].includes(name)) return null
  if (name === 'agent') return subMode === 'supervisor' ? 'supervisor' : null
  return name
}

// 确保当前 Agent 的消息存在，然后更新它
function ensureAgentMessage(
  agentName: string,
  setMessages: SetMessages,
  updater: (last: ChatMessage) => Partial<ChatMessage>,
) {
  setMessages(prev => {
    const last = prev[prev.length - 1]
    // 如果最后一条消息就是该 Agent 的，直接更新
    if (last?.role === 'assistant' && last.agentName === agentName) {
      return updateLastAssistant(prev, updater)
    }
    // 否则先创建新消息再更新
    const withNew = [...prev, {
      role: 'assistant' as const,
      content: '',
      agentName,
      toolCalls: [],
      isThinking: true,
    }]
    return updateLastAssistant(withNew, updater)
  })
}

// 处理 Multi-Agent SSE 事件
function handleMultiAgentEvent(
  parsed: Record<string, unknown>,
  setMessages: SetMessages,
  setAgentFlow: Dispatch<SetStateAction<AgentFlowState | null>>,
  currentAgentRef: React.MutableRefObject<string | null>,
  subMode: MultiAgentSubMode,
) {
  const type = parsed.type as string

  if (type === 'agent_start') {
    const mapped = mapAgentName(parsed.agent as string, subMode)
    currentAgentRef.current = mapped
    if (mapped) {
      setAgentFlow(prev => prev ? {
        ...prev,
        agents: prev.agents.map(a =>
          a.name === mapped ? { ...a, status: 'active' as const } : a,
        ),
      } : null)
    }
  } else if (type === 'content') {
    const agent = currentAgentRef.current
    if (!agent) return
    ensureAgentMessage(agent, setMessages, last => ({
      content: (last.content || '') + (parsed.content as string),
      ...(last.isThinking ? { isThinking: false } : {}),
    }))
  } else if (type === 'reasoning') {
    const agent = currentAgentRef.current
    if (!agent) return
    ensureAgentMessage(agent, setMessages, last => ({
      thinkContent: (last.thinkContent || '') + (parsed.content as string),
    }))
  } else if (type === 'tool_call') {
    const agent = currentAgentRef.current
    if (!agent) return
    const toolName = parsed.name as string
    // 跳过 Swarm 内部的 transfer_to_* 工具
    if (toolName.startsWith('transfer_to_')) return
    ensureAgentMessage(agent, setMessages, last => ({
      toolCalls: [...(last.toolCalls || []), {
        name: toolName,
        args: parsed.args as Record<string, unknown>,
        status: 'calling' as const,
      }],
    }))
  } else if (type === 'tool_result') {
    const toolName = parsed.name as string
    if (toolName.startsWith('transfer_to_')) return
    setMessages(prev => updateLastAssistant(prev, last => {
      if (!last.toolCalls) return {}
      const toolCalls = last.toolCalls.map(t =>
        t.name === toolName && t.status === 'calling'
          ? { ...t, result: parsed.result as string, status: 'done' as const }
          : t,
      )
      return { toolCalls }
    }))
  } else if (type === 'agent_end') {
    const mapped = mapAgentName(parsed.agent as string, subMode)
    if (mapped) {
      // 结束该 Agent 的 thinking 状态
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && last.agentName === mapped && last.isThinking) {
          return updateLastAssistant(prev, () => ({ isThinking: false }))
        }
        return prev
      })
      setAgentFlow(prev => prev ? {
        ...prev,
        agents: prev.agents.map(a =>
          a.name === mapped ? { ...a, status: 'done' as const } : a,
        ),
      } : null)
    }
  } else if (type === 'handoff') {
    const fromMapped = mapHandoffAgent(parsed.from as string, subMode)
    const toMapped = mapHandoffAgent(parsed.to as string, subMode)
    if (fromMapped && toMapped && fromMapped !== toMapped) {
      setAgentFlow(prev => prev ? {
        ...prev,
        handoffs: [...prev.handoffs, { from: fromMapped, to: toMapped }],
      } : null)
    }
  } else if (type === 'error') {
    const agent = currentAgentRef.current
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant' && last.agentName === agent) {
        return updateLastAssistant(prev, () => ({
          content: `Error: ${parsed.error}`,
          isThinking: false,
        }))
      }
      return [...prev, { role: 'assistant' as const, content: `Error: ${parsed.error}` }]
    })
  } else if (type === 'done') {
    setMessages(prev => updateLastAssistant(prev, last =>
      last.isThinking ? { isThinking: false } : {},
    ))
  }
}

export function useMultiAgent(
  _messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
) {
  const [agentFlow, setAgentFlow] = useState<AgentFlowState | null>(null)
  const currentAgentRef = useRef<string | null>(null)

  const handleChat = async (userMessage: string, subMode: MultiAgentSubMode, threadId?: string, model?: string) => {
    setLoading(true)
    currentAgentRef.current = null

    const initialAgents = subMode === 'supervisor'
      ? ['supervisor', 'pm', 'architect', 'developer', 'reviewer']
      : ['sales', 'tech_support']

    setAgentFlow({
      agents: initialAgents.map(name => ({ name, status: 'pending' as const })),
      handoffs: [],
    })

    const endpoint = subMode === 'supervisor'
      ? '/multi-agent/supervisor'
      : '/multi-agent/swarm'

    const body = subMode === 'supervisor'
      ? { requirement: userMessage, threadId, ...(model ? { model } : {}) }
      : { message: userMessage, threadId, ...(model ? { model } : {}) }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      await readSSE(res, parsed => {
        handleMultiAgentEvent(parsed, setMessages, setAgentFlow, currentAgentRef, subMode)
      })
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err}`,
      }])
    } finally {
      setLoading(false)
      // 确保所有 active 状态的 agent 标记为 done
      setAgentFlow(prev => prev ? {
        ...prev,
        agents: prev.agents.map(a =>
          a.status === 'active' ? { ...a, status: 'done' as const } : a,
        ),
      } : null)
    }
  }

  const resetFlow = () => {
    setAgentFlow(null)
    currentAgentRef.current = null
  }

  return { handleChat, agentFlow, resetFlow }
}
