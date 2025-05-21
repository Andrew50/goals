#!/bin/bash
set -e

# This script installs Docker, Docker Compose plugin, Node.js, and Rust.
# It is intended for Debian/Ubuntu based systems.

if [ "$EUID" -ne 0 ]; then
    echo "Please run this script as root (use sudo)" >&2
    exit 1
fi

# Update package lists
apt-get update

# Install prerequisites for Docker if not present
apt-get install -y ca-certificates curl gnupg lsb-release

# Install Docker if it is not already installed
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
  $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Install Node.js 18 if not already installed
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Install Rust using rustup if not already installed
if ! command -v rustc >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

echo "Setup complete. Docker, docker compose, Node.js, and Rust are installed."

