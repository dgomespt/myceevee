# ---- build ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/myceevee.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# /data is the only place the app writes. World-writable so the container also works with `--user <uid>:<gid>`
# (any non-root UID); the port is above 1024 so no root or capabilities are needed to bind it.
RUN mkdir -p /data && chown node:node /data && chmod 0777 /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/server/entry.mjs"]
