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
# The slim image has no curl or wget, so probe with Node's built-in fetch. Marks the container unhealthy after
# 3 failed probes; start-period gives the app time to boot before failures count.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/entry.mjs"]
