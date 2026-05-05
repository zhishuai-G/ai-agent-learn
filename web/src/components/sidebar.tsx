import type { Session } from '../types/chat'

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  open: boolean
  onClose: () => void
}

const MODE_LABELS: Record<string, string> = {
  chat: 'Phase 1',
  agent: 'Phase 2',
  langgraph: 'Phase 3',
  rag: 'Phase 4',
  'multi-agent': 'Phase 5',
  mcp: 'Phase 6',
}

export function Sidebar({ sessions, activeSessionId, onSelect, onCreate, onDelete, open, onClose }: SidebarProps) {
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <span>对话列表</span>
          <button className="sidebar-close" onClick={onClose}>✕</button>
        </div>
        <button className="sidebar-new" onClick={onCreate}>+ 新对话</button>
        <div className="sidebar-list">
          {sessions.length === 0 && (
            <div className="sidebar-empty">暂无对话</div>
          )}
          {sessions.map(session => (
            <div
              key={session.id}
              className={`sidebar-item ${session.id === activeSessionId ? 'sidebar-item-active' : ''}`}
              onClick={() => { onSelect(session.id); onClose() }}
            >
              <div className="sidebar-item-title">{session.title}</div>
              <div className="sidebar-item-meta">
                <span className="sidebar-item-mode">{MODE_LABELS[session.mode] || session.mode}</span>
                <span className="sidebar-item-time">{formatTime(session.updatedAt)}</span>
              </div>
              <button
                className="sidebar-item-delete"
                onClick={e => { e.stopPropagation(); onDelete(session.id) }}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
