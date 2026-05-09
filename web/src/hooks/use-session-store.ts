import { useState, useCallback, useEffect } from 'react'
import type { Session, ChatMessage, ChatMode } from '../types/chat'

const STORAGE_KEY = 'ai-chat-sessions'

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

export function useSessionStore() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const saved = loadSessions()
    return saved.length > 0 ? saved[0].id : null
  })

  // 同步到 localStorage
  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  const activeSession = sessions.find(s => s.id === activeSessionId) || null

  const createSession = useCallback((
    mode: ChatMode = 'langgraph',
    model: string = 'deepseek-v4-flash',
  ): Session => {
    const id = `session-${Date.now()}`
    const session: Session = {
      id,
      title: '新对话',
      messages: [],
      mode,
      lgSubMode: 'react',
      multiAgentSubMode: 'supervisor',
      model,
      threadId: `thread-${Date.now()}`,
      systemPrompt: '你是一位友好的 AI 助手，擅长用简洁的语言回答问题。',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setSessions(prev => [session, ...prev])
    setActiveSessionId(id)
    return session
  }, [])

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      // 如果删除的是当前会话，切换到第一个
      if (id === activeSessionId) {
        setActiveSessionId(next.length > 0 ? next[0].id : null)
      }
      return next
    })
  }, [activeSessionId])

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const updateSession = useCallback((id: string, updates: Partial<Session>) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s,
    ))
  }, [])

  // 自动从第一条用户消息生成标题
  const autoTitle = useCallback((id: string, messages: ChatMessage[]) => {
    const firstUser = messages.find(m => m.role === 'user')
    if (!firstUser) return
    const title = firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '')
    setSessions(prev => prev.map(s =>
      s.id === id && s.title === '新对话' ? { ...s, title, updatedAt: Date.now() } : s,
    ))
  }, [])

  return {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    deleteSession,
    switchSession,
    updateSession,
    autoTitle,
  }
}
