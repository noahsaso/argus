#!/bin/sh
# Renew the Infisical access token in .env (run daily by the PM2
# renew-infisical-token app). The Node script sends the token in an HTTPS
# request body and rewrites .env atomically with mode 600, so the token never
# appears on a command line or in the logs.
exec node infisical/renew.mjs "$@"
