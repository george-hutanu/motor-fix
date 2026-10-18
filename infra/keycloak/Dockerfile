# The assistants' identity server on Railway (staging only): Keycloak with the
# realm baked in and imported at start when it does not exist yet. Its
# database, public address and bootstrap admin come from the service's
# variables (README.md); nothing secret is in the image.
#
# Two stages, as Keycloak's container guide builds it: the builder fixes the
# build options (database kind, features, health and metrics on the private
# management port 9000) with `kc.sh build`, so the server starts --optimized
# without re-augmenting on every boot. Persistent user sessions stay on, as
# Keycloak 26 ships them.
FROM quay.io/keycloak/keycloak:26.8 AS builder
ENV KC_DB=postgres KC_FEATURES=cimd,resource-indicators KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.8
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY realm-motorfix-assistants.json /opt/keycloak/data/import/
# The heap follows the container's memory limit, as the guide sizes it: at
# most 70% of it, starting at 50%. The limit itself is the Railway service's
# (1.36-1.5 GB, README.md); a byte cap here would ignore it.
ENV JAVA_OPTS_KC_HEAP="-XX:MaxRAMPercentage=70 -XX:MinRAMPercentage=70 -XX:InitialRAMPercentage=50"
EXPOSE 8080
CMD ["start", "--optimized", "--import-realm", "--proxy-headers=xforwarded", "--http-enabled=true"]
