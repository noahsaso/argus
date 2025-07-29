# Feegrant Module Implementation

This document describes the complete implementation of the feegrant module for the Argus blockchain indexer, providing comprehensive tracking of Cosmos SDK feegrant allowances with full historical data and formula integration.

## Overview

The feegrant module tracks Cosmos SDK feegrant module state changes, monitoring when fee allowances are granted, updated, revoked, or expire. It provides both raw data access and convenient formula functions for querying allowance relationships with full historical tracking.

## Architecture

### Key Features
- ✅ **Historical Tracking**: Full history of all allowance changes with point-in-time queries
- ✅ **Formula Integration**: Easy-to-use functions in the formula environment
- ✅ **Performance Optimized**: TimescaleDB indexes and caching integration
- ✅ **Type Safe**: Full TypeScript support with comprehensive error handling
- ✅ **Test Coverage**: 41 comprehensive test cases covering all functionality

## Implementation Components

### 1. Database Model: `FeegrantAllowance`

**File**: `src/db/models/FeegrantAllowance.ts`

The main model that stores feegrant allowance relationships with full historical tracking:

- **Primary Key**: Composite key of `(granter, grantee, blockHeight)` for historical tracking
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
- `getPreviousEvent()`: Get the previous allowance event for this granter-grantee pair
- `dependentKey`: Generate cache key for this allowance
- `getWhereClauseForDependentKeys()`: Static method for efficient dependent key queries

### 2. Tracer Handler: `feegrant`

**File**: `src/tracer/handlers/feegrant.ts`

The handler that processes blockchain state changes with historical tracking:

- **Store Name**: `feegrant`
- **Key Prefix**: `0x00` (FeeAllowanceKeyPrefix)
- **Key Format**: `0x00 || len(granter) || granter || len(grantee) || grantee`
- **Operations**:
  - `write`: Creates a new allowance record (sets `active: true`)
  - `delete`: Creates a revocation record (sets `active: false`)
- **Historical Behavior**: Uses `create()` instead of `upsert()` to maintain full history

### 3. Formula Environment Functions

**File**: `src/formulas/env.ts`

Three convenient functions available in all formulas:

#### `getFeegrantAllowance(granter: string, grantee: string)`
Get the most recent allowance between two addresses.

```typescript
const allowance = await env.getFeegrantAllowance('xion1granter...', 'xion1grantee...')
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
const hasAllowance = await env.hasFeegrantAllowance('xion1granter...', 'xion1grantee...')
if (hasAllowance) {
  // Process transaction with fee grant
}
```

### 4. Database Migrations

**Files**:
- `src/db/migrations/20250723203900-create-feegrant-allowance.ts`
- `src/db/migrations/20250723204000-add-feegrant-to-state.ts`

Creates the necessary database tables with optimized indexes and adds state tracking.

### 5. Type Definitions

**File**: `src/types/tracer.ts`
- Added `ParsedFeegrantStateEvent` type for handler data structure

**File**: `src/types/db.ts`
- Added `FeegrantAllowance` to the `DependentKeyNamespace` enum

**File**: `src/types/formulas.ts`
- Added `FormulaFeegrantAllowanceObject` type
- Added formula function type definitions

## Usage Examples

### Formula Environment Usage

```typescript
// In any formula (account, contract, generic, validator)
export const myFormula: GenericFormula = {
  async compute(env) {
    // Check if address has any active allowances
    const grantedAllowances = await env.getFeegrantAllowances('xion1granter...')

    // Check specific allowance
    const hasAllowance = await env.hasFeegrantAllowance('xion1granter...', 'xion1grantee...')

    // Get detailed allowance info
    const allowance = await env.getFeegrantAllowance('xion1granter...', 'xion1grantee...')

    return {
      totalGranted: grantedAllowances?.length || 0,
      hasSpecificAllowance: hasAllowance,
      allowanceDetails: allowance
    }
  },
  docs: {
    description: 'Example feegrant usage in formula'
  }
}
```

### Direct Database Queries

