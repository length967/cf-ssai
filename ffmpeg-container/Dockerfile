FROM node:20-alpine

# Install FFmpeg and other dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    ca-certificates

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install Node.js dependencies
RUN npm install --production

# Copy application code
COPY server.js ./
COPY transcode.js ./

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server
CMD ["node", "server.js"]

