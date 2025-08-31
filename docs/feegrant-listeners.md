# Implementation Plan: Feegrant Event Listeners

## Overview

The current feegrant formulas incorrectly use `BankStateEvents` and `WasmTxEvent` to track feegrant metrics. These tables don't contain the actual feegrant transaction data needed for accurate analytics. We need to implement a proper feegrant event listener system that captures feegrant events directly from the blockchain and stores them in a dedicated database table.

The solution involves creating a complete feegrant data pipeline: **Events → Extractor → Database → Formulas**

## Types

### New Database Model: FeegrantEvent
A new table to store feegrant events with the following fields:
- `id` (BIGINT, primary key, auto-increment)
- `txHash` (TEXT, not null) - Transaction hash where event occurred
- `blockHeight` (BIGINT, not null) - Block height of the event
- `blockTimeUnixMs` (BIGINT, not null) - Block time in milliseconds
- `blockTimestamp` (TIMESTAMP, not null) - Block timestamp
- `action` (TEXT, not null) - Event action: 'set_feegrant', 'revoke_feegrant', 'use_feegrant', 'prune_feegrant'
- `granter` (TEXT, nullable) - Address of the granter
- `grantee` (TEXT, nullable) - Address of the grantee  
- `pruner` (TEXT, nullable) - Address of the pruner (for prune events)
- `allowanceType` (TEXT, nullable) - Type of allowance (BasicAllowance, PeriodicAllowance, etc.)
- `allowanceAmount` (TEXT, nullable) - Amount granted as string to handle big numbers
- `allowanceDenom` (TEXT, nullable) - Token denomination
- `spentAmount` (TEXT, nullable) - Amount spent in use events
- `eventData` (JSONB, nullable) - Additional event attributes as JSON

### New TypeScript Interfaces
- `FeegrantEventJson` interface for JSON representation
- `FeegrantEventAttributes` interface for Sequelize model attributes
- Update `DependentKeyNamespace` enum to include `FeegrantEvent`

## Files

### New Files to Create:

#### 1. `src/listener/extractors/feegrant.ts`
Main feegrant extractor class implementing the following handlers:
- `handleSetFeegrant()` - Process grant creation events
- `handleRevokeFeegrant()` - Process grant revocation events
- `handleUseFeegrant()` - Process grant usage events  
- `handlePruneFeegrant()` - Process grant pruning events
- `sync()` - Backfill historical feegrant data

#### 2. `src/db/models/FeegrantEvent.ts`
Database model extending `DependableEventModel` with:
- Sequelize model definition
- Dependent key generation logic
- Query optimization methods
- Relationship definitions

#### 3. `src/db/migrations/YYYYMMDDHHMMSS-create-feegrant-event.ts`
Database migration to create the FeegrantEvent table with:
- Table creation with all fields
- Indexes for performance (blockHeight, txHash, granter, grantee, action)
- Foreign key constraints if needed

#### 4. `src/listener/extractors/feegrant.test.ts`
Unit tests covering:
- Event parsing and extraction
- Handler logic for each action type
- Edge cases and error handling

### Existing Files to Modify:

#### 1. `src/listener/extractors/index.ts`
- Add `FeegrantExtractor` export

#### 2. `src/db/models/index.ts` 
- Add `FeegrantEvent` model export

#### 3. `src/types/db.ts`
- Add `FeegrantEvent` to `DependentKeyNamespace` enum
- Add `FeegrantEventJson` interface

#### 4. `src/formulas/formulas/generic/feegrant.ts`
Update all formulas to query `FeegrantEvent` instead of `BankStateEvents`/`WasmTxEvent`:
- `totals` - Query FeegrantEvent for grant statistics
- `amounts` - Query FeegrantEvent for allowance amounts
- `activity` - Query FeegrantEvent for usage activity
- `tokenMovement` - Query FeegrantEvent for transaction volume
- `historicalTrends` - Query FeegrantEvent for time series data
- `treasuryAnalytics` - Use FeegrantEvent data for treasury metrics

#### 5. `src/formulas/formulas/contract/xion/treasury.ts`
Update treasury-specific formulas:
- `activeGrantees` - Query FeegrantEvent for grantee data
- `granteeActivity` - Use FeegrantEvent for activity calculations
- `usageMetrics` - Query FeegrantEvent for utilization data
- `onboardingMetrics` - Use FeegrantEvent for growth metrics

