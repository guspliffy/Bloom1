# Build from the repository root so the game's rules (src/core) are in the build context:
#   docker build -f server/Dockerfile -t bloom-leaderboard .
#   docker run -d --name bloom-leaderboard --restart unless-stopped \
#     -p 127.0.0.1:8787:8787 -v bloom-data:/data \
#     -e ALLOWED_ORIGINS=https://guspliffy.github.io -e TRUST_PROXY=1 bloom-leaderboard
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY config ./config
COPY src ./src
COPY server ./server
RUN node server/build.mjs

FROM node:22-slim
ENV HOST=0.0.0.0 PORT=8787 DB_PATH=/data/bloom.sqlite NODE_ENV=production
COPY --from=build /app/server/dist/server.mjs /app/server.mjs
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "/app/server.mjs"]
