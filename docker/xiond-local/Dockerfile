FROM debian:bookworm-slim

ARG XIOND_VERSION=28.1.0-rc1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar \
  && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
    amd64) xion_arch="amd64" ;; \
    arm64) xion_arch="arm64" ;; \
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
  esac \
  && curl -fsSL \
    "https://github.com/burnt-labs/xion/releases/download/v${XIOND_VERSION}/xiond_${XIOND_VERSION}_linux_${xion_arch}.tar.gz" \
    -o /tmp/xiond.tar.gz \
  && tar -xzf /tmp/xiond.tar.gz -C /usr/local/bin xiond \
  && chmod +x /usr/local/bin/xiond \
  && rm -f /tmp/xiond.tar.gz

COPY docker/xiond-local/start.sh /usr/local/bin/start-xiond

RUN chmod +x /usr/local/bin/start-xiond

EXPOSE 26657

CMD ["start-xiond"]
