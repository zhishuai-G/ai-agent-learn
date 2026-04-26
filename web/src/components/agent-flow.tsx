import { Fragment } from 'react'
import type { MultiAgentSubMode, AgentFlowState, AgentFlowAgent } from '../types/chat'
import { AGENT_DISPLAY_INFO } from '../types/chat'

interface AgentFlowProps {
  flow: AgentFlowState
  subMode: MultiAgentSubMode
}

export function AgentFlow({ flow, subMode }: AgentFlowProps) {
  const isSupervisor = subMode === 'supervisor'

  return (
    <div className="agent-flow-panel">
      <div className="agent-flow-header">
        <span className="agent-flow-title">
          {isSupervisor ? '🎯 Supervisor 编排' : '🐝 Swarm 协作'}
        </span>
        {flow.handoffs.length > 0 && (
          <span className="agent-flow-handoff-count">
            {flow.handoffs.length} 次交接
          </span>
        )}
      </div>
      <div className="agent-flow-pipeline">
        {flow.agents.map((agent, i) => (
          <Fragment key={agent.name}>
            <AgentCard agent={agent} />
            {i < flow.agents.length - 1 && (
              <div className="agent-flow-arrow">
                {isSupervisor ? '→' : '⇄'}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {flow.handoffs.length > 0 && (
        <div className="agent-flow-handoffs">
          {flow.handoffs.map((h, i) => {
            const fromInfo = AGENT_DISPLAY_INFO[h.from] || { icon: '🤖', label: h.from }
            const toInfo = AGENT_DISPLAY_INFO[h.to] || { icon: '🤖', label: h.to }
            return (
              <span key={i} className="agent-flow-handoff-item">
                {fromInfo.icon} {fromInfo.label} → {toInfo.icon} {toInfo.label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentFlowAgent }) {
  const info = AGENT_DISPLAY_INFO[agent.name] || { icon: '🤖', label: agent.name, color: '#666' }

  return (
    <div className={`agent-card agent-card-${agent.status}`}>
      <div className="agent-card-icon">{info.icon}</div>
      <div className="agent-card-label">{info.label}</div>
      <div className={`agent-card-status agent-card-status-${agent.status}`}>
        {agent.status === 'active' ? '●' : agent.status === 'done' ? '✓' : '○'}
      </div>
    </div>
  )
}
