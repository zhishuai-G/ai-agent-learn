import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 搜索工具 —— 使用 Wikipedia REST API
 *
 * API 文档：https://www.mediawiki.org/wiki/REST_API
 * 特点：免费、无需 API Key、支持中英文、内容权威可靠
 *
 * 搜索策略：
 * 1. 先尝试中文维基百科精确匹配（/page/summary）
 * 2. 如果没结果，进行中文维基搜索（/w/api.php?action=query）
 * 3. 最后尝试英文维基百科作为兜底
 *
 * 学习要点：
 * - 工具的 description 要写清楚"能做什么"和"不能做什么"
 * - 实际项目中这里可以替换为搜索引擎 API、向量数据库、RAG 检索等
 */

/**
 * 从维基百科获取页面摘要
 */
async function getWikiSummary(
  query: string,
  lang: 'zh' | 'en',
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'AIAgentLearn/1.0 (learning project)',
        },
      },
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.type === 'standard' && data.extract) {
      return `【${data.title}】${data.extract}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 在维基百科中搜索相关条目
 */
async function searchWiki(
  query: string,
  lang: 'zh' | 'en',
  limit = 3,
): Promise<string | null> {
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
        headers: {
          'User-Agent': 'AIAgentLearn/1.0 (learning project)',
        },
      },
    );
    if (!res.ok) return null;

    const data = await res.json();
    const results = data.query?.search;
    if (!results || results.length === 0) return null;

    // 获取搜索结果的摘要
    const summaries: string[] = [];
    for (const item of results) {
      const summary = await getWikiSummary(item.title, lang);
      if (summary) {
        summaries.push(summary);
      } else {
        // 用搜索结果中的 snippet（去掉 HTML 标签）作为兜底
        const snippet = item.snippet.replace(/<[^>]*>/g, '');
        summaries.push(`【${item.title}】${snippet}`);
      }
    }

    return summaries.join('\n\n');
  } catch {
    return null;
  }
}

export const searchTool = tool(
  async ({ query }: { query: string }) => {
    // 1. 先尝试中文维基百科精确匹配
    const zhSummary = await getWikiSummary(query, 'zh');
    if (zhSummary) return zhSummary;

    // 2. 中文维基搜索
    const zhSearch = await searchWiki(query, 'zh');
    if (zhSearch) return zhSearch;

    // 3. 英文维基百科兜底
    const enSummary = await getWikiSummary(query, 'en');
    if (enSummary) return enSummary;

    const enSearch = await searchWiki(query, 'en');
    if (enSearch) return enSearch;

    return `未找到与"${query}"相关的信息。建议尝试更通用或更具体的关键词。`;
  },
  {
    name: 'web_search',
    description:
      '搜索百科知识，可以查询技术概念、人物、事件、地理等各类信息。数据来源为维基百科，内容权威可靠。',
    schema: z.object({
      query: z
        .string()
        .describe('搜索关键词或主题名称，例如：React、TypeScript、人工智能、LangChain'),
    }),
  },
);
