# Build stage
FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# ci: clean install
# - deletes existing node_modules
# - throws an error if lockfile is out of sync with your package.json
# - never alters package.json or lockfile
# omit-dev: skip dev dependencies
RUN npm ci --omit=dev

# Runtime stage
FROM node:26-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
EXPOSE 3000
CMD [ "node", "src/index.js" ]