import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ChatMessage } from '../types/chat'
import { TOOL_DISPLAY_NAME, NODE_DISPLAY_NAME, AGENT_DISPLAY_INFO } from '../types/chat'

interface AssistantMessageProps {
  message: ChatMessage
  loading: boolean
  isLast: boolean
  onResume: () => void
}

export const AssistantMessage = memo(function AssistantMessage({ message: msg, loading, isLast, onResume }: AssistantMessageProps) {
  return (
    <>
      {msg.agentName && (
        <span className="agent-badge" style={{ color: AGENT_DISPLAY_INFO[msg.agentName]?.color }}>
          {AGENT_DISPLAY_INFO[msg.agentName]?.icon} {AGENT_DISPLAY_INFO[msg.agentName]?.label || msg.agentName}
        </span>
      )}
      <div className="message-bubble">
        {/* Think Block - 统一的思考过程折叠区域 */}
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
              {msg.thinkContent && <div className="think-text">{msg.thinkContent}</div>}

              {/* Phase 3: 图节点执行指示器 */}
              {msg.activeNode && (
                <div className="graph-node-indicator">
                  <span className="graph-node-icon">
                    {NODE_DISPLAY_NAME[msg.activeNode]?.icon || '⚡'}
                  </span>
                  <span className="graph-node-label">
                    {NODE_DISPLAY_NAME[msg.activeNode]?.label || msg.activeNode}
                  </span>
                  <span className="graph-node-dot" />
                </div>
              )}

              {/* Phase 2 + Phase 3: 工具调用 */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="tool-calls-chain">
                  {msg.toolCalls.map((tc, j) => {
                    const display = TOOL_DISPLAY_NAME[tc.name] || { icon: '🔧', label: tc.name }
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
                onClick={onResume}
                disabled={loading}
              >
                ✅ 确认执行
              </button>
            </div>
          </div>
        )}

        {/* Main Content - Markdown 渲染 */}
        {msg.content ? (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeString = String(children).replace(/\n$/, '')
                  // 有语言标识的代码块 → 语法高亮
                  if (match) {
                    return (
                      <SyntaxHighlighter
                        style={oneDark}
                        language={match[1]}
                        PreTag="div"
                      >
                        {codeString}
                      </SyntaxHighlighter>
                    )
                  }
                  // 行内代码
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : (loading && isLast && !msg.interrupted ? '▍' : '')}

        {/* Phase 4: RAG 引用来源 */}
        {msg.ragSources && msg.ragSources.length > 0 && msg.content && (
          <details className="rag-sources-block">
            <summary className="rag-sources-summary">
              <span className="rag-sources-icon">📚</span>
              <span>引用来源（{msg.ragSources.length} 个文档块）</span>
            </summary>
            <div className="rag-sources-list">
              {msg.ragSources.map((src, j) => (
                <div key={j} className="rag-source-item">
                  <div className="rag-source-header">
                    <span className="rag-source-index">[{j + 1}]</span>
                    <span className="rag-source-score">
                      相似度: {(1 - src.score).toFixed(3)}
                    </span>
                  </div>
                  <div className="rag-source-content">{src.content}</div>
                  {src.metadata && Object.keys(src.metadata).length > 0 && (
                    <div className="rag-source-meta">
                      {Object.entries(src.metadata).map(([k, v]) => (
                        <span key={k} className="rag-meta-tag">{k}: {String(v)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </>
  )
})