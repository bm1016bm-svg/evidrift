FROM node:22-alpine

WORKDIR /app

COPY . .
RUN npm ci --ignore-scripts \
    && npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production
USER node

ENTRYPOINT ["node", "dist/src/cli.js", "mcp"]
