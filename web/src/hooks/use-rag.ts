import { useState, useEffect } from 'react'
import type { ChatMessage, SetMessages, RagSource } from '../types/chat'
import { API_BASE, updateLastAssistant } from '../types/chat'

export function useRag(
  messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
  isActive: boolean,
) {
  const [ragDocCount, setRagDocCount] = useState(0)
  const [ragDocInput, setRagDocInput] = useState('')
  const [ragUrlInput, setRagUrlInput] = useState('')
  const [ragUploading, setRagUploading] = useState(false)
  const [showRagPanel, setShowRagPanel] = useState(false)

  const fetchRagStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/rag/status`)
      const data = await res.json()
      setRagDocCount(data.documentCount ?? 0)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (isActive) fetchRagStatus()
  }, [isActive])

  const handleAddDocument = async () => {
    if (!ragDocInput.trim() || ragUploading) return
    setRagUploading(true)
    try {
      const res = await fetch(`${API_BASE}/rag/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: ragDocInput.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setRagDocInput('')
        fetchRagStatus()
      }
    } catch { /* ignore */ } finally {
      setRagUploading(false)
    }
  }

  const handleAddWebDocument = async () => {
    if (!ragUrlInput.trim() || ragUploading) return
    setRagUploading(true)
    try {
      const res = await fetch(`${API_BASE}/rag/documents/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ragUrlInput.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setRagUrlInput('')
        fetchRagStatus()
      }
    } catch { /* ignore */ } finally {
      setRagUploading(false)
    }
  }

  const handleClearKnowledgeBase = async () => {
    try {
      await fetch(`${API_BASE}/rag/documents`, { method: 'DELETE' })
      fetchRagStatus()
    } catch { /* ignore */ }
  }

  const handleRagChat = async (userMessage: string) => {
    setLoading(true)
    setMessages(prev => [...prev, {
      role: 'assistant' as const,
      content: '',
      isThinking: true,
      ragSources: [],
    }])
    const thinkStartTime = Date.now()

    try {
      const res = await fetch(`${API_BASE}/rag/query/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage }),
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

              if (parsed.type === 'source') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  ragSources: parsed.data as RagSource[],
                })))
              } else if (parsed.type === 'token') {
                setMessages(prev => updateLastAssistant(prev, last => ({
                  content: (last.content || '') + parsed.data,
                  ...(last.isThinking ? {
                    isThinking: false,
                    thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
                  } : {}),
                })))
              } else if (parsed.type === 'error') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  content: `Error: ${parsed.data}`,
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

  return {
    ragDocCount, ragDocInput, setRagDocInput,
    ragUrlInput, setRagUrlInput,
    ragUploading, showRagPanel, setShowRagPanel,
    handleAddDocument, handleAddWebDocument,
    handleClearKnowledgeBase, handleRagChat,
  }
}
