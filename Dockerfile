FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=0.0.0.0 \
    CAREER_DB_PATH=/var/lib/career-navigator/career.db

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/data ./data
COPY --from=builder --chown=node:node /app/scripts/start.mjs ./scripts/start.mjs
COPY --from=builder --chown=node:node /app/scripts/backup-db.mjs ./scripts/backup-db.mjs
COPY --from=builder --chown=node:node /app/scripts/restore-db.mjs ./scripts/restore-db.mjs

RUN mkdir -p /var/lib/career-navigator /backups \
    && chown -R node:node /var/lib/career-navigator /backups

USER node
EXPOSE 3000
CMD ["npm", "start"]
