import { useState, useEffect } from 'react'
import type { CustomAgentConfig } from '../types/chat'
import { AVAILABLE_TOOLS, SUPPORTED_MODELS } from '../types/chat'

interface Props {
  agents: CustomAgentConfig[]
  selectedAgentId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, systemPrompt: string, tools: string[], model?: string) => Promise<CustomAgentConfig>
  onDelete: (id: string) => void
  onFetchAgents: () => void
}

export function CustomAgentPanel({ agents, selectedAgentId, onSelect, onCreate, onDelete, onFetchAgents }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [model, setModel] = useState('deepseek-v4-flash')

  useEffect(() => { onFetchAgents() }, [])

  const toggleTool = (toolName: string) => {
    setSelectedTools(prev =>
      prev.includes(toolName) ? prev.filter(t => t !== toolName) : [...prev, toolName],
    )
  }

  const handleCreate = async () => {
    if (!name.trim() || !systemPrompt.trim() || selectedTools.length === 0) return
    const agent = await onCreate(name.trim(), systemPrompt.trim(), selectedTools, model)
    onSelect(agent.id)
    setShowCreate(false)
    setName('')
    setSystemPrompt('')
    setSelectedTools([])
  }

  return (
    <div className="custom-agent-panel">
      <div className="custom-agent-header">
        <span className="custom-agent-title">🤖 自定义 Agent</span>
        <button className="custom-agent-btn" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '取消' : '+ 新建'}
        </button>
      </div>

      {showCreate && (
        <div className="custom-agent-create">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Agent 名称，如：旅行助手"
          />
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="系统提示词，如：你是一位旅行助手，帮助用户规划旅行..."
          />
          <div className="custom-agent-tools">
            <label>选择工具</label>
            {AVAILABLE_TOOLS.map(tool => (
              <label key={tool.value} className="custom-agent-tool-item">
                <input
                  type="checkbox"
                  checked={selectedTools.includes(tool.value)}
                  onChange={() => toggleTool(tool.value)}
                />
                <span>{tool.icon} {tool.label}</span>
              </label>
            ))}
          </div>
          <select value={model} onChange={e => setModel(e.target.value)}>
            {SUPPORTED_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <button
            className="custom-agent-create-btn"
            onClick={handleCreate}
            disabled={!name.trim() || !systemPrompt.trim() || selectedTools.length === 0}
          >
            创建
          </button>
        </div>
      )}

      <div className="custom-agent-list">
        {agents.map(agent => (
          <div
            key={agent.id}
            className={`custom-agent-item ${agent.id === selectedAgentId ? 'active' : ''}`}
            onClick={() => onSelect(agent.id)}
          >
            <div className="custom-agent-item-name">{agent.name}</div>
            <div className="custom-agent-item-tools">
              {agent.tools.map(t => AVAILABLE_TOOLS.find(a => a.value === t)?.icon).join(' ')}
            </div>
            <button
              className="custom-agent-item-delete"
              onClick={e => { e.stopPropagation(); onDelete(agent.id) }}
            >
              ✕
            </button>
          </div>
        ))}
        {agents.length === 0 && !showCreate && (
          <div className="custom-agent-empty">点击「+ 新建」创建你的自定义 Agent</div>
        )}
      </div>
    </div>
  )
}
