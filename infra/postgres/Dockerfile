# The one PostgreSQL every environment runs: Railway's PostgreSQL 18 image,
# whose entrypoint already does SSL, pg_stat_statements and point-in-time
# recovery (README.md), plus PostGIS from the same pgdg repository.
FROM ghcr.io/railwayapp-templates/postgres-ssl:18
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-18-postgis-3 \
  && rm -rf /var/lib/apt/lists/*
# The entrypoint refuses a data directory outside the volume Railway mounts.
ENV PGDATA=/var/lib/postgresql/data/pgdata
