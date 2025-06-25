#!/bin/bash
./node_modules/.bin/dotenv -- bash -c "./node_modules/.bin/infisical run --token \$INFISICAL_TOKEN --projectId \$INFISICAL_PROJECT_ID --env \$INFISICAL_ENVIRONMENT -- $@"