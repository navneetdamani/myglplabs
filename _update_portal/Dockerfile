FROM node:24.19.0-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.25.0 --ignore-scripts
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY . .
RUN mkdir -p /var/data && chown node:node /var/data
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
