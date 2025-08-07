# Feegrant Analytics Testing Guide

This document describes the comprehensive test suite for the feegrant analytics system, covering all components from database models to API endpoints.

## Test Coverage Overview

The feegrant analytics system includes tests for:

1. **Formula Tests** - Individual account-level feegrant formulas
2. **Generic Formula Tests** - Analytics aggregation formulas
3. **Aggregator Tests** - API endpoint functionality
4. **Utility Tests** - Protobuf parsing and helper functions
5. **Integration Tests** - End-to-end functionality

## Test Files Structure

```
src/
├── server/test/indexer/
│   ├── computer/formulas/feegrant.ts     # Formula tests
│   └── aggregator/aggregators/feegrant.ts # Aggregator tests
└── utils/feegrant.test.ts                # Utility tests
```

## Test Data Setup

### Database Models Used
- `FeegrantAllowance` - Core allowance data with parsed fields
- `WasmTxEvent` - Transaction activity for grantees
- `BankStateEvent` - Balance changes for activity tracking
- `Block` - Block information
- `State` - System state tracking

### Test Data Characteristics
- **Mixed Allowance Types**: BasicAllowance, PeriodicAllowance, AllowedMsgAllowance
- **Multiple Tokens**: uxion, uusdc denominations
- **Activity Data**: Recent transactions and balance changes
- **Historical Data**: Different block heights and timestamps
- **Edge Cases**: Revoked allowances, missing data, large amounts

## Formula Tests (`src/server/test/indexer/computer/formulas/feegrant.ts`)

### Account-Level Formula Tests
Tests the existing individual account feegrant formulas:

- `getFeegrantAllowance` - Single allowance retrieval
- `getFeegrantAllowances` - Multiple allowances by granter/grantee
- `hasFeegrantAllowance` - Boolean allowance existence check
- Block height filtering functionality
- Historical data queries

### Generic Formula Tests
Tests the new analytics formulas:

#### `/generic/feegrant/totals`
- ✅ Comprehensive statistics calculation
- ✅ Empty database handling
- ✅ Mixed allowance type counting
- ✅ Active vs inactive filtering

#### `/generic/feegrant/amounts`
- ✅ Token amount aggregation
- ✅ Multi-denomination support
- ✅ Missing parsed data handling
- ✅ Large amount calculations

#### `/generic/feegrant/activity`
- ✅ Activity rate calculations
- ✅ Custom time window parameters
- ✅ Transaction and balance activity correlation
- ✅ Parameter validation
- ✅ Edge cases (zero grantees, no activity)

## Aggregator Tests (`src/server/test/indexer/aggregator/aggregators/feegrant.ts`)

### API Endpoint Tests
Tests the three main analytics endpoints:

#### `/a/feegrant/totals`
- ✅ Comprehensive statistics response
- ✅ Empty database scenarios
- ✅ Mixed allowance type handling
- ✅ Response format validation

#### `/a/feegrant/amounts`
- ✅ Token amount statistics
- ✅ Multiple denomination support
- ✅ Large amount handling
- ✅ No amounts scenario

#### `/a/feegrant/activity`
- ✅ Default 30-day window
- ✅ Custom time windows
- ✅ Activity rate calculations
- ✅ Parameter validation
- ✅ Scale testing (large numbers)

### Infrastructure Tests
- ✅ HTTP cache header validation
- ✅ Error handling and graceful failures
- ✅ API key authentication
- ✅ Invalid endpoint handling

## Utility Tests (`src/utils/feegrant.test.ts`)

### Protobuf Parsing Tests
Tests the `parseAllowanceData` function:

- ✅ Empty/invalid data handling
- ✅ Allowance type detection (Basic, Periodic, AllowedMsg)
- ✅ Token denomination extraction (uxion, uusdc)
- ✅ Error handling and graceful failures
- ✅ Pattern recognition accuracy

### Helper Function Tests
Tests utility functions:

#### `isAllowanceExpired`
- ✅ Future expiration handling
- ✅ Past expiration detection
- ✅ Invalid timestamp handling
- ✅ Edge cases (undefined, null)