## Functions

### New Functions in FeegrantExtractor:

#### Event Handlers:
- `handleSetFeegrant(data: FeegrantEventData)` - Extract grant creation data
- `handleRevokeFeegrant(data: FeegrantEventData)` - Extract revocation data
- `handleUseFeegrant(data: FeegrantEventData)` - Extract usage data with spent amounts
- `handlePruneFeegrant(data: FeegrantEventData)` - Extract pruning events

#### Utility Functions:
- `parseAllowanceData(attributes: any[])` - Parse allowance amount/type from event attributes
- `extractAddresses(attributes: any[])` - Extract granter/grantee addresses
- `static sync()` - Async generator for historical data backfill

### New Functions in FeegrantEvent Model:
- `getDependentKey()` - Generate unique key: `${txHash}:${action}:${granter}:${grantee}`
- `getWhereClauseForDependentKeys()` - Optimize queries for dependent keys
- `getPreviousEvent()` - Fetch previous event for the same granter/grantee pair

### Modified Functions in Formulas:
All compute functions in feegrant formulas will be updated to:
- Replace `BankStateEvents` queries with `FeegrantEvent` queries
- Use proper event filtering by action type
- Leverage indexed queries for performance
- Handle new data structure and field names

## Classes

### New Classes:

#### 1. FeegrantExtractor extends Extractor
```typescript
export class FeegrantExtractor extends Extractor {
  static type = 'feegrant'
  static sources: ExtractorDataSource[] = [
    FeegrantEventDataSource.source('handleSetFeegrant', { action: 'set_feegrant' }),
    FeegrantEventDataSource.source('handleRevokeFeegrant', { action: 'revoke_feegrant' }),
    FeegrantEventDataSource.source('handleUseFeegrant', { action: 'use_feegrant' }),
    FeegrantEventDataSource.source('handlePruneFeegrant', { action: 'prune_feegrant' })
  ]
}
```

#### 2. FeegrantEvent extends DependableEventModel
```typescript
@Table({ tableName: 'FeegrantEvents' })
export class FeegrantEvent extends DependableEventModel {
  static dependentKeyNamespace = DependentKeyNamespace.FeegrantEvent
  static blockHeightKey = 'blockHeight'
  static blockTimeUnixMsKey = 'blockTimeUnixMs'
}
```

## Dependencies

### No New External Dependencies Required
- Uses existing Sequelize ORM
- Leverages existing `FeegrantEventDataSource`
- Follows established framework patterns
- Uses existing testing infrastructure

### Internal Dependencies:
- `src/listener/sources/FeegrantEvent.ts` (already exists)
- `src/listener/extractors/base.ts` (existing base class)
- `src/db/models` infrastructure (existing)
- `src/types` definitions (existing)

## Testing

### Unit Tests (`src/listener/extractors/feegrant.test.ts`):
- Mock feegrant event data
- Test each handler function individually
- Verify correct data extraction and transformation
- Test edge cases (missing fields, malformed data)

### Integration Tests:
- Test complete event → database → formula flow
- Verify database queries and indexing
- Test performance with large datasets
- Validate formula accuracy against known data

### Formula Accuracy Tests:
- Compare results between old (incorrect) and new (correct) data sources
- Validate that metrics make sense with real feegrant data
- Test edge cases like expired grants, revoked grants, etc.

### End-to-End Tests:
- Test listener processing of real blockchain events
- Verify data persistence and retrieval
- Test formula computation with real data

## Implementation Order

### Phase 1: Database Foundation
1. **Create Database Migration** (`src/db/migrations/YYYYMMDDHHMMSS-create-feegrant-event.ts`)
   - Define table schema with proper indexes
   - Run migration to create table

2. **Create Database Model** (`src/db/models/FeegrantEvent.ts`)
   - Define Sequelize model with relationships
   - Implement DependableEventModel methods
   - Add to model exports

3. **Update Type Definitions** (`src/types/db.ts`)
   - Add FeegrantEvent to DependentKeyNamespace
   - Define FeegrantEventJson interface

### Phase 2: Extractor Implementation
4. **Create Feegrant Extractor** (`src/listener/extractors/feegrant.ts`)
   - Implement base extractor structure
   - Add event handler methods
   - Implement data parsing and transformation