```typescript
import { FeegrantAllowance } from '@/db'

// Get current active allowances for an address
const activeAllowances = await FeegrantAllowance.findAll({
  attributes: [
    Sequelize.literal('DISTINCT ON("granter", "grantee") \'\'') as unknown as string,
    'granter', 'grantee', 'blockHeight', 'active', 'allowanceData'
  ],
  where: {
    granter: 'xion1granter...',
    active: true
  },
  order: [
    ['granter', 'ASC'],
    ['grantee', 'ASC'],
    ['blockHeight', 'DESC']
  ]
})

// Get full history for a granter-grantee pair
const history = await FeegrantAllowance.findAll({
  where: {
    granter: 'xion1granter...',
    grantee: 'xion1grantee...'
  },
  order: [['blockHeight', 'ASC']]
})

// Get allowance at specific block height
const historicalAllowance = await FeegrantAllowance.findOne({
  where: {
    granter: 'xion1granter...',
    grantee: 'xion1grantee...',
    blockHeight: { [Op.lte]: '12345' }
  },
  order: [['blockHeight', 'DESC']]
})
```

### Advanced Examples

See `src/examples/feegrant-usage.ts` for comprehensive examples including:
- Historical tracking and analysis
- Batch operations and statistics
- Integration with other modules
- Performance optimization techniques

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

4. **Use in Formulas**: The formula functions are automatically available in all formula environments

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

## Performance Considerations

### Caching Integration
- Formula functions integrate with Argus caching system
- Dependent keys automatically track cache invalidation
- Efficient cache warming for frequently accessed data

### Database Optimization
- TimescaleDB-optimized indexes for time-series queries
- `DISTINCT ON` queries for latest state retrieval
- Composite primary key enables efficient historical queries

### Query Patterns
- Use formula functions for most common operations
- Direct database queries for complex analytical needs
- Historical queries leverage block height indexing

## Testing

Comprehensive test coverage with 41 test cases across three test files:

### Test Files
- `src/db/models/FeegrantAllowance.test.ts` (15 tests) - Model functionality
- `src/tracer/handlers/feegrant.test.ts` (12 tests) - Handler processing
- `src/formulas/env.feegrant.test.ts` (14 tests) - Formula functions

### Running Tests
```bash
# Run all feegrant tests
npm test -- --testNamePattern="feegrant|Feegrant"

# Run specific test files
npm test src/db/models/FeegrantAllowance.test.ts
npm test src/tracer/handlers/feegrant.test.ts
npm test src/formulas/env.feegrant.test.ts

# Run with coverage
npm test -- --coverage --testPathPattern="feegrant"
```

## Integration Points

The feegrant module integrates seamlessly with existing Argus architecture:

- **Handler Registration**: Auto-registered in `src/tracer/handlers/index.ts`
- **Database Models**: Exported from `src/db/models/index.ts`
- **Dependable Events**: Integrated with `src/db/dependable.ts`
- **State Tracking**: Tracks `lastFeegrantBlockHeightExported` in State model
- **Formula Environment**: Functions available in all formula types
- **Type System**: Full TypeScript integration with proper type definitions

## Future Enhancements

### Planned Features
- 🔄 Parse specific allowance types (BasicAllowance, PeriodicAllowance, etc.)
- 🔄 Track allowance usage/spending events
- 🔄 Add expiration date parsing and monitoring
- 🔄 Add allowance amount limits parsing
- 🔄 Real-time allowance status updates

### Extension Points
- Custom allowance type parsers
- Integration with fee estimation
- Allowance usage analytics
- Cross-chain allowance tracking

## Troubleshooting

### Common Issues

**Missing Data**: Ensure tracer is running and has processed blocks with feegrant activity
```bash
# Check tracer status
npm run tracer:status

# Check latest processed block
SELECT "lastFeegrantBlockHeightExported" FROM "States" LIMIT 1;
```

**Performance Issues**: Verify indexes are created and queries use proper patterns
```sql
-- Check index usage
EXPLAIN ANALYZE SELECT * FROM "FeegrantAllowances"
WHERE "granter" = 'xion1...' AND "active" = true;
```

**Cache Issues**: Clear cache if seeing stale data
```bash
npm run cache:clear
```

## Notes

- The handler uses the standard Cosmos SDK feegrant key prefix (`0x00`)
- Address decoding uses the chain's bech32 prefix from configuration
- Historical tracking maintains complete audit trail of all changes
- Formula functions provide caching and performance optimization
- Raw protobuf data is preserved for future parsing enhancements
- The `active` field enables lifecycle tracking without data loss
