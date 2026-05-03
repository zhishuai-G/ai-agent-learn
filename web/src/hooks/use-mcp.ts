import { useState } from 'react'
import type { ChatMessage, SetMessages } from '../types/chat'
import { API_BASE, updateLastAssistant, TOOL_DISPLAY_NAME } from '../types/chat'
import { readSSE } from '../utils/sse'

// MCP 工具信息
export interface McpToolInfo {
  name: string
  description: string
}

export function useMcp(
  messages: ChatMessage[],
  setMessages: SetMessages,
  setLoading: (v: boolean) => void,
) {
  // MCP 动态发现的工具列表
  const [discoveredTools, setDiscoveredTools] = useState<McpToolInfo[]>([])

  // 查询 MCP Server 提供的工具列表
  const fetchTools = async () => {
    try {
      const res = await fetch(`${API_BASE}/mcp/tools`)
      const data = await res.json()
      if (data.tools) {
        setDiscoveredTools(data.tools)
      }
    } catch {
      // 工具获取失败不影响聊天
    }
  }

  const handleChat = async (userMessage: string, threadId?: string) => {
    setLoading(true)

    // 创建助手消息
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      toolCalls: [],
      isThinking: true,
    }])

    try {
      const res = await fetch(`${API_BASE}/mcp/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, threadId }),
      })

      await readSSE(res, parsed => {
        const type = parsed.type as string

        if (type === 'tools_discovered') {
          // MCP 核心：运行时动态发现工具
          const toolNames = parsed.tools as string[]
          setDiscoveredTools(toolNames.map(name => ({
            name,
            description: TOOL_DISPLAY_NAME[name]?.label || name,
          })))
          // 在消息中显示发现的工具
          setMessages(prev => updateLastAssistant(prev, last => ({
            thinkContent: (last.thinkContent || '') + `🔍 MCP 动态发现工具: ${toolNames.join(', ')}\n`,
          })))

        } else if (type === 'agent_start') {
          // Agent 开始执行
          setMessages(prev => updateLastAssistant(prev, () => ({
            isThinking: true,
          })))

        } else if (type === 'content') {
          // Agent 输出内容
          setMessages(prev => updateLastAssistant(prev, last => ({
            content: (last.content || '') + (parsed.content as string),
            ...(last.isThinking && !last.thinkContent ? { isThinking: false } : {}),
          })))

        } else if (type === 'tool_call') {
          // 工具调用
          const toolName = parsed.name as string
          const displayName = TOOL_DISPLAY_NAME[toolName]?.label || toolName
          setMessages(prev => updateLastAssistant(prev, last => ({
            toolCalls: [...(last.toolCalls || []), {
              name: displayName,
              args: parsed.args as Record<string, unknown>,
              status: 'calling' as const,
            }],
          })))

        } else if (type === 'tool_result') {
          // 工具返回结果
          const toolName = parsed.name as string
          const displayName = TOOL_DISPLAY_NAME[toolName]?.label || toolName
          setMessages(prev => updateLastAssistant(prev, last => {
            if (!last.toolCalls) return {}
            const toolCalls = last.toolCalls.map(t =>
              t.name === displayName && t.status === 'calling'
                ? { ...t, result: parsed.result as string, status: 'done' as const }
                : t,
            )
            return { toolCalls }
          }))

        } else if (type === 'error') {
          setMessages(prev => updateLastAssistant(prev, () => ({
            content: `Error: ${parsed.error}`,
            isThinking: false,
          })))

        } else if (type === 'done') {
          setMessages(prev => updateLastAssistant(prev, last =>
            last.isThinking ? { isThinking: false } : {},
          ))
        }
      })
    } catch (err) {
      setMessages(prev => updateLastAssistant(prev, () => ({
        content: `Error: ${err}`,
        isThinking: false,
      })))
    } finally {
      setLoading(false)
    }
  }

  return { handleChat, discoveredTools, fetchTools }
}
