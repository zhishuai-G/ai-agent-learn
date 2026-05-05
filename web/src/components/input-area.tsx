import type { ChatMode, LangGraphSubMode, MultiAgentSubMode } from '../types/chat'

interface InputAreaProps {
  input: string
  setInput: (v: string) => void
  onSend: () => void
  loading: boolean
  pendingResume: boolean
  mode: ChatMode
  setMode: (v: ChatMode) => void
  lgSubMode: LangGraphSubMode
  setLgSubMode: (v: LangGraphSubMode) => void
  multiAgentSubMode: MultiAgentSubMode
  setMultiAgentSubMode: (v: MultiAgentSubMode) => void
  deepThink: boolean
  setDeepThink: (v: boolean) => void
  ragDocCount: number
  showRagPanel: boolean
  setShowRagPanel: (v: boolean) => void
}

export function InputArea({
  input, setInput, onSend, loading, pendingResume,
  mode, setMode,
  lgSubMode, setLgSubMode,
  multiAgentSubMode, setMultiAgentSubMode,
  deepThink, setDeepThink,
  ragDocCount, showRagPanel, setShowRagPanel,
}: InputAreaProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const placeholder = mode === 'custom'
    ? '选择一个自定义 Agent，然后发送消息'
    : mode === 'mcp'
    ? '试试问：北京天气怎么样？/ 纽约现在几点？（工具通过 MCP 动态发现）'
    : mode === 'multi-agent'
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

  return (
    <footer className="chat-input">
      <div className="input-card">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={loading || pendingResume}
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
            <button className={`btn-tool ${mode === 'mcp' ? 'active' : ''}`} onClick={() => setMode('mcp')} title="Phase 6: MCP 工具协议">
              🔌 MCP
            </button>
            <button className={`btn-tool ${mode === 'custom' ? 'active' : ''}`} onClick={() => setMode('custom')} title="自定义 Agent">
              🤖 Custom
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
                  className={`btn-tool btn-tool-sm ${showRagPanel ? 'active' : ''}`}
                  onClick={() => setShowRagPanel(!showRagPanel)}
                  title="管理知识库"
                >
                  {ragDocCount > 0 ? `知识库 (${ragDocCount})` : '知识库'}
                </button>
              </div>
            )}
          </div>
          <button
            className="btn-send-round"
            onClick={onSend}
            disabled={!input.trim() || loading || pendingResume}
          >
            {loading ? '⏳' : '↑'}
          </button>
        </div>
      </div>
    </footer>
  )
}
