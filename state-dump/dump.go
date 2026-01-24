package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
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
	// Define command line flags
	homeDir := flag.String("home", "", "Home directory for chain data (required)")
	output := flag.String("output", "", "Output file path (required)")
	storeName := flag.String("store", "", "Store name (e.g., wasm, bank) (required)")
	startAddr := flag.String("start-addr", "", "Start address for range iteration (bech32 address)")
	endAddr := flag.String("end-addr", "", "End address for range iteration (bech32 address)")
	startPrefixHex := flag.String("start-prefix", "", "Start key as hex string (e.g., 03abcd)")
	endPrefixHex := flag.String("end-prefix", "", "End key as hex string (e.g., 03abce)")
	autoEnd := flag.Bool("auto-end", true, "Auto-calculate end key from start (set to false to iterate to end of store)")
	addressesStr := flag.String("addresses", "", "Comma-separated list of bech32 addresses to filter by")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: dump [options]\n\n")
		fmt.Fprintf(os.Stderr, "Dumps state from a Cosmos SDK chain database.\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  # Dump entire wasm store\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm\n\n")
		fmt.Fprintf(os.Stderr, "  # Dump single contract state (fast range query)\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm -start-addr <contract_address>\n\n")
		fmt.Fprintf(os.Stderr, "  # Dump from start address to end of store (disable auto-end)\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm -start-addr <contract_address> -auto-end=false\n\n")
		fmt.Fprintf(os.Stderr, "  # Dump specific addresses (filters all keys)\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm -addresses addr1,addr2,addr3\n\n")
		fmt.Fprintf(os.Stderr, "  # Combine range query with address filter\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm -start-addr <addr1> -end-addr <addr2> -addresses addr1,addr2\n\n")
		fmt.Fprintf(os.Stderr, "  # Dump using hex prefix (auto-calculates end)\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm -start-prefix 03\n\n")
		fmt.Fprintf(os.Stderr, "  # Dump using explicit hex start/end range\n")
		fmt.Fprintf(os.Stderr, "  dump -home /path/to/.chain -output dump.json -store wasm -start-prefix 03abcd -end-prefix 03abce\n")
	}

	flag.Parse()

	// Validate required flags
	if *homeDir == "" {
		fmt.Fprintln(os.Stderr, "Error: -home is required")
		flag.Usage()
		os.Exit(1)
	}
	if *output == "" {
		fmt.Fprintln(os.Stderr, "Error: -output is required")
		flag.Usage()
		os.Exit(1)
	}
	if *storeName == "" {
		fmt.Fprintln(os.Stderr, "Error: -store is required")
		flag.Usage()
		os.Exit(1)
	}

	// Validate mutually exclusive flags
	hasAddrRange := *startAddr != "" || *endAddr != ""
	hasHexRange := *startPrefixHex != "" || *endPrefixHex != ""

	if hasAddrRange && hasHexRange {
		fmt.Fprintln(os.Stderr, "Error: -start-addr/-end-addr and -start-prefix/-end-prefix are mutually exclusive")
		flag.Usage()
		os.Exit(1)
	}

	dataDir := filepath.Join(*homeDir, "data")

	// Parse start/end keys for range iteration
	var startKey []byte = nil
	var endKey []byte = nil

	// Parse hex start/end prefixes
	if *startPrefixHex != "" {
		hexStr := strings.TrimPrefix(*startPrefixHex, "0x")
		var err error
		startKey, err = hex.DecodeString(hexStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error decoding start-prefix hex: %v\n", err)
			os.Exit(1)
		}

		// If no end prefix specified and auto-end is enabled, calculate end key
		if *endPrefixHex == "" && *autoEnd {
			endKey = make([]byte, len(startKey))
			copy(endKey, startKey)
			for i := len(endKey) - 1; i >= 0; i-- {
				if endKey[i] < 255 {
					endKey[i]++
					break
				}
				endKey[i] = 0
				// If we've wrapped all bytes to 0, the end key should be nil (iterate to end)
				if i == 0 {
					endKey = nil
				}
			}
		}
	}

	if *endPrefixHex != "" {
		hexStr := strings.TrimPrefix(*endPrefixHex, "0x")
		var err error
		endKey, err = hex.DecodeString(hexStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error decoding end-prefix hex: %v\n", err)
			os.Exit(1)
		}
	}

	if *startAddr != "" {
		_, bech32Data, err := bech32.DecodeToBase256(*startAddr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error decoding start address: %v\n", err)
			os.Exit(1)
		}

		// ContractStorePrefix (0x03) || contractAddressBytes
		startKey = append(startKey, byte(0x03))
		startKey = append(startKey, bech32Data...)

		// If no end address specified and auto-end is enabled, calculate end key as next key after start address
		if *endAddr == "" && *autoEnd {
			endKey = append(endKey, byte(0x03))
			// Copy and increment bech32Data by 1
			incrementedData := make([]byte, len(bech32Data))
			copy(incrementedData, bech32Data)
			for i := len(incrementedData) - 1; i >= 0; i-- {
				if incrementedData[i] < 255 {
					incrementedData[i]++
					break
				}
				incrementedData[i] = 0
			}
			endKey = append(endKey, incrementedData...)
		}
	}

	if *endAddr != "" {
		_, bech32Data, err := bech32.DecodeToBase256(*endAddr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error decoding end address: %v\n", err)
			os.Exit(1)
		}

		endKey = nil // Reset in case it was set from start address
		endKey = append(endKey, byte(0x03))
		endKey = append(endKey, bech32Data...)
	}

	// Parse addresses to filter by
	var addressesBech32Data [][]byte
	if *addressesStr != "" {
		addresses := strings.Split(*addressesStr, ",")
		for _, address := range addresses {
			address = strings.TrimSpace(address)
			if address == "" {
				continue
			}
			_, bech32Data, err := bech32.DecodeToBase256(address)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error decoding address %s: %v\n", address, err)
				os.Exit(1)
			}
			addressesBech32Data = append(addressesBech32Data, bech32Data)
		}
	}

	fmt.Printf("Loading data from %s...\n", dataDir)
	fmt.Printf("Writing to %s...\n", *output)

	out, err := os.OpenFile(*output, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
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

	storeKey := types.NewKVStoreKey(*storeName)
	ms := rootmulti.NewStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	ms.MountStoreWithDB(storeKey, types.StoreTypeIAVL, nil)

	fmt.Printf("Loading %s store...\n", *storeName)
	if startKey != nil {
		fmt.Printf("Start key: %x\n", startKey)
	}
	if endKey != nil {
		fmt.Printf("End key: %x\n", endKey)
	}
	if len(addressesBech32Data) > 0 {
		fmt.Printf("Filtering by %d address(es)\n", len(addressesBech32Data))
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

		// Make sure key is for the given address. Different stores have the address
		// in a different position.
		if len(addressesBech32Data) > 0 {
			if *storeName == "wasm" {
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
			} else if *storeName == "bank" {
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
				StoreName:   *storeName,
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
