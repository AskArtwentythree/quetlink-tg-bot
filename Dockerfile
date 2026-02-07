# Сборка и запуск бота для деплоя на Fly.io или любой хостинг с Docker
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/build ./build
COPY --from=builder /app/data ./data
COPY --from=builder /app/images ./images
ENV NODE_ENV=production
CMD ["node", "--no-deprecation", "build/index.js"]
