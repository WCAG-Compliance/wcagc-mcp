FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY newrelic.cjs ./

RUN addgroup -S wcagcmcp && adduser -S wcagcmcp -G wcagcmcp
USER wcagcmcp

EXPOSE 8080
CMD ["node", "--import", "newrelic/esm-loader.mjs", "--require", "newrelic", "dist/hosted.js"]
