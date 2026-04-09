#!/bin/sh

set -eu

XION_HOME="${XION_HOME:-/xion}"
CHAIN_ID="${CHAIN_ID:-localxion-1}"
DENOM="${DENOM:-uxion}"
MONIKER="${MONIKER:-local-validator}"
VALIDATOR_MNEMONIC="${VALIDATOR_MNEMONIC:-decorate bright ozone fork gallery riot bus exhaust worth way bone indoor calm squirrel merry zero scheme cotton until shop any excess stage laundry}"

mkdir -p "$XION_HOME"

if [ ! -f "$XION_HOME/config/genesis.json" ]; then
  xiond init "$MONIKER" \
    --chain-id "$CHAIN_ID" \
    --default-denom "$DENOM" \
    --home "$XION_HOME" \
    --overwrite >/dev/null

  printf '%s\n' "$VALIDATOR_MNEMONIC" | xiond keys add validator \
    --recover \
    --keyring-backend test \
    --home "$XION_HOME" >/dev/null

  xiond genesis add-genesis-account validator "100000000000${DENOM}" \
    --keyring-backend test \
    --home "$XION_HOME" >/dev/null

  xiond genesis gentx validator "100000000${DENOM}" \
    --chain-id "$CHAIN_ID" \
    --keyring-backend test \
    --home "$XION_HOME" >/dev/null

  xiond genesis collect-gentxs --home "$XION_HOME" >/dev/null

  sed -i "s/^minimum-gas-prices = .*/minimum-gas-prices = \"0${DENOM}\"/" \
    "$XION_HOME/config/app.toml"
  sed -i 's/^timeout_commit = .*/timeout_commit = "1s"/' \
    "$XION_HOME/config/config.toml"
  sed -i 's/^timeout_propose = .*/timeout_propose = "1s"/' \
    "$XION_HOME/config/config.toml"
  sed -i 's/^timeout_prevote = .*/timeout_prevote = "500ms"/' \
    "$XION_HOME/config/config.toml"
  sed -i 's/^timeout_precommit = .*/timeout_precommit = "500ms"/' \
    "$XION_HOME/config/config.toml"
fi

exec xiond start \
  --home "$XION_HOME" \
  --minimum-gas-prices "0${DENOM}" \
  --rpc.laddr tcp://0.0.0.0:26657 \
  --log_level warn
