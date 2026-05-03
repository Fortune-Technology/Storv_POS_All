# Build this image from the monorepo root:
#   docker build -f storefront/Dockerfile -t storv-storefront:latest .

FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json ./package.json
COPY packages/types ./packages/types
COPY storefront/package.json ./storefront/package.json

WORKDIR /app/storefront
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_ECOM_API_URL
ARG NEXT_PUBLIC_ECOM_URL
ARG NEXT_PUBLIC_CP_SITE
ARG NEXT_PUBLIC_CP_LIVE

ENV NODE_ENV=production
ENV NEXT_PUBLIC_ECOM_API_URL=${NEXT_PUBLIC_ECOM_API_URL}
ENV NEXT_PUBLIC_ECOM_URL=${NEXT_PUBLIC_ECOM_URL}
ENV NEXT_PUBLIC_CP_SITE=${NEXT_PUBLIC_CP_SITE}
ENV NEXT_PUBLIC_CP_LIVE=${NEXT_PUBLIC_CP_LIVE}

COPY --from=deps /app /app
COPY storefront ./storefront

WORKDIR /app/storefront
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/storefront/.next/standalone ./
COPY --from=builder /app/storefront/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
