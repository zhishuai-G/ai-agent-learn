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
  // Phase 3: LangGraph 新增字段
  activeNode?: string           // 当前正在执行的图节点
  interrupted?: boolean         // 是否被 HiTL 中断
  interruptContent?: string     // 中断提示信息
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

type ChatMode = 'chat' | 'agent' | 'langgraph'
type LangGraphSubMode = 'chat' | 'react' | 'hitl'

const API_BASE = 'http://localhost:3500'

// 不可变更新：创建新对象替代直接 mutation，兼容 React 18 StrictMode
function updateLastAssistant(
  prev: ChatMessage[],
  updater: (last: ChatMessage) => Partial<ChatMessage>,
): ChatMessage[] {
  const last = prev[prev.length - 1]
  if (!last || last.role !== 'assistant') return prev
  return [...prev.slice(0, -1), { ...last, ...updater(last) }]
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [mode, setMode] = useState<ChatMode>('langgraph')
  // Phase 3: LangGraph 新增状态
  const [lgSubMode, setLgSubMode] = useState<LangGraphSubMode>('react')
  const [threadId, setThreadId] = useState<string>(() => `thread-${Date.now()}`)
  const [pendingResume, setPendingResume] = useState<string | null>(null) // 存储待恢复的 threadId
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

                setMessages(prev => updateLastAssistant(prev, last => ({
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

  // Phase 2: Agent 聊天（带工具调用）
  const handleAgentChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    // 插入一条空的 assistant 消息，带 toolCalls 数组
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
                // 工具调用开始
                setMessages(prev => updateLastAssistant(prev, last => ({
                  toolCalls: [...(last.toolCalls || []), {
                    name: parsed.name,
                    args: parsed.args,
                    status: 'calling' as const,
                  }],
                })))
              } else if (parsed.type === 'tool_result') {
                // 工具返回结果
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
                // 最终文本内容（token 级流式，逐 token 追加）
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
      setMessages(prev => updateLastAssistant(prev, last =>
        !last.content ? { content: `Error: ${err}` } : {},
      ))
    } finally {
      setLoading(false)
      // 确保思考状态被正确关闭
      setMessages(prev => updateLastAssistant(prev, last =>
        last.isThinking ? {
          isThinking: false,
          thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
        } : {},
      ))
    }
  }

  // Phase 3: LangGraph 聊天
  const handleLangGraphChat = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)
    setPendingResume(null)

    // 插入空的 assistant 消息
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      toolCalls: [],
      activeNode: undefined,
      interrupted: false,
      isThinking: true,
    }])
    const thinkStartTime = Date.now()

    // 根据子模式选择 API 端点
    const endpoint = lgSubMode === 'chat'
      ? '/langgraph/chat'
      : lgSubMode === 'react'
        ? '/langgraph/react'
        : '/langgraph/hitl'

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          threadId,
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

              if (parsed.type === 'node') {
                // 图节点切换 —— 更新当前活跃节点
                setMessages(prev => updateLastAssistant(prev, () => ({
                  activeNode: parsed.node,
                })))
              } else if (parsed.type === 'reasoning') {
                // 模型推理内容（来自 <think> 标签或 reasoning_content）
                setMessages(prev => updateLastAssistant(prev, last => ({
                  thinkContent: (last.thinkContent || '') + parsed.content,
                })))
              } else if (parsed.type === 'tool_call') {
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
                    t.status === 'calling'
                      ? { ...t, result: parsed.result, status: 'done' as const }
                      : t,
                  )
                  return { toolCalls }
                }))
              } else if (parsed.type === 'content') {
                setMessages(prev => updateLastAssistant(prev, last => ({
                  content: (last.content || '') + parsed.content,
                  activeNode: undefined,
                  ...(last.isThinking ? {
                    isThinking: false,
                    thinkDuration: Math.round((Date.now() - thinkStartTime) / 1000),
                  } : {}),
                })))
              } else if (parsed.type === 'interrupt') {
                // Human-in-the-Loop 中断
                setMessages(prev => updateLastAssistant(prev, () => ({
                  interrupted: true,
                  interruptContent: parsed.content,
                  activeNode: undefined,
                })))
                setPendingResume(threadId)
              } else if (parsed.type === 'error') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  content: `Error: ${parsed.error}`,
                })))
              }
              // type === 'done': 清除 activeNode
              if (parsed.type === 'done') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  activeNode: undefined,
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

  // Phase 3: 恢复被中断的执行
  const handleResume = async () => {
    if (!pendingResume || loading) return
    setLoading(true)

    // 更新最后一条消息：去掉中断状态，重新进入思考
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

              if (parsed.type === 'node') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  activeNode: parsed.node,
                })))
              } else if (parsed.type === 'reasoning') {
                setMessages(prev => updateLastAssistant(prev, last => ({
                  thinkContent: (last.thinkContent || '') + parsed.content,
                })))
              } else if (parsed.type === 'tool_result') {
                setMessages(prev => updateLastAssistant(prev, last => {
                  if (!last.toolCalls) return {}
                  const toolCalls = last.toolCalls.map(t =>
                    t.status === 'calling'
                      ? { ...t, result: parsed.result, status: 'done' as const }
                      : t,
                  )
                  return { toolCalls }
                }))
              } else if (parsed.type === 'content') {
                setMessages(prev => updateLastAssistant(prev, last => ({
                  content: (last.content || '') + parsed.content,
                  activeNode: undefined,
                  ...(last.isThinking ? {
                    isThinking: false,
                    thinkDuration: (last.thinkDuration || 0) + Math.round((Date.now() - thinkStartTime) / 1000),
                  } : {}),
                })))
              } else if (parsed.type === 'interrupt') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  interrupted: true,
                  interruptContent: parsed.content,
                  activeNode: undefined,
                  isThinking: false,
                })))
                // 还有更多中断，保持 pendingResume
                return
              } else if (parsed.type === 'done') {
                setMessages(prev => updateLastAssistant(prev, () => ({
                  activeNode: undefined,
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
      setPendingResume(null)
      setMessages(prev => updateLastAssistant(prev, last =>
        last.isThinking ? {
          isThinking: false,
          thinkDuration: (last.thinkDuration || 0) + Math.round((Date.now() - thinkStartTime) / 1000),
        } : {},
      ))
    }
  }

  const handleSend = () => {
    if (mode === 'langgraph') {
      handleLangGraphChat()
    } else if (mode === 'agent') {
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
    setPendingResume(null)
    // 重置 threadId，开始新的对话线程
    setThreadId(`thread-${Date.now()}`)
  }

  // 工具名称映射为友好的中文 + 图标
  const toolDisplayName: Record<string, { icon: string; label: string }> = {
    get_weather: { icon: '🌤️', label: '天气查询' },
    get_current_time: { icon: '🕐', label: '时间查询' },
    web_search: { icon: '🔍', label: '百科搜索' },
  }

  // 图节点名称映射
  const nodeDisplayName: Record<string, { icon: string; label: string }> = {
    agent: { icon: '🧠', label: 'Agent 推理' },
    tools: { icon: '🔧', label: '工具执行' },
  }

  // 当前模式的标题
  const headerTitle = mode === 'langgraph'
    ? `Phase 3 (LangGraph - ${lgSubMode === 'chat' ? 'StateGraph' : lgSubMode === 'react' ? 'ReAct' : 'HiTL'})`
    : mode === 'agent'
      ? 'Phase 2 (Tool Use)'
      : 'Phase 1'

  return (
    <div className="chat-app">
      {/* Header */}
      <header className="chat-header">
        <h1>AI Chat - {headerTitle}</h1>
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
          {/* LangGraph 模式下显示 threadId */}
          {mode === 'langgraph' && (
            <div className="settings-thread">
              <label>Thread ID（对话线程）</label>
              <div className="thread-id-row">
                <input
                  type="text"
                  value={threadId}
                  onChange={e => setThreadId(e.target.value)}
                  placeholder="thread-001"
                />
                <button
                  className="btn-tool"
                  onClick={() => setThreadId(`thread-${Date.now()}`)}
                  title="生成新 ID"
                >
                  🔄
                </button>
              </div>
              <span className="settings-hint">同一个 Thread ID 共享对话记忆</span>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>👋 发送一条消息开始聊天</p>
            <p className="hint">
              {mode === 'langgraph'
                ? lgSubMode === 'hitl'
                  ? 'Human-in-the-Loop 模式：AI 调用工具前会暂停，等你确认后再执行'
                  : lgSubMode === 'react'
                    ? 'ReAct Agent 模式：一行代码创建的 Agent，内置 Tool Use 循环 + 对话记忆'
                    : 'StateGraph 模式：手动构建的状态图 Agent，展示 Node/Edge/条件路由'
                : mode === 'agent'
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
                {/* Think Block - 统一的思考过程折叠区域（深度思考 / 节点执行 / 工具调用） */}
                {(msg.isThinking || msg.thinkContent || msg.thinkDuration != null || (msg.toolCalls && msg.toolCalls.length > 0)) && (
                  <details className="think-block" open>
                    <summary>
                      {msg.isThinking ? (
                        <span className="think-status thinking">正在思考...</span>
                      ) : (
                        <span className="think-status">
                          已思考{msg.thinkDuration ? `（用时 ${msg.thinkDuration} 秒）` : ''}
                        </span>
                      )}
                    </summary>
                    <div className="think-content">
                      {/* Phase 1: 深度思考文本 */}
                      {msg.thinkContent && <div className="think-text">{msg.thinkContent}</div>}

                      {/* Phase 3: 图节点执行指示器 */}
                      {msg.activeNode && (
                        <div className="graph-node-indicator">
                          <span className="graph-node-icon">
                            {nodeDisplayName[msg.activeNode]?.icon || '⚡'}
                          </span>
                          <span className="graph-node-label">
                            {nodeDisplayName[msg.activeNode]?.label || msg.activeNode}
                          </span>
                          <span className="graph-node-dot" />
                        </div>
                      )}

                      {/* Phase 2 + Phase 3: 工具调用 */}
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
                    </div>
                  </details>
                )}

                {/* Phase 3: Human-in-the-Loop 中断确认面板 */}
                {msg.interrupted && (
                  <div className="hitl-interrupt-panel">
                    <div className="hitl-interrupt-header">
                      <span className="hitl-interrupt-icon">⏸️</span>
                      <span className="hitl-interrupt-title">等待确认</span>
                    </div>
                    <p className="hitl-interrupt-desc">
                      Agent 想要执行上述工具调用，请确认是否继续执行。
                    </p>
                    <div className="hitl-interrupt-actions">
                      <button
                        className="hitl-btn hitl-btn-approve"
                        onClick={handleResume}
                        disabled={loading}
                      >
                        ✅ 确认执行
                      </button>
                    </div>
                  </div>
                )}

                {/* Main Content */}
                {msg.content || (loading && i === messages.length - 1 && !msg.interrupted ? '▍' : '')}
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
            placeholder={
              mode === 'langgraph'
                ? lgSubMode === 'hitl'
                  ? '试试问：北京天气怎么样？（AI 会暂停等你确认）'
                  : '试试问：北京天气怎么样？/ 纽约现在几点？/ 什么是 LangChain？'
                : mode === 'agent'
                  ? '试试问：北京天气怎么样？/ 纽约现在几点？/ 什么是 LangChain？'
                  : '给 AI 发送消息'
            }
            rows={1}
            disabled={loading || !!pendingResume}
          />
          <div className="input-bottom">
            <div className="input-tools">
              {/* 模式切换按钮组 */}
              <button
                className={`btn-tool ${mode === 'chat' ? 'active' : ''}`}
                onClick={() => setMode('chat')}
                title="Phase 1: 普通聊天"
              >
                💬 聊天
              </button>
              <button
                className={`btn-tool ${mode === 'agent' ? 'active' : ''}`}
                onClick={() => setMode('agent')}
                title="Phase 2: Tool Use Agent"
              >
                🛠️ Agent
              </button>
              <button
                className={`btn-tool ${mode === 'langgraph' ? 'active' : ''}`}
                onClick={() => setMode('langgraph')}
                title="Phase 3: LangGraph"
              >
                📊 LangGraph
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

              {/* LangGraph 子模式选择 */}
              {mode === 'langgraph' && (
                <div className="lg-submode-group">
                  <span className="lg-submode-divider">|</span>
                  <button
                    className={`btn-tool btn-tool-sm ${lgSubMode === 'chat' ? 'active' : ''}`}
                    onClick={() => setLgSubMode('chat')}
                    title="自定义 StateGraph"
                  >
                    StateGraph
                  </button>
                  <button
                    className={`btn-tool btn-tool-sm ${lgSubMode === 'react' ? 'active' : ''}`}
                    onClick={() => setLgSubMode('react')}
                    title="预构建 ReAct Agent"
                  >
                    ReAct
                  </button>
                  <button
                    className={`btn-tool btn-tool-sm ${lgSubMode === 'hitl' ? 'active' : ''}`}
                    onClick={() => setLgSubMode('hitl')}
                    title="Human-in-the-Loop"
                  >
                    HiTL
                  </button>
                </div>
              )}
            </div>
            <button
              className="btn-send-round"
              onClick={handleSend}
              disabled={!input.trim() || loading || !!pendingResume}
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
