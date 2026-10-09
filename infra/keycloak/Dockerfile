# The assistants' identity server on Railway (staging only): Keycloak with the
# realm baked in and imported at start when it does not exist yet. Its
# database, public address and bootstrap admin come from the service's
# variables (README.md); nothing secret is in the image.
FROM quay.io/keycloak/keycloak:26.8
COPY realm-motorfix-assistants.json /opt/keycloak/data/import/
# A small heap keeps the staging service within a few dollars a month.
ENV JAVA_OPTS_KC_HEAP="-Xms128m -Xmx512m"
EXPOSE 8080
CMD ["start", "--import-realm", "--features=cimd,resource-indicators", "--proxy-headers=xforwarded", "--http-enabled=true"]
