FROM node:22-alpine
WORKDIR /app

# Dépendances natives (better-sqlite3 a besoin de python/make/g++)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["node", "dist/src/index.js"]
