# 后端 Dockerfile — NestJS 生产构建
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制依赖文件和补丁目录（利用 Docker 缓存层）
# patches/ 必须在 npm ci 之前 COPY，否则 patch-package 的 postinstall 找不到补丁
COPY package*.json ./
COPY patches ./patches
RUN npm ci --legacy-peer-deps

# 复制源码并构建
COPY . .
RUN npm run build

# 生产镜像
FROM node:20-alpine

WORKDIR /app

# 复制 package.json、补丁目录和已打过补丁的 node_modules
# 直接复用 builder 阶段的 node_modules，避免 --omit=dev 导致 patch-package 缺失
COPY package*.json ./
COPY patches ./patches
COPY --from=builder /app/node_modules ./node_modules

# 复制构建产物
COPY --from=builder /app/dist ./dist

EXPOSE 3500

CMD ["node", "dist/main"]
