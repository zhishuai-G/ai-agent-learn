import type { ChatMessage, SetMessages, LangGraphSubMode } from '../types/chat'
import { API_BASE, updateLastAssistant } from '../types/chat'
import { readSSE } from '../utils/sse'

interface LangGraphChatOptions {
  lgSubMode: LangGraphSubMode
  threadId: string
  systemPrompt: string
  model?: string
}

// 处理 LangGraph SSE 事件（chat 和 resume 共用）
function handleLangGraphEvent(
  parsed: Record<string, unknown>,
  setMessages: SetMessages,
  thinkStartTime: number,
  callbacks?: {
    onInterrupt?: () => void
  },
) {
  if (parsed.type === 'node') {
    setMessages(prev => updateLastAssistant(prev, () => ({
      activeNode: parsed.node as string,
    })))
  } else if (parsed.type === 'reasoning') {
    setMessages(prev => updateLastAssistant(prev, last => ({
      thinkContent: (last.thinkContent || '') + (parsed.content as string),
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
        t.status === 'calling'
          ? { ...t, result: parsed.result as string, status: 'done' as const }
          : t,
      )
      return { toolCalls }
    }))
  } else if (parsed.type === 'content') {
    setMessages(prev => updateLastAssistant(prev, last => ({
      content: (last.content || '') + (parsed.content as string),
      activeNode: undefined,
      ...(last.isThinking ? {
        isThinking: false,
        thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
      } : {}),
    })))
  } else if (parsed.type === 'interrupt') {
    setMessages(prev => updateLastAssistant(prev, () => ({
      interrupted: true,
      interruptContent: parsed.content as string,
      activeNode: undefined,
    })))
    callbacks?.onInterrupt?.()
  } else if (parsed.type === 'error') {
    setMessages(prev => updateLastAssistant(prev, () => ({
      content: `Error: ${parsed.error}`,
    })))
  } else if (parsed.type === 'done') {
    setMessages(prev => updateLastAssistant(prev, () => ({
      activeNode: undefined,
    })))
  }
}

export function useLangGraphChat(
  messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
  setPendingResume: (v: string | null) => void,
) {
  const handleChat = async (userMessage: string, options: LangGraphChatOptions) => {
    setLoading(true)
    setPendingResume(null)

    setMessages(prev => [...prev, {
      role: 'assistant' as const,
      content: '',
      toolCalls: [],
      activeNode: undefined,
      interrupted: false,
      isThinking: true,
    }])
    const thinkStartTime = Date.now()

    const endpoint = options.lgSubMode === 'chat'
      ? '/langgraph/chat'
      : options.lgSubMode === 'react'
        ? '/langgraph/react'
        : '/langgraph/hitl'

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          threadId: options.threadId,
          history: messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.thinkContent ? { thinkContent: m.thinkContent } : {}),
          })),
          systemPrompt: options.systemPrompt,
          ...(options.model ? { model: options.model } : {}),
        }),
      })

      await readSSE(res, parsed => {
        handleLangGraphEvent(parsed, setMessages, thinkStartTime, {
          onInterrupt: () => setPendingResume(options.threadId),
        })
      })
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

  const handleResume = async (pendingResume: string) => {
    setLoading(true)
    const thinkStartTime = Date.now()
    setMessages(prev => updateLastAssistant(prev, () => ({
      interrupted: false,
      interruptContent: undefined,
      activeNode: 'tools',
      isThinking: true,
    })))

    try {
      const res = await fetch(`${API_BASE}/langgraph/hitl/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: pendingResume }),
      })

      await readSSE(res, parsed => {
        // resume 的 interrupt 事件需要特殊处理（保持 pendingResume，直接停止读取）
        if (parsed.type === 'interrupt') {
          setMessages(prev => updateLastAssistant(prev, () => ({
            interrupted: true,
            interruptContent: parsed.content as string,
            activeNode: undefined,
            isThinking: false,
          })))
          return 'stop'
        }
        // content 事件的 thinkDuration 累加
        if (parsed.type === 'content') {
          setMessages(prev => updateLastAssistant(prev, last => ({
            content: (last.content || '') + (parsed.content as string),
            activeNode: undefined,
            ...(last.isThinking ? {
              isThinking: false,
              thinkDuration: (last.thinkDuration || 0) + Math.round((Date.now() - thinkStartTime) / 1000),
            } : {}),
          })))
          return
        }
        handleLangGraphEvent(parsed, setMessages, thinkStartTime)
      })
    } catch (err) {
      setMessages(prev => updateLastAssistant(prev, last =>
        !last.content ? { content: `Error: ${err}` } : {},
      ))
    } finally {
      setLoading(false)
      setPendingResume(null)
      setMessages(prev => updateLastAssistant(prev, last =>
        last.isThinking ? {
          isThinking: false,
          thinkDuration: (last.thinkDuration || 0) + Math.round((Date.now() - thinkStartTime) / 1000),
        } : {},
      ))
    }
  }

  return { handleChat, handleResume }
}
