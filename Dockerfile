# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install Semgrep CLI and git (for repo scanning), plus CA certs
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates \
  && python3 -m venv /opt/semgrep \
  && /opt/semgrep/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/semgrep/bin/pip install --no-cache-dir semgrep \
  && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
  && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Prepare persistence dirs and permissions
RUN mkdir -p /var/data/cryptoscope /var/data/lancedb \
  && chown -R node:node /var/data \
  && chown -R node:node /app
