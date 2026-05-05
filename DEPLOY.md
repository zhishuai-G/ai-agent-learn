# 部署指南

## 快速启动（Docker Compose）

```bash
# 1. 复制环境变量配置
cp server/.env.example server/.env
# 编辑 server/.env，填入你的 API Key

# 2. 一键启动所有服务
docker-compose up -d

# 3. 访问应用
# 前端：http://localhost
# Swagger API 文档：http://localhost:3500/api-docs
```

## 服务架构

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Nginx     │─────▶│   NestJS    │─────▶│  PostgreSQL │
│  (前端 80)  │      │  (API 3500) │      │  (ragdb)    │
└─────────────┘      └──────┬──────┘      └─────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │    Redis    │
                     │ (checkpointer)│
                     └─────────────┘
```

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `OPENAI_API_KEY` | OneAPI 网关 API Key | `sk-xxx` |
| `OPENAI_BASE_URL` | OneAPI 网关地址 | `https://oneapi.example.com/v1` |
| `OPENAI_MODEL` | 默认模型 | `minimax-m2.7` |
| `REDIS_URL` | Redis 连接地址 | `redis://localhost:6379` |
| `PG_HOST` | PostgreSQL 主机 | `localhost` |
| `PG_DATABASE` | 数据库名 | `ragdb` |
| `LANGCHAIN_TRACING_V2` | 启用 LangSmith 追踪 | `true` / `false` |
| `LANGCHAIN_API_KEY` | LangSmith API Key | `ls-xxx` |

## LangSmith 可观测性

1. 注册：https://smith.langchain.com
2. 获取 API Key
3. 修改 `server/.env`：
   ```
   LANGCHAIN_TRACING_V2=true
   LANGCHAIN_API_KEY=ls-your-key
   ```
4. 重启后端：所有 LangChain/LangGraph 调用自动追踪
