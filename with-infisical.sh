#!/bin/bash
# The Infisical CLI reads INFISICAL_TOKEN from the environment (exported by
# dotenv from .env). Never pass the token with --token: command line arguments
# are visible to every local user in /proc/<pid>/cmdline.
./node_modules/.bin/dotenv -- bash -c "./node_modules/.bin/infisical run --projectId \$INFISICAL_PROJECT_ID --env \$INFISICAL_ENVIRONMENT -- $@"