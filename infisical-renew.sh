#!/bin/sh

echo "🔄 Renewing token at $(date)..."

# get the token from the .env file
INFISICAL_TOKEN=$(grep '^INFISICAL_TOKEN=' .env | cut -d '=' -f 2)

NEW_TOKEN=$(npx @infisical/cli token renew $INFISICAL_TOKEN | grep '^ey')

if [ -z "$NEW_TOKEN" ]; then
  echo "❌ Failed to renew token at $(date)"
  exit 1
fi

# replace the token in the .env file
sed -i "s/^INFISICAL_TOKEN=.*/INFISICAL_TOKEN=$NEW_TOKEN/" .env

echo "✅ Renewed token successfully at $(date)"
