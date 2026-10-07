#!/bin/zsh -il
# Double-click this file to start Hanzi Workshop (opens http://localhost:4200).
cd "$(dirname "$0")"
command -v nvm >/dev/null && nvm use >/dev/null
if ! command -v node >/dev/null; then
  echo "Node.js was not found. Install it from https://nodejs.org and try again."
  read -k1 "?Press any key to close."
  exit 1
fi
[ -d node_modules ] || npm install
npm start
