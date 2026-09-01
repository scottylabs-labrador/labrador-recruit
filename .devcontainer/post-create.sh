#!/usr/bin/env zsh
set -e

# Install Bun for JavaScript package management:
# https://bun.com/get
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
echo 'export PATH="$HOME/.bun/bin:$PATH"' >>~/.zshrc

# Activate Bun completions in zsh on startup
if ! grep -q 'source <(SHELL=zsh bun completions)' ~/.zshrc; then
  echo 'source <(SHELL=zsh bun completions)' >>~/.zshrc
fi

# Install Bun dependencies
bun install

# Install Playwright Chromium and OS libraries for end-to-end tests.
# https://playwright.dev/docs/browsers
bunx playwright install chromium --with-deps

# Install OpenBao for secret management.
# Removes the `brew info openbao` command due to errors.
# https://openbao.org/docs/install/
brew install openbao

# Install Secretspec for secret management.
# https://secretspec.dev/docs/installation/
brew install secretspec

# Login to OpenBao to have access to secrets.
bun run secrets

# Build API
bun run build:api

# Run db migrations
cd packages/db && bun run db:migrate

# Install shfmt for shell script formatting
# https://formulae.brew.sh/formula/shfmt
brew install shfmt

# Install editorconfig-checker for linting with EditorConfig
# https://github.com/editorconfig-checker/editorconfig-checker?tab=readme-ov-file#6-using-homebrew
brew install editorconfig-checker

# Install Node.js (e.g. Vitest need a Node runtime).
# https://nodejs.org/
brew install node
