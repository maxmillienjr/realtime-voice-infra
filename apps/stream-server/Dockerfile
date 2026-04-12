FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock* .yarnrc.yml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/stream-server ./apps/stream-server
RUN yarn install --immutable || yarn install
RUN yarn workspaces foreach -Apt run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/stream-server ./apps/stream-server
EXPOSE 3000
CMD ["node", "apps/stream-server/dist/index.js"]
