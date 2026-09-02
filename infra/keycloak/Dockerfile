# Keycloak for deployments that cannot use the ScottyLabs identity provider.
#
# Registering an OIDC client on idp.scottylabs.org goes through Goldador and
# needs ScottyLabs organisation access. This image gives a deployment its own
# provider in the meantime, so the whole sign-in path can be built and proven
# before that access exists. Nothing in the application changes when it does:
# AUTH_ISSUER, AUTH_CLIENT_ID and AUTH_CLIENT_SECRET are read from the
# environment, so switching providers is three variable edits.

# Keycloak runs on Quarkus, which wants an augmentation pass before it can
# serve. Doing that at startup ("--optimized=false") re-ran it on every boot and
# the container was OOM-killed mid-augmentation, restarting forever. Building
# the image here instead means startup only has to load it.
FROM quay.io/keycloak/keycloak:26.4 AS builder
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.4
COPY --from=builder /opt/keycloak/ /opt/keycloak/

# The database lives on the project's existing Postgres, in its own `keycloak`
# database rather than beside the application tables.
ENV KC_DB=postgres

# Railway terminates TLS at its edge and forwards over plain HTTP, so Keycloak
# has to be told to trust the forwarded protocol headers. Without this it builds
# redirect URLs with http:// and the browser refuses the callback.
ENV KC_HTTP_ENABLED=true
ENV KC_PROXY_HEADERS=xforwarded
ENV KC_HEALTH_ENABLED=true

# Keycloak's default sizing asks for 70% of the container as heap and allows a
# further 256MB of metaspace on top. Railway gives this service ~953MB, so those
# defaults overshoot it and the OOM killer took the process during database
# startup - repeatedly, with no Java OutOfMemoryError to explain it, because
# SIGKILL leaves no stack trace. Fixed sizes that add up to well under the limit
# are what makes it boot; the realm is a handful of users and needs nothing like
# the default headroom.
ENV JAVA_OPTS_KC_HEAP="-Xms128m -Xmx448m"
ENV JAVA_OPTS_APPEND="-XX:MaxMetaspaceSize=192m"

EXPOSE 8080

# `start` rather than `start-dev`: dev mode uses an in-memory H2 database, and
# losing the realm on every redeploy would take the client secret with it.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--http-port=8080"]
