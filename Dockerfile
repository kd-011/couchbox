FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs ./
COPY bin ./bin
COPY lib ./lib
COPY public ./public
COPY games ./games
# Custom packs and the voice cache are the only things this app writes to disk.
RUN mkdir -p /data /app/data && chown node /data /app/data
ENV GAMES_HOST=0.0.0.0 GAMES_PACKS_DIR=/data
USER node
EXPOSE 8969
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GAMES_PORT||8969)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
