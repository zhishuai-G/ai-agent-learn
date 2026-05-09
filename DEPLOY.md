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

## 增量更新部署（单服务重建）

只改了 `server/` 代码时，不需要重建整个栈。

```bash
# 1. 拉取最新代码
git pull origin develop

# 2. 仅重建 server 镜像（--no-cache 避免缓存层用旧代码）
sudo docker-compose build --no-cache server

# 3. 仅重启 server 容器（postgres/redis/web 不动，连接不中断）
sudo docker-compose up -d server

# 4. 验证
sudo docker ps | grep ai-server
sudo docker logs -f ai-server
```

只改了 `web/` 前端时把上面的 `server` 换成 `web`。

## build / up 命令作用范围速查

| 命令 | 作用范围 |
|---|---|
| `docker-compose build --no-cache` | 重建**所有**带 `build:` 字段的服务（server + web） |
| `docker-compose build --no-cache server` | 只重建 server 镜像 |
| `docker-compose up -d` | 启动/更新**所有**服务（用已有镜像） |
| `docker-compose up -d server` | 只启动/更新 server 容器 |
| `docker-compose up -d --build` | 先 build 再 up，两步合一 |

说明：
- `postgres` / `redis` 用的是 `image:`（官方镜像），`build` 不会触碰，只会在 `up` 时拉取
- `build` 只生成镜像，**不启动容器**；必须再 `up -d` 才会用新镜像替换运行中的容器
- 增量部署单服务时，`build <service>` + `up -d <service>` 组合最安全，不影响其它服务

## 常用运维命令

```bash
# 查看所有容器状态
sudo docker-compose ps

# 查看某服务日志
sudo docker logs -f ai-server        # 实时
sudo docker logs --tail=200 ai-server # 最近 200 行

# 进入容器调试
sudo docker exec -it ai-server sh

# 停止所有服务（保留数据 volume）
sudo docker-compose down

# 停止并清理所有数据（危险：会清空 Redis / PostgreSQL）
sudo docker-compose down -v
```

## 故障排查

### 1. `docker-compose up` 报 `KeyError: 'ContainerConfig'`

症状：
```
ERROR: for ai-server  'ContainerConfig'
KeyError: 'ContainerConfig'
```

原因：服务器上的 `docker-compose v1.29.2`（Python 版）与新版 Docker 镜像元数据格式不兼容，recreate 旧容器时读取 `image_config['ContainerConfig']` 失败。

临时绕过：
```bash
# 手动删除旧容器（注意 compose 会把旧容器重命名为 <hash>_ai-server）
sudo docker ps -a | grep server
sudo docker rm -f ai-server
sudo docker rm -f <hash>_ai-server   # 如果有残留

# 再启动
sudo docker-compose up -d server
```

根治（推荐）：升级到 compose v2 插件版本。
```bash
sudo apt-get update
sudo apt-get install docker-compose-plugin
# 之后命令从 docker-compose 改为 docker compose（空格），yml 不用改
```

### 2. 代码改了但容器行为没变

确认构建时没用缓存：
```bash
sudo docker-compose build --no-cache server
```

确认容器用的是新镜像（看 CREATED 时间）：
```bash
sudo docker ps | grep ai-server
```

### 3. DeepSeek 报 `400 The reasoning_content in the thinking mode must be passed back to the API`

已在 `LangChainService.createModel` 里通过 `configuration.fetch` 拦截出站请求注回 `reasoning_content` 修复。如果再次出现，检查：
- `server/src/langchain/langchain.service.ts` 的 `customFetch` 逻辑是否仍存在
- `reasoningCache` 是否有命中日志（可在 `customFetch` 内加 `console.log` 定位）
