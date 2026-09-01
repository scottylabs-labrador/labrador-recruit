# Use Homebrew base image so we can easily install other dependencies in the container.
# This approach gives us more visibility and control over the installation process.
FROM ghcr.io/homebrew/ubuntu24.04:latest

# Switch to root user to install packages
USER root

# Install xdg-utils for OpenBao login
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        xdg-utils && \
    rm -rf /var/lib/apt/lists/*

# Copy everything
COPY . .
