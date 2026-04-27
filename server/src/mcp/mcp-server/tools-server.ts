/**
 * Phase 6: MCP Server — 工具服务端
 *
 * 核心思想：把 Phase 2 硬编码在 Agent 里的工具，提取为独立的 MCP Server。
 * 任何 Agent 通过 MCP Client 连接后，都能动态发现并调用这些工具。
 *
 * 对比 Phase 2（硬编码方式）：
 * ```typescript
 * // Phase 2: 工具和 Agent 绑死
 * const agent = createReactAgent({ tools: [searchTool, weatherTool, timeTool] });
 * ```
 *
 * MCP 方式：
 * ```
 * MCP Server（本文件）→ 注册工具 → 通过 stdio 协议暴露
 * MCP Client（mcp.service.ts）→ 动态发现 → 注入 Agent
 * ```
 *
 * 学习要点：
 * 1. McpServer 是 MCP SDK 的核心类，用于创建 MCP 协议服务端
 * 2. server.tool() 注册工具，格式和 Phase 2 的 tool() 类似但走 MCP 协议
 * 3. StdioServerTransport 使用 stdin/stdout 通信，Client 启动 Server 子进程
 * 4. 工具的 name、description、schema 和 Phase 2 完全一致——MCP 只是通信协议变了
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ==================== 1. 创建 MCP Server 实例 ====================

const server = new McpServer({
  name: 'tools-server',       // Server 名称，Client 连接时会看到
  version: '1.0.0',           // 版本号
});

// ==================== 2. 注册工具（从 Phase 2 迁移）====================

/**
 * 天气查询工具
 *
 * 对比 Phase 2 的写法：
 * ```typescript
 * // Phase 2: 用 @langchain/core/tools 的 tool() 函数
 * export const weatherTool = tool(async ({ city }) => {...}, { name: 'get_weather', ... });
 *
 * // Phase 6: 用 MCP SDK 的 server.tool() 方法
 * server.tool('get_weather', '...描述...', { city: z.string() }, async ({ city }) => {...});
 * ```
 *
 * 核心区别：
 * - Phase 2 的 tool() 返回一个 LangChain StructuredTool 对象，需要手动绑定到 Agent
 * - Phase 6 的 server.tool() 将工具注册到 MCP Server，任何 MCP Client 都能发现并调用
 */
server.tool(
  'get_weather',                                            // 工具名（和 Phase 2 保持一致）
  '获取指定城市的实时天气信息，包括温度、体感温度、湿度、风向风速、能见度等。支持全球城市。',
  {
    city: z.string().describe('城市名称，支持中文或英文，例如：北京、上海、Tokyo、New York'),
  },
  async ({ city }) => {
    try {
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`,
        { signal: AbortSignal.timeout(10000) },
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const current = data.current_condition?.[0];

      if (!current) {
        return {
          content: [{ type: 'text' as const, text: `未能获取 ${city} 的天气数据` }],
        };
      }

      const desc =
        current.lang_zh?.[0]?.value ||
        current.weatherDesc?.[0]?.value ||
        '未知';

      const result = [
        `${city}当前天气：${desc}`,
        `温度：${current.temp_C}°C（体感 ${current.FeelsLikeC}°C）`,
        `湿度：${current.humidity}%`,
        `风：${current.winddir16Point} ${current.windspeedKmph} km/h`,
        `能见度：${current.visibility} km`,
        `紫外线指数：${current.uvIndex}`,
      ].join('，');

      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `获取 ${city} 天气失败：${msg}。请检查城市名称是否正确。` }],
      };
    }
  },
);

/**
 * 时间查询工具
 */
server.tool(
  'get_current_time',
  '获取当前的日期和时间。可以指定时区来查询世界各地的时间。',
  {
    timezone: z.string().optional().describe(
      'IANA 时区名称，如 Asia/Shanghai、America/New_York、Europe/London。不传则默认为中国时间（Asia/Shanghai）',
    ),
  },
  async ({ timezone }) => {
    const tz = timezone || 'Asia/Shanghai';

    try {
      const res = await fetch(
        `http://worldtimeapi.org/api/timezone/${tz}`,
        { signal: AbortSignal.timeout(10000) },
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const dt = new Date(data.datetime);
      const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

      const formatted = dt.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const result = [
        `时区：${data.timezone}（UTC${data.utc_offset}）`,
        `当前时间：${formatted} ${weekdays[data.day_of_week]}`,
      ].join('，');

      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch {
      // API 不可用时降级到 Node.js 本地时间
      try {
        const now = new Date();
        const formatted = now.toLocaleString('zh-CN', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        return {
          content: [{ type: 'text' as const, text: `当前时间（${tz}）：${formatted}（注：由本地系统时钟提供）` }],
        };
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: `无法识别时区 "${tz}"，请使用标准 IANA 时区格式，如 Asia/Shanghai、America/New_York、Europe/London`,
          }],
        };
      }
    }
  },
);

