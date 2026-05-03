# Build this image from the monorepo root:
#   docker build -f backend/Dockerfile -t storv-backend:latest .

FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    ghostscript \
    graphicsmagick \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./package.json
COPY packages/redis ./packages/redis
COPY packages/queue ./packages/queue
COPY backend/package.json ./backend/package.json
COPY backend/prisma ./backend/prisma

WORKDIR /app/backend
RUN npm install && npx prisma generate && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    ghostscript \
    graphicsmagick \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5000

COPY --from=deps /app /app
COPY backend ./backend

RUN mkdir -p /app/backend/uploads/product-images /app/backend/uploads/quick-buttons /app/backend/uploads/temp

WORKDIR /app/backend

EXPOSE 5000

CMD ["npm", "start"]
