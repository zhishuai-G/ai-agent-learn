/**
 * SSE 流读取工具函数
 *
 * 从 fetch Response 的 ReadableStream 中解析 SSE data: 行，
 * 逐条回调给 onEvent 处理。
 *
 * 被 use-langgraph-chat、use-multi-agent、use-mcp 三个 hook 共用，
 * 提取到公共位置消除重复代码。
 */
export async function readSSE(
  res: Response,
  onEvent: (parsed: Record<string, unknown>) => void | 'stop',
) {
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
          const result = onEvent(parsed)
          if (result === 'stop') return
        } catch {
          buffer += line + '\n'
        }
      } else {
        if (trimmed) buffer += line + '\n'
      }
    }
  }
}
