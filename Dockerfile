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
# The web build's source maps never reach the image: the browser's go to the
# web-maps stage, which the release uploads to the error collector; the web
# server's are deleted. The Node apps keep theirs beside main.js, so a thrown
# error's stack names the .ts line (node-app below).
RUN mkdir /maps && if [ "${APP}" = web ]; then \
      find dist/apps/web/browser -name '*.map' -exec mv {} /maps/ \; \
      && find dist/apps/web -name '*.map' -delete; fi
# The api's pre-deploy step runs the migrations from inside its image, and
# the staging reset (.github/workflows/reset-staging.yml) runs the seed there:
# one file, run by Node as it is, with pg already among the api's dependencies.
# The same step then sets the monitor role's password (monitor-password.ts).
RUN if [ "${APP}" = api ]; then \
      cp -r libs/domain/prisma libs/domain/prisma.config.ts dist/apps/api/ \
      && mkdir -p dist/apps/api/src dist/apps/api/scripts \
      && cp libs/domain/src/seed.ts dist/apps/api/src/ \
      && cp scripts/monitor-password.ts dist/apps/api/scripts/; fi

FROM scratch AS web-maps
COPY --from=build /maps /

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
ENV NODE_OPTIONS=--enable-source-maps
CMD ["node", "main.js"]
