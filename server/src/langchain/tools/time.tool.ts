import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 时间查询工具 —— 使用 worldtimeapi.org 开源时间 API
 *
 * API 文档：http://worldtimeapi.org
 * 特点：免费、无需注册、返回标准时区时间
 *
 * 学习要点：
 * - 可选参数用 z.string().optional() 定义
 * - 外部 API 调用要做好降级处理（API 不可用时回退到本地时间）
 */
export const timeTool = tool(
  async ({ timezone }: { timezone?: string }) => {
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

      // worldtimeapi 返回的 datetime 格式: "2026-04-12T15:30:45.123456+08:00"
      const dt = new Date(data.datetime);
      const weekdays = [
        '星期日',
        '星期一',
        '星期二',
        '星期三',
        '星期四',
        '星期五',
        '星期六',
      ];

      const formatted = dt.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      return [
        `时区：${data.timezone}（UTC${data.utc_offset}）`,
        `当前时间：${formatted} ${weekdays[data.day_of_week]}`,
      ].join('，');
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
        return `当前时间（${tz}）：${formatted}（注：由本地系统时钟提供）`;
      } catch {
        return `无法识别时区 "${tz}"，请使用标准 IANA 时区格式，如 Asia/Shanghai、America/New_York、Europe/London`;
      }
    }
  },
  {
    name: 'get_current_time',
    description: '获取当前的日期和时间。可以指定时区来查询世界各地的时间。',
    schema: z.object({
      timezone: z
        .string()
        .optional()
        .describe(
          'IANA 时区名称，如 Asia/Shanghai、America/New_York、Europe/London。不传则默认为中国时间（Asia/Shanghai）',
        ),
    }),
  },
);
