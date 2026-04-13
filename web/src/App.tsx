import { useState, useRef, useEffect } from 'react'
import './App.css'

interface ToolCallInfo {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'calling' | 'done'
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  thinkContent?: string
  isThinking?: boolean
  thinkDuration?: number
  toolCalls?: ToolCallInfo[]
}

// 从原始文本中分离 <think>...</think> 内容
function parseThinkContent(raw: string): { thinkContent: string; content: string; isThinking: boolean } {
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

type ChatMode = 'chat' | 'agent'

const API_BASE = 'http://localhost:3500'

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [mode, setMode] = useState<ChatMode>('agent')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Phase 1: 流式聊天
  const handleStreamChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
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

                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant') {
                    last.content = content
                    last.thinkContent = thinkContent
                    last.isThinking = isThinking
                    if (thinkDuration !== undefined) {
                      last.thinkDuration = thinkDuration
                    }
                  }
                  return updated
                })
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

  // Phase 2: Agent 聊天（带工具调用）
  const handleAgentChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    // 插入一条空的 assistant 消息，带 toolCalls 数组
    setMessages(prev => [...prev, { role: 'assistant', content: '', toolCalls: [] }])

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
                // 工具调用开始
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant') {
                    const toolCalls = [...(last.toolCalls || [])]
                    toolCalls.push({
                      name: parsed.name,
                      args: parsed.args,
                      status: 'calling',
                    })
                    last.toolCalls = toolCalls
                  }
                  return updated
                })
              } else if (parsed.type === 'tool_result') {
                // 工具返回结果
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant' && last.toolCalls) {
                    const toolCalls = [...last.toolCalls]
                    const tc = toolCalls.find(t => t.name === parsed.name && t.status === 'calling')
                    if (tc) {
                      tc.result = parsed.result
                      tc.status = 'done'
                    }
                    last.toolCalls = toolCalls
                  }
                  return updated
                })
              } else if (parsed.type === 'content') {
                // 最终文本内容
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant') {
                    last.content = parsed.content
                  }
                  return updated
                })
              } else if (parsed.type === 'error') {
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last && last.role === 'assistant') {
                    last.content = `Error: ${parsed.error}`
                  }
                  return updated
                })
              }
              // type === 'done' 不需要特殊处理
            } catch {
              buffer += line + '\n'
            }
          } else {
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

  const handleSend = () => {
    if (mode === 'agent') {
      handleAgentChat()
    } else {
      handleStreamChat()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  // 工具名称映射为友好的中文 + 图标
  const toolDisplayName: Record<string, { icon: string; label: string }> = {
    get_weather: { icon: '🌤️', label: '天气查询' },
    get_current_time: { icon: '🕐', label: '时间查询' },
    web_search: { icon: '🔍', label: '百科搜索' },
  }

  return (
    <div className="chat-app">
      {/* Header */}
      <header className="chat-header">
        <h1>AI Chat - {mode === 'agent' ? 'Phase 2 (Tool Use)' : 'Phase 1'}</h1>
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
            <p className="hint">
              {mode === 'agent'
                ? '智能助手模式：AI 可以调用工具查实时天气、查世界时间、搜索百科知识'
                : '按 Enter 发送，开启「深度思考」获得更详细的推理'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-bubble">
                {/* Think Block (Phase 1 深度思考) */}
                {msg.thinkContent && (
                  <details className="think-block" open={msg.isThinking}>
                    <summary>
                      {msg.isThinking ? (
                        <span className="think-status thinking">思考中...</span>
                      ) : (
                        <span className="think-status">
                          已思考{msg.thinkDuration ? `（用时 ${msg.thinkDuration} 秒）` : ''}
                        </span>
                      )}
                    </summary>
                    <div className="think-content">{msg.thinkContent}</div>
                  </details>
                )}

                {/* Tool Calls (Phase 2) */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="tool-calls-chain">
                    {msg.toolCalls.map((tc, j) => {
                      const display = toolDisplayName[tc.name] || { icon: '🔧', label: tc.name }
                      return (
                        <details key={j} className="tool-call-block" open>
                          <summary className="tool-call-header">
                            <span className="tool-call-icon">{display.icon}</span>
                            <span className="tool-call-name">{display.label}</span>
                            <span className={`tool-call-status ${tc.status}`}>
                              {tc.status === 'calling' ? '调用中...' : '已完成'}
                            </span>
                          </summary>
                          <div className="tool-call-body">
                            <div className="tool-call-args">
                              <span className="tool-call-label">参数</span>
                              <code>{JSON.stringify(tc.args, null, 2)}</code>
                            </div>
                            {tc.result && (
                              <div className="tool-call-result">
                                <span className="tool-call-label">结果</span>
                                <div className="tool-call-result-text">{tc.result}</div>
                              </div>
                            )}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                )}

                {/* Main Content */}
                {msg.content || (loading && i === messages.length - 1 ? '▍' : '')}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="chat-input">
        <div className="input-card">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'agent' ? '试试问：北京天气怎么样？/ 纽约现在几点？/ 什么是 LangChain？' : '给 AI 发送消息'}
            rows={1}
            disabled={loading}
          />
          <div className="input-bottom">
            <div className="input-tools">
              {/* 模式切换 */}
              <button
                className={`btn-tool ${mode === 'agent' ? 'active' : ''}`}
                onClick={() => setMode(mode === 'agent' ? 'chat' : 'agent')}
                title="切换模式"
              >
                {mode === 'agent' ? '🛠️ 智能助手' : '💬 普通聊天'}
              </button>
              {/* 深度思考（仅普通聊天模式） */}
              {mode === 'chat' && (
                <button
                  className={`btn-tool ${deepThink ? 'active' : ''}`}
                  onClick={() => setDeepThink(!deepThink)}
                  title="深度思考"
                >
                  💭 深度思考
                </button>
              )}
            </div>
            <button
              className="btn-send-round"
              onClick={handleSend}
              disabled={!input.trim() || loading}
            >
              {loading ? '⏳' : '↑'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
