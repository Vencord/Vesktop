# Dockerfile for building both x64 and arm64 on an old distro for maximum compatibility.

#  ubuntu20 is dead but debian11 is still supported for now
FROM debian:11
ENV DEBIAN_FRONTEND=noninteractive

RUN dpkg --add-architecture arm64

RUN apt-get update && apt-get install -y \
    build-essential python3 curl pkg-config \
    g++-aarch64-linux-gnu libglib2.0-dev:amd64 libglib2.0-dev:arm64 \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get update && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
