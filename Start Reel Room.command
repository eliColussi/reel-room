#!/bin/bash
# Double-click this file on a Mac to start Reel Room.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Reel Room needs Node.js (free). Opening the download page..."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Install Node.js, then double-click this file again. Press any key to close."
  exit 1
fi
node server.js
