import { useState, useRef, useEffect } from 'react'
import './App.css'
import './styles/features.css'
import './styles/multi-agent.css'
import type { ChatMessage, ChatMode, LangGraphSubMode, MultiAgentSubMode } from './types/chat'
import { useStreamChat } from './hooks/use-stream-chat'
import { useAgentChat } from './hooks/use-agent-chat'
import { useLangGraphChat } from './hooks/use-langgraph-chat'
import { useRag } from './hooks/use-rag'
import { useMultiAgent } from './hooks/use-multi-agent'
import { MessageList } from './components/message-list'
import { AgentFlow } from './components/agent-flow'

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('你是一位友好的 AI 助手，擅长用简洁的语言回答问题。')
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deepThink, setDeepThink] = useState(false)
  const [mode, setMode] = useState<ChatMode>('langgraph')
  const [lgSubMode, setLgSubMode] = useState<LangGraphSubMode>('react')
  const [multiAgentSubMode, setMultiAgentSubMode] = useState<MultiAgentSubMode>('supervisor')
  const [threadId, setThreadId] = useState<string>(() => `thread-${Date.now()}`)
  const [pendingResume, setPendingResume] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 各阶段 handler hooks
  const streamChatHandler = useStreamChat(messages, setMessages, setLoading)
  const agentChatHandler = useAgentChat(messages, setMessages, setLoading)
  const { handleChat: langGraphChatHandler, handleResume: langGraphResumeHandler } =
    useLangGraphChat(messages, setMessages, setLoading, setPendingResume)
  const rag = useRag(messages, setMessages, setLoading, mode === 'rag')
  const multiAgent = useMultiAgent(messages, setMessages, setLoading)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || loading) return
    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    if (mode === 'multi-agent') multiAgent.handleChat(userMessage, multiAgentSubMode, threadId)
    else if (mode === 'rag') rag.handleRagChat(userMessage)
    else if (mode === 'langgraph') langGraphChatHandler(userMessage, { lgSubMode, threadId, systemPrompt })
    else if (mode === 'agent') agentChatHandler(userMessage, systemPrompt)
    else streamChatHandler(userMessage, systemPrompt, deepThink)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleResume = () => {
    if (pendingResume) langGraphResumeHandler(pendingResume)
  }

  const clearChat = () => {
    setMessages([])
    setPendingResume(null)
    setThreadId(`thread-${Date.now()}`)
    multiAgent.resetFlow()
  }

  const headerTitle = mode === 'multi-agent'
    ? `Phase 5 (Multi-Agent - ${multiAgentSubMode === 'supervisor' ? 'Supervisor' : 'Swarm'})`
    : mode === 'rag'
      ? 'Phase 4 (RAG)'
      : mode === 'langgraph'
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
          {(mode === 'langgraph' || mode === 'multi-agent') && (
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

      {/* Messages */}
      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>👋 发送一条消息开始聊天</p>
            <p className="hint">
              {mode === 'multi-agent'
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
                    : '按 Enter 发送，开启「深度思考」获得更详细的推理'}
            </p>
          </div>
        )}
        <MessageList messages={messages} loading={loading} onResume={handleResume} />
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
              mode === 'multi-agent'
                ? multiAgentSubMode === 'supervisor'
                  ? '描述你的开发需求，如：开发一个用户登录功能'
                  : '试试问：这个产品多少钱？/ 我的代码报错了怎么办？'
                : mode === 'rag'
                ? '基于知识库内容提问，如：这篇文档讲了什么？'
                : mode === 'langgraph'
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
              <button className={`btn-tool ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')} title="Phase 1: 普通聊天">
                💬 聊天
              </button>
              <button className={`btn-tool ${mode === 'agent' ? 'active' : ''}`} onClick={() => setMode('agent')} title="Phase 2: Tool Use Agent">
                🛠️ Agent
              </button>
              <button className={`btn-tool ${mode === 'langgraph' ? 'active' : ''}`} onClick={() => setMode('langgraph')} title="Phase 3: LangGraph">
                📊 LangGraph
              </button>
              <button className={`btn-tool ${mode === 'rag' ? 'active' : ''}`} onClick={() => setMode('rag')} title="Phase 4: RAG 检索增强生成">
                📚 RAG
              </button>
              <button className={`btn-tool ${mode === 'multi-agent' ? 'active' : ''}`} onClick={() => setMode('multi-agent')} title="Phase 5: Multi-Agent 多智能体协作">
                🤝 Multi-Agent
              </button>

              {mode === 'multi-agent' && (
                <div className="lg-submode-group">
                  <span className="lg-submode-divider">|</span>
                  <button className={`btn-tool btn-tool-sm ${multiAgentSubMode === 'supervisor' ? 'active' : ''}`} onClick={() => setMultiAgentSubMode('supervisor')}>Supervisor</button>
                  <button className={`btn-tool btn-tool-sm ${multiAgentSubMode === 'swarm' ? 'active' : ''}`} onClick={() => setMultiAgentSubMode('swarm')}>Swarm</button>
                </div>
              )}

              {mode === 'chat' && (
                <button className={`btn-tool ${deepThink ? 'active' : ''}`} onClick={() => setDeepThink(!deepThink)} title="深度思考">
                  💭 深度思考
                </button>
              )}

              {mode === 'langgraph' && (
                <div className="lg-submode-group">
                  <span className="lg-submode-divider">|</span>
                  <button className={`btn-tool btn-tool-sm ${lgSubMode === 'chat' ? 'active' : ''}`} onClick={() => setLgSubMode('chat')} title="自定义 StateGraph">StateGraph</button>
                  <button className={`btn-tool btn-tool-sm ${lgSubMode === 'react' ? 'active' : ''}`} onClick={() => setLgSubMode('react')} title="预构建 ReAct Agent">ReAct</button>
                  <button className={`btn-tool btn-tool-sm ${lgSubMode === 'hitl' ? 'active' : ''}`} onClick={() => setLgSubMode('hitl')} title="Human-in-the-Loop">HiTL</button>
                </div>
              )}

              {mode === 'rag' && (
                <div className="lg-submode-group">
                  <span className="lg-submode-divider">|</span>
                  <button
                    className={`btn-tool btn-tool-sm ${rag.showRagPanel ? 'active' : ''}`}
                    onClick={() => rag.setShowRagPanel(!rag.showRagPanel)}
                    title="管理知识库"
                  >
                    {rag.ragDocCount > 0 ? `知识库 (${rag.ragDocCount})` : '知识库'}
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
