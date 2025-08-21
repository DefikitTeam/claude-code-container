# syntax=docker/dockerfile:1

FROM node:22-slim AS base

# Install system dependencies needed for Git, Python, and build tools
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set destination for COPY
WORKDIR /app

# Copy package files
COPY container_src/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy container source code
COPY container_src/src/ ./src/

# Create a non-root user for security
RUN addgroup --gid 1001 --system nodejs && \
    adduser --system --uid 1001 nodejs

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
# USER nodejs  # Temporarily disabled for debugging

# Expose port
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["npm", "start"]
