FROM node:22-alpine AS builder
WORKDIR /app

# Dépendances de compilation pour better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ═══════════════════════════════════════════════════════════════════
# Image de production
# ═══════════════════════════════════════════════════════════════════
FROM node:22-alpine
WORKDIR /app

# Dépendances natives requises au runtime pour better-sqlite3 et pg
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# Copie uniquement les fichiers compilés
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["node", "dist/src/index.js"]
