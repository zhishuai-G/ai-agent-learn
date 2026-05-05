import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import './styles/features.css'
import './styles/multi-agent.css'
import './styles/mcp.css'
import './styles/markdown.css'
import './styles/sidebar.css'
import type { ChatMessage, ChatMode, LangGraphSubMode, MultiAgentSubMode } from './types/chat'
import { SUPPORTED_MODELS } from './types/chat'
import { useSessionStore } from './hooks/use-session-store'
import { useStreamChat } from './hooks/use-stream-chat'
import { useAgentChat } from './hooks/use-agent-chat'
import { useLangGraphChat } from './hooks/use-langgraph-chat'
import { useRag } from './hooks/use-rag'
import { useMultiAgent } from './hooks/use-multi-agent'
import { useMcp } from './hooks/use-mcp'
import { MessageList } from './components/message-list'
import { AgentFlow } from './components/agent-flow'
import { InputArea } from './components/input-area'
import { Sidebar } from './components/sidebar'

function App() {
  const sessionStore = useSessionStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 从当前会话恢复状态，或使用默认值
  const current = sessionStore.activeSession
  const [messages, setMessages] = useState<ChatMessage[]>(current?.messages || [])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(current?.systemPrompt || '你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [mode, setMode] = useState<ChatMode>(current?.mode || 'langgraph')
  const [lgSubMode, setLgSubMode] = useState<LangGraphSubMode>(current?.lgSubMode || 'react')
  const [multiAgentSubMode, setMultiAgentSubMode] = useState<MultiAgentSubMode>(current?.multiAgentSubMode || 'supervisor')
  const [threadId, setThreadId] = useState<string>(current?.threadId || `thread-${Date.now()}`)
  const [pendingResume, setPendingResume] = useState<string | null>(null)
  const [model, setModel] = useState<string>(current?.model || 'minimax-m2.7')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 会话切换时恢复状态
  const prevSessionIdRef = useRef<string | null>(sessionStore.activeSessionId)
  useEffect(() => {
    const curId = sessionStore.activeSessionId
    if (curId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = curId
      const s = sessionStore.activeSession
      if (s) {
        setMessages(s.messages)
        setSystemPrompt(s.systemPrompt)
        setMode(s.mode)
        setLgSubMode(s.lgSubMode)
        setMultiAgentSubMode(s.multiAgentSubMode)
        setThreadId(s.threadId)
        setModel(s.model)
      } else {
        setMessages([])
        setMode('langgraph')
        setLgSubMode('react')
        setMultiAgentSubMode('supervisor')
        setModel('minimax-m2.7')
        setThreadId(`thread-${Date.now()}`)
        setSystemPrompt('你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
      }
      setPendingResume(null)
    }
  }, [sessionStore.activeSessionId, sessionStore.activeSession])

  // 自动保存会话状态（messages 变化时）
  useEffect(() => {
    if (sessionStore.activeSessionId) {
      sessionStore.updateSession(sessionStore.activeSessionId, { messages })
      // 自动标题
      if (messages.length > 0) {
        sessionStore.autoTitle(sessionStore.activeSessionId, messages)
      }
    }
  }, [messages])

  // 保存其他状态变化
  const saveSessionMeta = useCallback(() => {
    if (sessionStore.activeSessionId) {
      sessionStore.updateSession(sessionStore.activeSessionId, {
        mode, lgSubMode, multiAgentSubMode, model, threadId, systemPrompt,
      })
    }
  }, [sessionStore.activeSessionId, mode, lgSubMode, multiAgentSubMode, model, threadId, systemPrompt])

  useEffect(() => { saveSessionMeta() }, [mode, lgSubMode, multiAgentSubMode, model, threadId, systemPrompt])

  // 确保至少有一个会话
  useEffect(() => {
    if (!sessionStore.activeSessionId) {
      sessionStore.createSession(mode, model)
    }
  }, [])

  // 各阶段 handler hooks
  const streamChatHandler = useStreamChat(messages, setMessages, setLoading)
  const agentChatHandler = useAgentChat(messages, setMessages, setLoading)
  const { handleChat: langGraphChatHandler, handleResume: langGraphResumeHandler } =
    useLangGraphChat(messages, setMessages, setLoading, setPendingResume)
  const rag = useRag(messages, setMessages, setLoading, mode === 'rag')
  const multiAgent = useMultiAgent(messages, setMessages, setLoading)
  const mcp = useMcp(messages, setMessages, setLoading)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || loading) return
    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    if (mode === 'multi-agent') multiAgent.handleChat(userMessage, multiAgentSubMode, threadId, model)
    else if (mode === 'mcp') mcp.handleChat(userMessage, threadId, model)
    else if (mode === 'rag') rag.handleRagChat(userMessage)
    else if (mode === 'langgraph') langGraphChatHandler(userMessage, { lgSubMode, threadId, systemPrompt, model })
    else if (mode === 'agent') agentChatHandler(userMessage, systemPrompt, model)
    else streamChatHandler(userMessage, systemPrompt, deepThink)
  }

  const langGraphResumeHandlerRef = useRef(langGraphResumeHandler)
  langGraphResumeHandlerRef.current = langGraphResumeHandler

  const handleResume = useCallback(() => {
    if (pendingResume) langGraphResumeHandlerRef.current(pendingResume)
  }, [pendingResume])

  const clearChat = () => {
    setMessages([])
    setPendingResume(null)
    setThreadId(`thread-${Date.now()}`)
    multiAgent.resetFlow()
  }

  const handleNewSession = () => {
    sessionStore.createSession(mode, model)
  }

  const headerTitle = mode === 'mcp'
    ? 'Phase 6 (MCP - 工具协议)'
    : mode === 'multi-agent'
    ? `Phase 5 (Multi-Agent - ${multiAgentSubMode === 'supervisor' ? 'Supervisor' : 'Swarm'})`
    : mode === 'rag'
      ? 'Phase 4 (RAG)'
      : mode === 'langgraph'
        ? `Phase 3 (LangGraph - ${lgSubMode === 'chat' ? 'StateGraph' : lgSubMode === 'react' ? 'ReAct' : 'HiTL'})`
        : mode === 'agent'
          ? 'Phase 2 (Tool Use)'
          : 'Phase 1'

  const emptyHint = mode === 'mcp'
    ? 'MCP 模式：工具通过协议动态发现，不再硬编码。试试问天气、时间、百科搜索'
    : mode === 'multi-agent'
    ? multiAgentSubMode === 'supervisor'
      ? 'Supervisor 模式：描述需求，PM→Architect→Developer→Reviewer 自动协作完成开发任务'
      : 'Swarm 模式：发送消息，Sales 和 Tech Support 根据意图自动交接处理'
    : mode === 'rag'
    ? 'RAG 模式：先在知识库中添加文档，然后基于文档内容提问，AI 会引用来源回答'
    : mode === 'langgraph'
      ? lgSubMode === 'hitl'
        ? 'Human-in-the-Loop 模式：AI 调用工具前会暂停，等你确认后再执行'
        : lgSubMode === 'react'
          ? 'ReAct Agent 模式：一行代码创建的 Agent，内置 Tool Use 循环 + 对话记忆'
          : 'StateGraph 模式：手动构建的状态图 Agent，展示 Node/Edge/条件路由'
      : mode === 'agent'
        ? '智能助手模式：AI 可以调用工具查实时天气、查世界时间、搜索百科知识'
        : '按 Enter 发送，开启「深度思考」获得更详细的推理'

  return (
    <div className="chat-app">
      {/* Sidebar */}
      <Sidebar
        sessions={sessionStore.sessions}
        activeSessionId={sessionStore.activeSessionId}
        onSelect={sessionStore.switchSession}
        onCreate={handleNewSession}
        onDelete={sessionStore.deleteSession}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Header */}
      <header className="chat-header">
        <div className="header-left">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} title="会话列表">☰</button>
          <h1>AI Chat - {headerTitle}</h1>
        </div>
        <div className="header-right">
          <span className="model-badge">{SUPPORTED_MODELS.find(m => m.value === model)?.label || model}</span>
          <button className="btn-icon" onClick={() => setShowSettings(!showSettings)} title="Settings">
            {showSettings ? '✕' : '⚙'}
          </button>
          <button className="btn-icon" onClick={clearChat} title="Clear chat">🗑</button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-model">
            <label>模型选择</label>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {SUPPORTED_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <label>System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="设定 AI 的角色和行为..."
          />
          {(mode === 'langgraph' || mode === 'multi-agent' || mode === 'mcp') && (
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

      {/* Phase 4: RAG 知识库管理面板 */}
      {mode === 'rag' && rag.showRagPanel && (
        <div className="rag-panel">
          <div className="rag-panel-header">
            <span className="rag-panel-title">知识库管理</span>
            <span className="rag-panel-status">
              {rag.ragDocCount > 0 ? `${rag.ragDocCount} 个文档块` : '暂无文档'}
            </span>
          </div>
          <div className="rag-input-group">
            <label>添加文本文档</label>
            <textarea
              value={rag.ragDocInput}
              onChange={e => rag.setRagDocInput(e.target.value)}
              rows={4}
              placeholder="粘贴文本内容到这里，如产品文档、FAQ、技术文章等..."
              disabled={rag.ragUploading}
            />
            <button
              className="rag-btn rag-btn-primary"
              onClick={rag.handleAddDocument}
              disabled={!rag.ragDocInput.trim() || rag.ragUploading}
            >
              {rag.ragUploading ? '处理中...' : '添加文档'}
            </button>
          </div>
          <div className="rag-input-group">
            <label>从网页加载</label>
            <div className="rag-url-row">
              <input
                type="text"
                value={rag.ragUrlInput}
                onChange={e => rag.setRagUrlInput(e.target.value)}
                placeholder="输入网页 URL，如 https://example.com/docs"
                disabled={rag.ragUploading}
              />
              <button
                className="rag-btn rag-btn-primary"
                onClick={rag.handleAddWebDocument}
                disabled={!rag.ragUrlInput.trim() || rag.ragUploading}
              >
                {rag.ragUploading ? '加载中...' : '加载'}
              </button>
            </div>
          </div>
          {rag.ragDocCount > 0 && (
            <button className="rag-btn rag-btn-danger" onClick={rag.handleClearKnowledgeBase}>
              清空知识库
            </button>
          )}
        </div>
      )}

      {/* Phase 5: Multi-Agent 协作可视化 */}
      {mode === 'multi-agent' && multiAgent.agentFlow && (
        <AgentFlow flow={multiAgent.agentFlow} subMode={multiAgentSubMode} />
      )}

      {/* Phase 6: MCP 工具发现面板 */}
      {mode === 'mcp' && mcp.discoveredTools.length > 0 && (
        <div className="mcp-tools-panel">
          <div className="mcp-tools-header">
            <span className="mcp-tools-title">🔌 MCP 动态工具</span>
            <span className="mcp-tools-count">{mcp.discoveredTools.length} 个工具可用</span>
          </div>
          <div className="mcp-tools-list">
            {mcp.discoveredTools.map(tool => (
              <div key={tool.name} className="mcp-tool-item">
                <span className="mcp-tool-name">{tool.name}</span>
                <span className="mcp-tool-desc">{tool.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>👋 发送一条消息开始聊天</p>
            <p className="hint">{emptyHint}</p>
          </div>
        )}
        <MessageList messages={messages} loading={loading} onResume={handleResume} />
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <InputArea
        input={input}
        setInput={setInput}
        onSend={handleSend}
        loading={loading}
        pendingResume={!!pendingResume}
        mode={mode}
        setMode={setMode}
        lgSubMode={lgSubMode}
        setLgSubMode={setLgSubMode}
        multiAgentSubMode={multiAgentSubMode}
        setMultiAgentSubMode={setMultiAgentSubMode}
        deepThink={deepThink}
        setDeepThink={setDeepThink}
        ragDocCount={rag.ragDocCount}
        showRagPanel={rag.showRagPanel}
        setShowRagPanel={rag.setShowRagPanel}
      />
    </div>
  )
}

export default App
