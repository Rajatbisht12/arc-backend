# ---------- Stage 1: Build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first (layer caching)
COPY package*.json ./
RUN npm ci

# Copy source & compile TS → JS
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: Production ----------
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgrp && adduser -S appusr -G appgrp

ENV NODE_ENV=production

# Only production deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output
COPY --from=build /app/dist ./dist

# Legacy JS source is required at runtime (loaded via safeRequire)
COPY --from=build /app/src/legacy-src ./dist/legacy-src

# Security: drop to non-root
USER appusr

EXPOSE 5001

# Graceful shutdown + heap limits
CMD ["node", "--max-old-space-size=1536", "dist/server.js"]
