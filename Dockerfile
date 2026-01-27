FROM node:22-alpine

# Force rebuild timestamp: 2026-01-27T14:58:00

# Install system dependencies for git operations and Claude Code requirements
RUN apk add --no-cache git bash curl ripgrep

# Install pnpm globally
RUN npm install -g pnpm@10.18.3

# Create a non-root user for running the application
RUN addgroup -g 1001 -S appuser && \
  adduser -u 1001 -S appuser -G appuser

# Set working directory
WORKDIR /app

# Copy container package files
COPY container_src/package.json container_src/pnpm-lock.yaml ./

# Install all dependencies (including TypeScript for build)
RUN pnpm install --frozen-lockfile

# Copy container source code
COPY container_src/src ./src
COPY container_src/tsconfig.json ./

# Build TypeScript to JavaScript
RUN npx tsc

# Change ownership of app directory to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Health check for container (only for HTTP mode)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD if [ "$ACP_MODE" = "stdio" ]; then exit 0; else curl -f http://localhost:8080/health || exit 1; fi

# Expose the port that the container listens on (for HTTP mode)
EXPOSE 8080

# Set default environment for mode detection
ENV ACP_MODE=http-server

# Start the container server with increased memory limit (1GB for Vercel AI SDK + OpenRouter)
# Exit code 137 (SIGKILL/OOM) indicates container needs more memory
CMD ["node", "--max-old-space-size=1024", "dist/index.js", "--http-server"]