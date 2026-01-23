package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"cosmossdk.io/log"
	"cosmossdk.io/store/metrics"
	"cosmossdk.io/store/rootmulti"
	"cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"

	"github.com/cosmos/btcutil/bech32"
)

type (
	Metadata struct {
		BlockHeight int64  `json:"blockHeight"`
		TxHash      string `json:"txHash"`
		// Snake case matches `storeNameCtxKey` in `store/cachemulti/store.go` in
		// the Cosmos SDK.
		StoreName string `json:"store_name"`
	}

	// traceOperation implements a traced KVStore operation
	TraceOperation struct {
		Operation string   `json:"operation"`
		Key       string   `json:"key"`
		Value     string   `json:"value"`
		Metadata  Metadata `json:"metadata"`
	}
)

func main() {
	args := os.Args
	if len(args) < 4 {
		fmt.Println("Usage: dump <home_dir> <output> <store_name[:key_prefix_byte_value]> [s:address (very fast) OR address(es)]")
		os.Exit(1)
	}

	home_dir := args[1]
	dataDir := filepath.Join(home_dir, "data")

	output := args[2]

	storeNameParts := strings.SplitN(args[3], ":", 2)
	storeName := storeNameParts[0]

	// parse key prefix as a number (supports both decimal and hex strings) and
	// then convert to a single byte
	keyPrefix := []byte{}
	if len(storeNameParts) > 1 && storeNameParts[1] != "" {
		keyPrefixInt, err := strconv.ParseInt(storeNameParts[1], 0, 8)
		if err != nil {
			panic(err)
		}
		keyPrefix = []byte{byte(keyPrefixInt)}
	}

	var addressesBech32Data [][]byte
	var startKey []byte = nil
	var endKey []byte = nil
	if len(args) > 4 {
		// start at exact contract state key
		if args[4][0] == 's' && args[4][1] == ':' {
			_, bech32Data, err := bech32.DecodeToBase256(args[4][2:])
			if err != nil {
				panic(err)
			}

			// ContractStorePrefix (0x05) || contractAddressBytes || keyBytes
			startKey = append(startKey, byte(0x05))
			startKey = append(startKey, bech32Data...)

			// endKey is the next key after the contract
			endKey = append(startKey, byte(0x05))
			// increment bech32Data by 1
			for i := len(bech32Data) - 1; i >= 0; i-- {
				if bech32Data[i] < 255 {
					bech32Data[i]++
					break
				}
				bech32Data[i] = 0
			}
			endKey = append(endKey, bech32Data...)
		} else {
			// split comma-separated list of addresses
			addresses := strings.Split(args[4], ",")

			for _, address := range addresses {
				_, bech32Data, err := bech32.DecodeToBase256(address)
				if err != nil {
					panic(err)
				}

				addressesBech32Data = append(addressesBech32Data, bech32Data)
			}
		}
	}

	fmt.Printf("Loading data from %s...\n", dataDir)
	fmt.Printf("Writing to %s...\n", output)

	out, err := os.OpenFile(output, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		panic(err)
	}
	defer out.Close()

	db, err := dbm.NewDB("application", dbm.GoLevelDBBackend, dataDir)
	if err != nil {
		panic(err)
	}
	defer db.Close()

	latestHeight := rootmulti.GetLatestVersion(db)
	fmt.Printf("Latest height: %d\n", latestHeight)

	storeKey := types.NewKVStoreKey(storeName)
	ms := rootmulti.NewStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	ms.MountStoreWithDB(storeKey, types.StoreTypeIAVL, nil)

	fmt.Printf("Loading %s store...\n", storeName)
	if len(keyPrefix) > 0 {
		fmt.Printf("Filtering by key prefix: %02x\n", keyPrefix)
	}

	err = ms.LoadLatestVersion()
	if err != nil {
		panic(err)
	}

	store := ms.GetCommitKVStore(storeKey)
	if store == nil {
		panic("Store is nil")
	}

	fmt.Println("Iterating...")

	iter := store.Iterator(startKey, endKey)

	// Dump all keys as write operations.
	exported := 0
	processed := 0
	for ; iter.Valid(); iter.Next() {
		key := iter.Key()

		processed++
		if processed%25000 == 0 {
			fmt.Printf("Processed %d keys\n", processed)
		}

		// Validate with key prefix if provided.
		if len(keyPrefix) > 0 {
			if !bytes.HasPrefix(key, keyPrefix) {
				continue
			}
		}

		// Make sure key is for the given address. Different stores have the address
		// in a different position.
		if len(addressesBech32Data) > 0 {
			if storeName == "wasm" {
				found := false
				for _, addressBech32Data := range addressesBech32Data {
					// Terra Classic has an extra byte before the address, so check
					// starting after 1 or 2.
					if (len(key) > 1 && bytes.HasPrefix(key[1:], addressBech32Data)) || (len(key) > 2 && bytes.HasPrefix(key[2:], addressBech32Data)) {
						found = true
						break
					}
				}

				if !found {
					continue
				}
			} else if storeName == "bank" {
				found := false
				for _, addressBech32Data := range addressesBech32Data {
					if len(key) > 2 && bytes.HasPrefix(key[2:], addressBech32Data) {
						found = true
						break
					}
				}

				if !found {
					continue
				}
			}
		}

		value := iter.Value()
		trace := TraceOperation{
			Operation: "write",
			Key:       base64.StdEncoding.EncodeToString(key),
			Value:     base64.StdEncoding.EncodeToString(value),
			Metadata: Metadata{
				BlockHeight: latestHeight,
				TxHash:      "",
				StoreName:   storeName,
			},
		}

		raw, err := json.Marshal(trace)
		if err != nil {
			panic(err)
		}

		if _, err := out.Write(raw); err != nil {
			panic(err)
		}

		if _, err := out.WriteString("\n"); err != nil {
			panic(err)
		}

		exported++
		if exported == 1 {
			fmt.Println("Exported first key")
		}
		if exported%5000 == 0 {
			fmt.Println("Exported", exported, "keys")
		}
	}

	fmt.Println("Exported", exported, "keys")
}