5. **Add Extractor Tests** (`src/listener/extractors/feegrant.test.ts`)
   - Create comprehensive unit tests
   - Test all handler methods
   - Verify data extraction accuracy

6. **Register Extractor** (`src/listener/extractors/index.ts`)
   - Export FeegrantExtractor
   - Ensure it's available to listener system

### Phase 3: Formula Updates
7. **Update Generic Feegrant Formulas** (`src/formulas/formulas/generic/feegrant.ts`)
   - Replace BankStateEvents queries with FeegrantEvent queries
   - Update data processing logic
   - Ensure backward compatibility of results

8. **Update Treasury Feegrant Formulas** (`src/formulas/formulas/contract/xion/treasury.ts`)
   - Update treasury-specific formulas
   - Use FeegrantEvent data for treasury metrics
   - Maintain existing formula interfaces

### Phase 4: Testing & Validation
9. **Integration Testing**
   - Test complete data flow
   - Validate formula accuracy
   - Performance testing with large datasets

10. **Historical Data Backfill**
    - Implement sync function for historical data
    - Run backfill process for existing blockchain data
    - Validate historical data accuracy

### Phase 5: Deployment & Monitoring
11. **Deploy to Test Environment**
    - Run migration on test database
    - Deploy updated listener and formulas
    - Validate against test data

12. **Production Deployment**
    - Run migration on production database
    - Deploy updated system
    - Monitor for errors and performance

## Database Schema Details

### Table: FeegrantEvents

```sql
CREATE TABLE "FeegrantEvents" (
  "id" BIGSERIAL PRIMARY KEY,
  "txHash" TEXT NOT NULL,
  "blockHeight" BIGINT NOT NULL,
  "blockTimeUnixMs" BIGINT NOT NULL,
  "blockTimestamp" TIMESTAMP NOT NULL,
  "action" TEXT NOT NULL CHECK (action IN ('set_feegrant', 'revoke_feegrant', 'use_feegrant', 'prune_feegrant')),
  "granter" TEXT,
  "grantee" TEXT,
  "pruner" TEXT,
  "allowanceType" TEXT,
  "allowanceAmount" TEXT,
  "allowanceDenom" TEXT,
  "spentAmount" TEXT,
  "eventData" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX "idx_feegrant_events_block_height" ON "FeegrantEvents" ("blockHeight");
CREATE INDEX "idx_feegrant_events_tx_hash" ON "FeegrantEvents" ("txHash");
CREATE INDEX "idx_feegrant_events_granter" ON "FeegrantEvents" ("granter") WHERE "granter" IS NOT NULL;
CREATE INDEX "idx_feegrant_events_grantee" ON "FeegrantEvents" ("grantee") WHERE "grantee" IS NOT NULL;
CREATE INDEX "idx_feegrant_events_action" ON "FeegrantEvents" ("action");
CREATE INDEX "idx_feegrant_events_granter_grantee" ON "FeegrantEvents" ("granter", "grantee") WHERE "granter" IS NOT NULL AND "grantee" IS NOT NULL;
CREATE INDEX "idx_feegrant_events_block_time" ON "FeegrantEvents" ("blockTimeUnixMs");
```

## Performance Considerations

### Query Optimization:
- Index on commonly queried fields (blockHeight, granter, grantee, action)
- Compound indexes for multi-field queries
- Partial indexes for nullable fields

### Data Volume Management:
- Regular cleanup of old events if needed
- Partitioning by block height for very large datasets
- Efficient JSON querying for eventData field

### Formula Performance:
- Use DISTINCT ON patterns for latest state queries
- Batch processing for large datasets
- Memory-efficient aggregations

## Migration Strategy

### Backward Compatibility:
- Keep old formula implementations temporarily
- Add feature flag to switch between old/new data sources
- Gradual rollout with monitoring

### Data Validation:
- Compare results between old and new implementations
- Validate key metrics match expected values
- Monitor for performance regressions

### Rollback Plan:
- Keep old formulas available for quick rollback
- Database migration rollback procedures
- Monitoring and alerting for issues

This implementation plan provides a complete solution for accurate feegrant metrics by properly capturing and storing feegrant events at the blockchain level, replacing the incorrect usage of BankStateEvents and WasmTxEvent with proper feegrant event data.
