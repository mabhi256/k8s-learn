# Build stage: codegen + compile (needs all devDeps)
FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run generate:proto
RUN npm run build

# Runtime stage: prod deps + compiled output only
FROM node:26-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 50051
CMD ["node", "dist/src/server.js"]