#### `formatAllowanceAmount`
- ✅ Micro unit to base unit conversion
- ✅ Multiple token denomination support
- ✅ Large amount handling
- ✅ Decimal precision accuracy
- ✅ Unknown denomination fallback

### Integration Scenarios
- ✅ Complete parsing workflow
- ✅ Edge case handling
- ✅ Cross-function validation

## Test Data Scenarios

### Comprehensive Test Data
```typescript
// Active allowances with parsed data
{
  granter: 'xion1granter123',
  grantee: 'xion1grantee456',
  active: true,
  parsedAmount: '1000000',
  parsedDenom: 'uxion',
  parsedAllowanceType: 'BasicAllowance',
}

// Activity data for correlation
{
  sender: 'xion1grantee456', // Matches grantee
  blockTimeUnixMs: 1640995350000, // Recent activity
}
```

### Edge Cases Covered
- **Empty Database**: All endpoints return zero values
- **No Parsed Data**: Graceful handling of missing parsed fields
- **Large Amounts**: Proper handling of big integer calculations
- **Invalid Parameters**: Validation and error responses
- **Mixed Data**: Combination of active/inactive, different types
- **Time Windows**: Various activity time ranges

## Performance Test Considerations

### Database Query Optimization
- Tests verify single-query execution patterns
- Index usage validation through query structure
- Large dataset simulation for scalability

### Caching Validation
- HTTP cache header presence verification
- 30-second cache TTL confirmation
- Cache behavior consistency across endpoints

### Error Handling
- Database connection failure simulation
- Invalid data handling
- Graceful degradation testing

## Running the Tests

### Individual Test Suites
```bash
# Run formula tests
npm test -- src/server/test/indexer/computer/formulas/feegrant.ts

# Run aggregator tests  
npm test -- src/server/test/indexer/aggregator/aggregators/feegrant.ts

# Run utility tests
npm test -- src/utils/feegrant.test.ts
```

### Full Test Suite
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

### Test Environment Setup
Tests automatically:
1. Set up clean database state
2. Create comprehensive test data
3. Mock external dependencies
4. Clean up after execution

## Test Assertions

### Response Format Validation
```typescript
expect(response.body).toEqual({
  totalActiveGrants: expect.any(Number),
  totalActiveGrantees: expect.any(Number),
  // ... other fields
})
```

### Error Handling Validation
```typescript
await request(app.callback())
  .get('/a/feegrant/activity?daysAgo=invalid')
  .expect(500)
  .expect('daysAgo must be a positive number')
```

### Cache Header Validation
```typescript
expect(response.headers['cache-control']).toBeDefined()
```

## Continuous Integration

### Test Pipeline
1. **Unit Tests**: Utility functions and parsing logic
2. **Integration Tests**: Database queries and API responses
3. **Performance Tests**: Query optimization and caching
4. **End-to-End Tests**: Complete workflow validation

### Coverage Requirements
- **Minimum Coverage**: 90% for all feegrant components
- **Critical Paths**: 100% coverage for analytics formulas
- **Error Handling**: All error scenarios tested

## Debugging Test Failures

### Common Issues
1. **Database State**: Ensure clean setup between tests
2. **Mock Data**: Verify test data matches expected formats
3. **Timing Issues**: Account for async operations
4. **Cache Headers**: Verify aggregator route configuration

### Debug Commands
```bash
# Run specific test with verbose output
npm test -- --reporter=verbose src/utils/feegrant.test.ts

# Run with debugging
npm test -- --inspect-brk src/server/test/indexer/aggregator/aggregators/feegrant.ts
```

## Future Test Enhancements

### Planned Additions
1. **Load Testing**: High-volume data scenarios
2. **Stress Testing**: Concurrent request handling
3. **Migration Testing**: Database schema changes
4. **Monitoring Tests**: Performance metric validation

### Test Data Expansion
1. **More Token Types**: Additional denominations
2. **Complex Scenarios**: Multi-granter relationships
3. **Historical Data**: Long-term activity patterns
4. **Edge Cases**: Boundary condition testing

This comprehensive test suite ensures the feegrant analytics system is robust, performant, and reliable for production use.
