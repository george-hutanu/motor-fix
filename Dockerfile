# One image per app:
#   docker build --build-arg APP=web --target web .
#   docker build --build-arg APP=<api|worker|mcp> --target node-app .
# Keep in step with .nvmrc.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY libs/domain/prisma.config.ts libs/domain/prisma.config.ts
COPY libs/domain/prisma libs/domain/prisma
# The repo's own install hooks set up git and need .husky; the build needs
# only the Prisma client.
RUN npm ci --ignore-scripts \
 && npx prisma generate --config libs/domain/prisma.config.ts
COPY . .
ARG APP
RUN npx nx run ${APP}:build --configuration=production
# The web server is fully bundled; the Node apps install the dependencies
# their build listed in its own package.json and lockfile.
RUN cd dist/apps/${APP} && if [ -f package-lock.json ]; then npm ci --omit=dev; fi
# The api's pre-deploy step runs the migrations from inside its image.
RUN if [ "${APP}" = api ]; then \
      cp -r libs/domain/prisma libs/domain/prisma.config.ts dist/apps/api/; fi

FROM node:${NODE_VERSION}-slim AS runtime
ARG APP
ARG RELEASE_SHA=dev
ENV NODE_ENV=production RELEASE_SHA=${RELEASE_SHA} TZ=UTC
COPY --from=build --chown=node:node /repo/dist/apps/${APP} /app
WORKDIR /app
USER node

# Angular's server only listens when it is the script Node was started with.
FROM runtime AS web
CMD ["node", "server/server.mjs"]

FROM runtime AS node-app
CMD ["node", "main.js"]
