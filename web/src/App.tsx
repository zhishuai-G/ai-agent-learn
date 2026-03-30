import { useState, useRef, useEffect } from 'react'
import './App.css'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const API_BASE = 'http://localhost:3500'

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 普通聊天
  const handleChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages,
          systemPrompt,
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.data?.reply || data.reply || '(empty response)' }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }])
    } finally {
      setLoading(false)
    }
  }

  // 流式聊天
  const handleStreamChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    // 先插入一条空的 assistant 消息，后面逐步追加
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages,
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

        // 解析 SSE 数据：每条 data: {...}\n\n
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
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant') {
                    last.content += parsed.content
                  }
                  return updated
                })
              }
            } catch {
              // 不完整的 JSON，保留在 buffer 中
              buffer += line + '\n'
            }
          } else {
            // 非 data 行，可能是不完整数据
            if (trimmed) buffer += line + '\n'
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant' && !last.content) {
          last.content = `Error: ${err}`
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleStreamChat()
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  return (
    <div className="chat-app">
      {/* Header */}
      <header className="chat-header">
        <h1>AI Chat - Phase 1</h1>
        <div className="header-actions">
          <button className="btn-icon" onClick={() => setShowSettings(!showSettings)} title="Settings">
            {showSettings ? '✕' : '⚙'}
          </button>
          <button className="btn-icon" onClick={clearChat} title="Clear chat">🗑</button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-panel">
          <label>System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="设定 AI 的角色和行为..."
          />
        </div>
      )}

      {/* Messages */}
      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>👋 发送一条消息开始聊天</p>
                   <p className="hint">按 Enter 发送（流式），或点击按钮选择模式</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-bubble">
                {msg.content || (loading && i === messages.length - 1 ? '▍' : '')}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="chat-input">
        <div className="input-wrapper">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送)"
            rows={1}
            disabled={loading}
          />
          <div className="input-actions">
            <button
              className="btn-send"
              onClick={handleStreamChat}
              disabled={!input.trim() || loading}
              title="流式发送 (Stream)"
            >
              {loading ? '⏳' : '▶'}
            </button>
            <button
              className="btn-send btn-normal"
              onClick={handleChat}
              disabled={!input.trim() || loading}
              title="普通发送"
            >
              {loading ? '⏳' : '↵'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
