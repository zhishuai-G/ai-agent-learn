import type { ChatMessage, SetMessages } from '../types/chat'
import { API_BASE, updateLastAssistant, parseThinkContent } from '../types/chat'

export function useStreamChat(
  messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
) {
  return async (userMessage: string, systemPrompt: string, deepThink: boolean) => {
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '', thinkContent: '', isThinking: false }])

    let rawContent = ''
    let thinkStartTime: number | null = null

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt,
          deepThink,
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
              if (parsed.done) continue
              if (parsed.content) {
                rawContent += parsed.content
                const { thinkContent, content, isThinking } = parseThinkContent(rawContent)

                if (isThinking && !thinkStartTime) {
                  thinkStartTime = Date.now()
                }

                let thinkDuration: number | undefined
                if (thinkStartTime && !isThinking && thinkContent) {
                  thinkDuration = Math.round((Date.now() - thinkStartTime) / 1000)
                }

                setMessages(prev => updateLastAssistant(prev, () => ({
                  content,
                  thinkContent,
                  isThinking,
                  ...(thinkDuration !== undefined ? { thinkDuration } : {}),
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
    }
  }
}
