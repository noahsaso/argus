# Feegrant Tracer Implementation

This document describes the complete implementation of the feegrant tracer for the Argus blockchain indexer.

## Overview

The feegrant tracer tracks Cosmos SDK feegrant module state changes, specifically monitoring when fee allowances are granted, revoked, or expire. This allows you to query which addresses have active feegrant allowances to which other addresses.

## Implementation Components

### 1. Database Model: `FeegrantAllowance`

**File**: `src/db/models/FeegrantAllowance.ts`

The main model that stores feegrant allowance relationships:

- **Primary Key**: Composite key of `granter` and `grantee` addresses
- **Fields**:
  - `granter`: Address that granted the allowance
  - `grantee`: Address that received the allowance
  - `blockHeight`: Block height when the allowance was created/updated
  - `blockTimeUnixMs`: Block timestamp in Unix milliseconds
  - `blockTimestamp`: Block timestamp as Date object
  - `allowanceData`: Raw protobuf data of the allowance (base64 encoded)
  - `allowanceType`: Parsed allowance type (nullable, for future enhancement)
  - `active`: Boolean indicating if the allowance is currently active

### 2. Tracer Handler: `feegrant`

**File**: `src/tracer/handlers/feegrant.ts`

The handler that processes blockchain state changes:

- **Store Name**: `feegrant`
- **Key Prefix**: `0x00` (FeeAllowanceKeyPrefix)
- **Key Format**: `0x00 || len(granter) || granter || len(grantee) || grantee`
- **Operations**:
  - `write`: Creates or updates an allowance (sets `active: true`)
  - `delete`: Revokes an allowance (sets `active: false`)

### 3. Database Migrations

**Files**: 
- `src/db/migrations/20250723203900-create-feegrant-allowance.ts`
- `src/db/migrations/20250723204000-add-feegrant-to-state.ts`

Creates the necessary database tables and adds state tracking.

### 4. Type Definitions

**File**: `src/types/tracer.ts`

Added `ParsedFeegrantStateEvent` type for the handler data structure.

**File**: `src/types/db.ts`

Added `FeegrantAllowance` to the `DependentKeyNamespace` enum.

## Usage Examples

### Basic Queries

```typescript
import { FeegrantAllowance } from '@/db'

// Get all allowances granted by an address
const grantedAllowances = await FeegrantAllowance.findAll({
  where: { granter: 'cosmos1abc...', active: true }
})

// Get all allowances received by an address
const receivedAllowances = await FeegrantAllowance.findAll({
  where: { grantee: 'cosmos1xyz...', active: true }
})

// Check if specific allowance exists
const hasAllowance = await FeegrantAllowance.findOne({
  where: {
    granter: 'cosmos1granter...',
    grantee: 'cosmos1grantee...',
    active: true
  }
})
```

### Advanced Queries

See `src/examples/feegrant-usage.ts` for more comprehensive examples including:
- Allowance history tracking
- Statistics and counting
- Batch operations

## Setup Instructions

1. **Run Migrations**: Apply the database migrations to create the necessary tables:
   ```bash
   npm run db:migrate
   ```

2. **Enable Handler**: The feegrant handler is automatically registered in `src/tracer/handlers/index.ts`

3. **Start Tracer**: Run the tracer to begin collecting feegrant data:
   ```bash
   npm run tracer
   ```

## Key Features

### MVP Functionality
- ✅ Track granter → grantee relationships
- ✅ Monitor allowance grants and revocations
- ✅ Query active allowances by granter or grantee
- ✅ Check if specific allowance exists
- ✅ Database indexes for efficient querying

### Future Enhancements
- 🔄 Parse allowance types (BasicAllowance, PeriodicAllowance, etc.)
- 🔄 Track allowance usage/spending events
- 🔄 Add expiration date parsing
- 🔄 Add allowance amount limits parsing

## Database Schema

```sql
CREATE TABLE "FeegrantAllowances" (
  "granter" TEXT NOT NULL,
  "grantee" TEXT NOT NULL,
  "blockHeight" BIGINT NOT NULL,
  "blockTimeUnixMs" BIGINT NOT NULL,
  "blockTimestamp" TIMESTAMP NOT NULL,
  "allowanceData" TEXT NOT NULL,
  "allowanceType" TEXT,
  "active" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("granter", "grantee")
);

-- Indexes
CREATE INDEX ON "FeegrantAllowances" ("granter");
CREATE INDEX ON "FeegrantAllowances" ("grantee");
CREATE INDEX ON "FeegrantAllowances" ("active");
```

## Integration Points

The feegrant tracer integrates with the existing Argus architecture:

- **Handler Registration**: Registered in `src/tracer/handlers/index.ts`
- **Database Models**: Exported from `src/db/models/index.ts`
- **Dependable Events**: Added to `src/db/dependable.ts`
- **State Tracking**: Tracks `lastFeegrantBlockHeightExported` in State model

## Testing

The implementation follows the same patterns as existing handlers (bank, gov, wasm) and should work seamlessly with the existing tracer infrastructure.

To test:
1. Run the tracer on a chain with feegrant activity
2. Check the `FeegrantAllowances` table for data
3. Use the example queries to verify functionality

## Notes

- The handler uses the standard Cosmos SDK feegrant key prefix (`0x00`)
- Address decoding uses the chain's bech32 prefix from configuration
- The implementation uses upsert operations to handle both grants and revocations
- Raw protobuf data is stored for future parsing enhancements
- The `active` field allows tracking of allowance lifecycle without losing history
