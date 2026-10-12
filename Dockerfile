# syntax=docker/dockerfile:1
FROM node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# A platform CA can be supplied as a build secret without putting it in the image.
# TLS and package integrity verification remain enabled.
RUN --mount=type=secret,id=network_ca \
    if [ -f /run/secrets/network_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/network_ca npm ci; else npm ci; fi

FROM node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_ENGINE_URL
ARG NEXT_PUBLIC_FB_APP_ID
ARG NEXT_PUBLIC_FB_API_VERSION=v23.0
ENV NEXT_PUBLIC_ENGINE_URL=$NEXT_PUBLIC_ENGINE_URL \
    NEXT_PUBLIC_FB_APP_ID=$NEXT_PUBLIC_FB_APP_ID \
    NEXT_PUBLIC_FB_API_VERSION=$NEXT_PUBLIC_FB_API_VERSION \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
