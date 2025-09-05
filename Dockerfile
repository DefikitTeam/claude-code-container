FROM node:22-alpine

# Install system dependencies for git operations
RUN apk add --no-cache git bash curl

# Set working directory
WORKDIR /app

# Copy container package files
COPY container_src/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy container source code
COPY container_src/src ./src
COPY container_src/tsconfig.json ./

# Build TypeScript to JavaScript
RUN npx tsc

# Health check for container
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Expose the port that the container listens on
EXPOSE 8080

# Start the container server
CMD ["node", "dist/main.js"]