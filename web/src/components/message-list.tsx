import { memo } from 'react'
import type { ChatMessage } from '../types/chat'
import { AGENT_DISPLAY_INFO } from '../types/chat'
import { UserMessage } from './user-message'
import { AssistantMessage } from './assistant-message'

interface MessageListProps {
  messages: ChatMessage[]
  loading: boolean
  onResume: () => void
}

export const MessageList = memo(function MessageList({ messages, loading, onResume }: MessageListProps) {
  return (
    <>
      {messages.map((msg, i) => (
        <div key={i} className={`message ${msg.role}`}>
          <div className={`message-avatar ${msg.agentName ? `agent-avatar-${msg.agentName}` : ''}`}>
            {msg.role === 'user' ? '👤' : msg.agentName ? (AGENT_DISPLAY_INFO[msg.agentName]?.icon || '🤖') : '🤖'}
          </div>
          <div className="message-content">
            {msg.role === 'user'
              ? <UserMessage content={msg.content} />
              : <AssistantMessage message={msg} loading={loading} isLast={i === messages.length - 1} onResume={onResume} />
            }
          </div>
        </div>
      ))}
    </>
  )
})
