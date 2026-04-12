import { useState, useRef, useEffect } from 'react'
import './App.css'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  thinkContent?: string
  isThinking?: boolean
  thinkDuration?: number  // 思考耗时（秒）
}

// 从原始文本中分离 <think>...</think> 内容
function parseThinkContent(raw: string): { thinkContent: string; content: string; isThinking: boolean } {
  const thinkStart = raw.indexOf('<think>')
  if (thinkStart === -1) {
    return { thinkContent: '', content: raw, isThinking: false }
  }

  const thinkEnd = raw.indexOf('</think>')
  if (thinkEnd === -1) {
    // <think> 存在但 </think> 还没到，正在思考中
    return {
      thinkContent: raw.slice(thinkStart + 7),
      content: '',
      isThinking: true,
    }
  }

  // 思考结束，分离内容
  return {
    thinkContent: raw.slice(thinkStart + 7, thinkEnd),
    content: raw.slice(thinkEnd + 8).trim(),
    isThinking: false,
  }
}

const API_BASE = 'http://localhost:3500'

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 流式聊天
  const handleStreamChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    // 先插入一条空的 assistant 消息，后面逐步追加
    setMessages(prev => [...prev, { role: 'assistant', content: '', thinkContent: '', isThinking: false }])

    // rawContent 累积所有原始文本（包含 <think> 标签），用于每次重新解析
    let rawContent = ''
    // 记录思考开始时间，用于计算思考耗时
    let thinkStartTime: number | null = null

    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: messages,
          systemPrompt,
          deepThink,
        }),
      })

      // 从 Response.body 获取 ReadableStream 的 reader，用于逐块读取流式数据
      const reader = res.body?.getReader()
      // TextDecoder 将二进制 Uint8Array 解码为 UTF-8 字符串
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader available')

      // buffer 用于缓存跨 chunk 的不完整数据（网络传输中一条 SSE 消息可能被拆分到多个 chunk）
      let buffer = ''

      // 无限循环，持续读取流数据直到服务端关闭连接
      while (true) {
        // reader.read() 返回 { done, value }
        // done=true 表示流结束，value 是本次读取到的 Uint8Array 数据块
        const { done, value } = await reader.read()
        if (done) break

        // 将二进制数据解码为字符串，stream: true 表示后续还有数据，避免截断多字节字符
        buffer += decoder.decode(value, { stream: true })

        // SSE 协议格式：每条消息以 "data: {JSON}\n\n" 形式发送
        // 按换行符拆分，逐行解析
        console.log('buffer:', buffer);
        const lines = buffer.split('\n')
        console.log('lines:', lines);
        // 清空 buffer，未成功解析的行会重新放回 buffer
        buffer = ''

        for (const line of lines) {
          const trimmed = line.trim()
          // 判断是否是 SSE 数据行（以 "data:" 开头）
          if (trimmed.startsWith('data:')) {
            try {
              // 去掉 "data:" 前缀，提取 JSON 字符串
              const jsonStr = trimmed.slice(5).trim()
              const parsed = JSON.parse(jsonStr)
              // 服务端发送 { done: true } 表示流结束，跳过
              if (parsed.done) continue
              // 有实际内容时，累积原始文本并重新解析 think 标签
              if (parsed.content) {
                rawContent += parsed.content
                const { thinkContent, content, isThinking } = parseThinkContent(rawContent)

                // 记录思考开始时间
                if (isThinking && !thinkStartTime) {
                  thinkStartTime = Date.now()
                }

                // 计算思考耗时
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
              // JSON.parse 失败说明这行数据不完整（被拆到了下一个 chunk），放回 buffer 等下次拼接
              buffer += line + '\n'
            }
          } else {
            // 非 "data:" 开头的非空行，可能是被截断的不完整数据，也放回 buffer
            if (trimmed) buffer += line + '\n'
          }
        }
      }
    } catch (err) {
      // 流式请求出错时，将错误信息写入最后一条空的 assistant 消息
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.role === 'assistant' && !last.content) {
          last.content = `Error: ${err}`
        }
        return updated
      })
    } finally {
      // 无论成功还是失败，都关闭 loading 状态
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
            <p className="hint">按 Enter 发送，开启「深度思考」获得更详细的推理</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-bubble">
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
                {msg.content || (loading && i === messages.length - 1 ? '▍' : '')}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input - DeepSeek 风格 */}
      <footer className="chat-input">
        <div className="input-card">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="给 AI 发送消息"
            rows={1}
            disabled={loading}
          />
          <div className="input-bottom">
            <div className="input-tools">
              <button
                className={`btn-tool ${deepThink ? 'active' : ''}`}
                onClick={() => setDeepThink(!deepThink)}
                title="深度思考"
              >
                💭 深度思考
              </button>
            </div>
            <button
              className="btn-send-round"
              onClick={handleStreamChat}
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
