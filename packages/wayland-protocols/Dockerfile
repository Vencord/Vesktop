# Dockerfile for building both x64 and arm64 on an old distro for maximum compatibility.

FROM debian:11
ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/root/.cargo/bin:${PATH}"
ENV CARGO_HOME="/root/.cargo"
ENV RUSTUP_HOME="/root/.rustup"

RUN apt-get update && apt-get install -y \
    build-essential python3 curl pkg-config \
    libwayland-dev ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# for cargo-zigbuild, used for cross-compilation
RUN curl -L https://ziglang.org/download/0.11.0/zig-linux-x86_64-0.11.0.tar.xz \
  | tar -xJ \
 && mv zig-linux-x86_64-0.11.0 /opt/zig \
 && ln -s /opt/zig/zig /usr/local/bin/zig

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get update && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal

RUN corepack enable

WORKDIR /src
