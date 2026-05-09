# 后端 Dockerfile — NestJS 生产构建
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制依赖文件（利用 Docker 缓存层）
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# 复制源码并构建
COPY . .
RUN npm run build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 只复制生产依赖
COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev

# 复制构建产物
COPY --from=builder /app/dist ./dist

EXPOSE 3500

CMD ["node", "dist/main"]
