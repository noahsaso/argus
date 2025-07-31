# Feegrant Module Implementation

This document describes the complete implementation of the feegrant module for
the Argus blockchain indexer, providing comprehensive tracking of Cosmos SDK
feegrant allowances with full historical data and formula integration.

## Overview

The feegrant module tracks Cosmos SDK feegrant module state changes, monitoring
when fee allowances are granted, updated, revoked, or expire. It provides both
raw data access and convenient formula functions for querying allowance
relationships with full historical tracking.

## Implementation Components

### 1. Database Model: `FeegrantAllowance`

**File**: `src/db/models/FeegrantAllowance.ts`

The main model that stores feegrant allowance relationships with full historical
tracking:

- **Primary Key**: Composite key of `(granter, grantee, blockHeight)` for
  historical tracking
- **Fields**:
  - `granter`: Address that granted the allowance
  - `grantee`: Address that received the allowance
  - `blockHeight`: Block height when this event occurred
  - `blockTimeUnixMs`: Block timestamp in Unix milliseconds
  - `blockTimestamp`: Block timestamp as Date object
  - `allowanceData`: Raw protobuf data of the allowance (base64 encoded)
  - `allowanceType`: Parsed allowance type (nullable, for future enhancement)
  - `active`: Boolean indicating if the allowance is currently active

**Key Methods**:

- `getPreviousEvent()`: Get the previous allowance event for this
  granter-grantee pair
- `dependentKey`: Generate cache key for this allowance
- `getWhereClauseForDependentKeys()`: Static method for efficient dependent key
  queries

### 2. Tracer Handler: `feegrant`

**File**: `src/tracer/handlers/feegrant.ts`

The handler that processes blockchain state changes with historical tracking:

- **Store Name**: `feegrant`
- **Key Prefix**: `0x00` (FeeAllowanceKeyPrefix)
- **Key Format**: `0x00 || len(granter) || granter || len(grantee) || grantee`
- **Operations**:
  - `write`: Creates a new allowance record (sets `active: true`)
  - `delete`: Creates a revocation record (sets `active: false`)

### 3. Formula Environment Functions

**File**: `src/formulas/env.ts`

Three convenient functions available in all formulas:

#### `getFeegrantAllowance(granter: string, grantee: string)`

Get the most recent allowance between two addresses.

```typescript
const allowance = await env.getFeegrantAllowance(
  'xion1granter...',
  'xion1grantee...'
)
if (allowance?.active) {
  console.log(`Allowance granted at block ${allowance.blockHeight}`)
  console.log(`Allowance type: ${allowance.allowanceType}`)
}
```

#### `getFeegrantAllowances(address: string, type?: 'granted' | 'received')`

Get all active allowances for an address (defaults to 'granted').

```typescript
// Get all allowances granted by an address
const granted = await env.getFeegrantAllowances('xion1granter...', 'granted')

// Get all allowances received by an address
const received = await env.getFeegrantAllowances('xion1grantee...', 'received')

// Default behavior (granted)
const defaultGranted = await env.getFeegrantAllowances('xion1granter...')
```

#### `hasFeegrantAllowance(granter: string, grantee: string)`

Quick boolean check for active allowance.

```typescript
const hasAllowance = await env.hasFeegrantAllowance(
  'xion1granter...',
  'xion1grantee...'
)
if (hasAllowance) {
  // Process transaction with fee grant
}
```

## Usage Examples

### Formula Environment Usage

```typescript
// In any formula (account, contract, generic, validator)
export const myFormula: GenericFormula = {
  async compute(env) {
    // Check if address has any active allowances
    const grantedAllowances = await env.getFeegrantAllowances('xion1granter...')

    // Check specific allowance
    const hasAllowance = await env.hasFeegrantAllowance(
      'xion1granter...',
      'xion1grantee...'
    )

    // Get detailed allowance info
    const allowance = await env.getFeegrantAllowance(
      'xion1granter...',
      'xion1grantee...'
    )

    return {
      totalGranted: grantedAllowances?.length || 0,
      hasSpecificAllowance: hasAllowance,
      allowanceDetails: allowance,
    }
  },
  docs: {
    description: 'Example feegrant usage in formula',
  },
}
```

### Direct Database Queries

```typescript
import { FeegrantAllowance } from '@/db'

// Get current active allowances for an address
const activeAllowances = await FeegrantAllowance.findAll({
  attributes: [
    Sequelize.literal(
      'DISTINCT ON("granter", "grantee") \'\''
    ) as unknown as string,
    'granter',
    'grantee',
    'blockHeight',
    'active',
    'allowanceData',
  ],
  where: {
    granter: 'xion1granter...',
    active: true,
  },
  order: [
    ['granter', 'ASC'],
    ['grantee', 'ASC'],
    ['blockHeight', 'DESC'],
  ],
})

// Get full history for a granter-grantee pair
const history = await FeegrantAllowance.findAll({
  where: {
    granter: 'xion1granter...',
    grantee: 'xion1grantee...',
  },
  order: [['blockHeight', 'ASC']],
})

// Get allowance at specific block height
const historicalAllowance = await FeegrantAllowance.findOne({
  where: {
    granter: 'xion1granter...',
    grantee: 'xion1grantee...',
    blockHeight: { [Op.lte]: '12345' },
  },
  order: [['blockHeight', 'DESC']],
})
```

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
  PRIMARY KEY ("granter", "grantee", "blockHeight")
);

-- Optimized indexes for TimescaleDB
CREATE INDEX ON "FeegrantAllowances" ("granter", "grantee", "blockHeight" DESC);
CREATE INDEX ON "FeegrantAllowances" ("granter" text_pattern_ops, "blockHeight" DESC);
CREATE INDEX ON "FeegrantAllowances" ("grantee" text_pattern_ops, "blockHeight" DESC);
CREATE INDEX ON "FeegrantAllowances" ("blockHeight");
```

## Future Enhancements

- Parse specific allowance types (BasicAllowance, PeriodicAllowance, etc.)
- Track allowance usage/spending events
- Add expiration date parsing
- Add allowance amount limits parsing
