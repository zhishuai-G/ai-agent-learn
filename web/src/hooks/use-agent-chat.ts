import type { ChatMessage, SetMessages } from '../types/chat'
import { API_BASE, updateLastAssistant } from '../types/chat'

export function useAgentChat(
  messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
) {
  return async (userMessage: string, systemPrompt: string) => {
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '', toolCalls: [], isThinking: true }])
    const thinkStartTime = Date.now()

    try {
      const res = await fetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt,
        }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No reader available')

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data:')) {
            try {
              const jsonStr = trimmed.slice(5).trim()
              const parsed = JSON.parse(jsonStr)

              if (parsed.type === 'tool_call') {
                setMessages(prev => updateLastAssistant(prev, last => ({
                  toolCalls: [...(last.toolCalls || []), {
                    name: parsed.name,
                    args: parsed.args,
                    status: 'calling' as const,
                  }],
                })))
              } else if (parsed.type === 'tool_result') {
                setMessages(prev => updateLastAssistant(prev, last => {
                  if (!last.toolCalls) return {}
                  const toolCalls = last.toolCalls.map(t =>
                    t.name === parsed.name && t.status === 'calling'
                      ? { ...t, result: parsed.result, status: 'done' as const }
                      : t,
                  )
                  return { toolCalls }
                }))
              } else if (parsed.type === 'content') {
                setMessages(prev => updateLastAssistant(prev, last => ({
                  content: (last.content || '') + parsed.content,
                  ...(last.isThinking ? {
                    isThinking: false,
                    thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
                  } : {}),
                })))
              } else if (parsed.type === 'error') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  content: `Error: ${parsed.error}`,
                })))
              }
            } catch {
              buffer += line + '\n'
            }
          } else {
            if (trimmed) buffer += line + '\n'
          }
        }
      }
    } catch (err) {
      setMessages(prev => updateLastAssistant(prev, last =>
        !last.content ? { content: `Error: ${err}` } : {},
      ))
    } finally {
      setLoading(false)
      setMessages(prev => updateLastAssistant(prev, last =>
        last.isThinking ? {
          isThinking: false,
          thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
        } : {},
      ))
    }
  }
}
