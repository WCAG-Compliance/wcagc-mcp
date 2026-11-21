FROM --platform=$BUILDPLATFORM node:24.22.3-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.22.3-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# npm is only needed for this install; the container runs node directly. Dropping it removes npm's
# bundled undici/brace-expansion copies, which image scans flag and nothing at runtime uses.
RUN npm ci --omit=dev && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY newrelic.cjs ./

RUN addgroup -S wcagcmcp && adduser -S wcagcmcp -G wcagcmcp
USER wcagcmcp

EXPOSE 8080
CMD ["node", "--import", "newrelic/esm-loader.mjs", "--require", "newrelic", "dist/hosted.js"]
