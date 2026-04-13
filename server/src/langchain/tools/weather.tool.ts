import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 天气查询工具 —— 使用 wttr.in 开源天气 API
 *
 * API 文档：https://wttr.in/:help
 * 特点：免费、无需 API Key、支持中文城市名、返回 JSON
 *
 * 学习要点：
 * - tool() 函数定义工具：传入执行函数 + 元信息
 * - schema 用 Zod 定义参数类型，LLM 会严格按 schema 生成参数
 * - description 非常重要：LLM 靠它决定"什么时候该调用这个工具"
 * - 真实 API 调用需要做好超时和错误处理
 */
export const weatherTool = tool(
  async ({ city }: { city: string }) => {
    try {
      // wttr.in 的 JSON 接口：format=j1 返回结构化天气数据
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
        return `未能获取 ${city} 的天气数据`;
      }

      // 中文天气描述在 lang_zh 字段中
      const desc =
        current.lang_zh?.[0]?.value ||
        current.weatherDesc?.[0]?.value ||
        '未知';

      return [
        `${city}当前天气：${desc}`,
        `温度：${current.temp_C}°C（体感 ${current.FeelsLikeC}°C）`,
        `湿度：${current.humidity}%`,
        `风：${current.winddir16Point} ${current.windspeedKmph} km/h`,
        `能见度：${current.visibility} km`,
        `紫外线指数：${current.uvIndex}`,
      ].join('，');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `获取 ${city} 天气失败：${msg}。请检查城市名称是否正确。`;
    }
  },
  {
    name: 'get_weather',
    description:
      '获取指定城市的实时天气信息，包括温度、体感温度、湿度、风向风速、能见度等。支持全球城市。',
    schema: z.object({
      city: z
        .string()
        .describe('城市名称，支持中文或英文，例如：北京、上海、Tokyo、New York'),
    }),
  },
);
