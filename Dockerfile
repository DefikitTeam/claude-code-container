FROM node:22-alpine

# Install system dependencies for git operations
RUN apk add --no-cache git bash curl

# Set working directory
WORKDIR /app

# Copy container package files
COPY container_src/package*.json ./

# Install all dependencies (including TypeScript for build)
RUN npm ci

# Copy container source code
COPY container_src/src ./src
COPY container_src/tsconfig.json ./

# Build TypeScript to JavaScript
RUN npx tsc

# Health check for container (only for HTTP mode)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD if [ "$ACP_MODE" = "stdio" ]; then exit 0; else curl -f http://localhost:8080/health || exit 1; fi

# Expose the port that the container listens on (for HTTP mode)
EXPOSE 8080

# Set default environment for mode detection
ENV ACP_MODE=auto

# Start the container server with automatic mode detection
CMD ["node", "dist/main.js"]