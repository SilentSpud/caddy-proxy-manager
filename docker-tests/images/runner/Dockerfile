# The simulated client. Deliberately has no application code from the project —
# it only speaks HTTP/TLS/TCP/UDP, exactly as an outside user would.
FROM alpine:3.21

RUN apk add --no-cache \
      bash \
      ca-certificates \
      coreutils \
      curl \
      openssl \
      jq \
      socat \
      python3 \
      bind-tools \
      netcat-openbsd \
      grep \
      sed \
      diffutils

WORKDIR /suite
ENV BASH_ENV=""
CMD ["sleep", "infinity"]
