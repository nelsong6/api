FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# GitHub Packages auth for @nelsong6 scoped packages
ARG NPM_TOKEN
RUN echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc && \
    echo "@nelsong6:registry=https://npm.pkg.github.com" >> .npmrc && \
    npm ci --only=production && \
    rm -f .npmrc

COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