/**
 * 搜索工具（维基百科）
 */

/** 从维基百科获取页面摘要 */
async function getWikiSummary(query: string, lang: 'zh' | 'en'): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'AIAgentLearn/1.0 (learning project)' },
      },
    );
    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data.type === 'standard' && data.extract) {
      return `【${data.title}】${data.extract}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** 在维基百科中搜索相关条目 */
async function searchWiki(query: string, lang: 'zh' | 'en', limit = 3): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      format: 'json',
      utf8: '1',
      srlimit: String(limit),
    });

    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?${params}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'AIAgentLearn/1.0 (learning project)' },
      },
    );
    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const results = data.query?.search;
    if (!results || results.length === 0) {
      return null;
    }

    const summaries: string[] = [];
    for (const item of results) {
      const summary = await getWikiSummary(item.title, lang);
      if (summary) {
        summaries.push(summary);
      } else {
        const snippet = item.snippet.replace(/<[^>]*>/g, '');
        summaries.push(`【${item.title}】${snippet}`);
      }
    }

    return summaries.join('\n\n');
  } catch {
    return null;
  }
}

server.tool(
  'web_search',
  '搜索百科知识，可以查询技术概念、人物、事件、地理等各类信息。数据来源为维基百科，内容权威可靠。',
  {
    query: z.string().describe('搜索关键词或主题名称，例如：React、TypeScript、人工智能、LangChain'),
  },
  async ({ query }) => {
    // 1. 先尝试中文维基百科精确匹配
    const zhSummary = await getWikiSummary(query, 'zh');
    if (zhSummary) {
      return { content: [{ type: 'text' as const, text: zhSummary }] };
    }

    // 2. 中文维基搜索
    const zhSearch = await searchWiki(query, 'zh');
    if (zhSearch) {
      return { content: [{ type: 'text' as const, text: zhSearch }] };
    }

    // 3. 英文维基百科兜底
    const enSummary = await getWikiSummary(query, 'en');
    if (enSummary) {
      return { content: [{ type: 'text' as const, text: enSummary }] };
    }

    const enSearch = await searchWiki(query, 'en');
    if (enSearch) {
      return { content: [{ type: 'text' as const, text: enSearch }] };
    }

    return {
      content: [{ type: 'text' as const, text: `未找到与"${query}"相关的信息。建议尝试更通用或更具体的关键词。` }],
    };
  },
);

// ==================== 3. 启动 Server ====================

/**
 * 使用 stdio 传输方式启动 MCP Server
 *
 * stdio 原理：
 * - MCP Client 会把这个文件作为子进程启动（类似 node tools-server.js）
 * - Client 通过子进程的 stdin 发送请求，通过 stdout 接收响应
 * - 因此这里不能用 console.log 输出调试信息！会干扰 MCP 协议通信
 * - 调试信息请用 console.error（输出到 stderr，不影响协议）
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 注意：用 stderr 输出，不能用 stdout（stdout 是 MCP 协议通道）
  console.error('MCP Tools Server started (stdio transport)');
  console.error('Registered tools: get_weather, get_current_time, web_search');
}

main().catch((error) => {
  console.error('MCP Server failed to start:', error);
  process.exit(1);
});
