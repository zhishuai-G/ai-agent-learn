import { useState, useCallback } from 'react'
import type { ChatMessage, SetMessages, CustomAgentConfig } from '../types/chat'
import { API_BASE, updateLastAssistant } from '../types/chat'
import { readSSE } from '../utils/sse'

export function useCustomAgent(
  messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
) {
  const [agents, setAgents] = useState<CustomAgentConfig[]>([])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-agent`)
      const data = await res.json()
      setAgents(data)
    } catch {
      // ignore
    }
  }, [])

  const createAgent = useCallback(async (name: string, systemPrompt: string, tools: string[], model?: string) => {
    const res = await fetch(`${API_BASE}/custom-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, systemPrompt, tools, model }),
    })
    const agent = await res.json()
    setAgents(prev => [agent, ...prev])
    return agent as CustomAgentConfig
  }, [])

  const deleteAgent = useCallback(async (id: string) => {
    await fetch(`${API_BASE}/custom-agent/${id}`, { method: 'DELETE' })
    setAgents(prev => prev.filter(a => a.id !== id))
  }, [])

  const chat = useCallback(async (agentId: string, userMessage: string, threadId?: string) => {
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '', toolCalls: [], isThinking: true }])
    const thinkStartTime = Date.now()

    try {
      const res = await fetch(`${API_BASE}/custom-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message: userMessage, threadId }),
      })

      await readSSE(res, parsed => {
        if (parsed.type === 'agent_start') {
          setMessages(prev => updateLastAssistant(prev, () => ({ isThinking: true })))
        } else if (parsed.type === 'content') {
          setMessages(prev => updateLastAssistant(prev, last => ({
            content: (last.content || '') + (parsed.content as string),
            ...(last.isThinking ? { isThinking: false, thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000) } : {}),
          })))
        } else if (parsed.type === 'tool_call') {
          setMessages(prev => updateLastAssistant(prev, last => ({
            toolCalls: [...(last.toolCalls || []), {
              name: parsed.name as string,
              args: parsed.args as Record<string, unknown>,
              status: 'calling' as const,
            }],
          })))
        } else if (parsed.type === 'tool_result') {
          setMessages(prev => updateLastAssistant(prev, last => {
            if (!last.toolCalls) return {}
            const toolCalls = last.toolCalls.map(t =>
              t.name === parsed.name && t.status === 'calling'
                ? { ...t, result: parsed.result as string, status: 'done' as const }
                : t,
            )
            return { toolCalls }
          }))
        } else if (parsed.type === 'error') {
          setMessages(prev => updateLastAssistant(prev, () => ({
            content: `Error: ${parsed.error || parsed.content}`,
            isThinking: false,
          })))
        } else if (parsed.type === 'done') {
          setMessages(prev => updateLastAssistant(prev, last =>
            last.isThinking ? { isThinking: false, thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000) } : {},
          ))
        }
      })
    } catch (err) {
      setMessages(prev => updateLastAssistant(prev, () => ({
        content: `Error: ${err}`,
        isThinking: false,
      })))
    } finally {
      setLoading(false)
    }
  }, [])

  return { agents, fetchAgents, createAgent, deleteAgent, chat }
}
