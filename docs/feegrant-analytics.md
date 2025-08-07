# Feegrant Analytics Endpoints

This document describes the new feegrant analytics endpoints that provide comprehensive statistics and insights about feegrant allowances on the Xion blockchain.

## Deployment Steps

1. **Run Migration**: `npm run db:migrate`
2. **Backfill Data**: `npm run ts-node src/scripts/backfill-feegrant-parsed-data.ts`
3. **Restart Services**: Tracer will begin parsing new data automatically
4. **Test Endpoints**: All three analytics endpoints will be available

## Overview

The feegrant analytics system provides three main endpoints for analyzing feegrant data:

1. **`/a/feegrant/totals`** - Overall statistics and counts
2. **`/a/feegrant/amounts`** - Token amounts and financial data
3. **`/a/feegrant/activity`** - Grantee activity and usage patterns

All endpoints are optimized for performance with:
- ✅ **Single-query execution** for minimal database load
- ✅ **Pre-parsed data** for fast aggregations
- ✅ **30-second HTTP caching** for reduced server load
- ✅ **TimescaleDB indexes** for optimal query performance

## Endpoints

### 1. `/a/feegrant/totals`

Get comprehensive feegrant totals and statistics.

**URL**: `GET /a/feegrant/totals`

**Response**:
```json
{
  "totalActiveGrants": 1250,
  "totalActiveGrantees": 890,
  "totalActiveGranters": 45,
  "totalRevokedGrants": 123,
  "totalBasicAllowances": 800,
  "totalPeriodicAllowances": 350,
  "totalAllowedMsgAllowances": 100,
  "totalUnknownAllowances": 0
}
```

**Fields**:
- `totalActiveGrants`: Number of currently active feegrant allowances
- `totalActiveGrantees`: Number of unique addresses that have active allowances
- `totalActiveGranters`: Number of unique addresses that have granted allowances
- `totalRevokedGrants`: Number of allowances that have been revoked
- `totalBasicAllowances`: Number of BasicAllowance type grants
- `totalPeriodicAllowances`: Number of PeriodicAllowance type grants
- `totalAllowedMsgAllowances`: Number of AllowedMsgAllowance type grants
- `totalUnknownAllowances`: Number of grants with unparsed allowance types

### 2. `/a/feegrant/amounts`

Get feegrant amounts by token denomination.

**URL**: `GET /a/feegrant/amounts`

**Response**:
```json
{
  "totalXionGranted": "50000000000",
  "totalUsdcGranted": "25000000000",
  "totalGrantsWithAmounts": 750,
  "grantsByToken": [
    {
      "denom": "uxion",
      "total": "50000000000",
      "count": 600
    },
    {
      "denom": "uusdc", 
      "total": "25000000000",
      "count": 150
    }
  ]
}
```

**Fields**:
- `totalXionGranted`: Total XION amount granted (in micro units)
- `totalUsdcGranted`: Total USDC amount granted (in micro units)
- `totalGrantsWithAmounts`: Number of grants that have parseable amount data
- `grantsByToken`: Array of grants grouped by token denomination

### 3. `/a/feegrant/activity`

Get feegrant grantee activity statistics.

**URL**: `GET /a/feegrant/activity?daysAgo=30`

**Parameters**:
- `daysAgo` (optional): Number of days to look back for activity (default: 30)

**Response**:
```json
{
  "totalActiveGrantees": 890,
  "granteesWithRecentTxActivity": 234,
  "granteesWithRecentBalanceActivity": 456,
  "granteesWithAnyRecentActivity": 567,
  "activityRate": 63.71
}
```

**Fields**:
- `totalActiveGrantees`: Total number of addresses with active allowances
- `granteesWithRecentTxActivity`: Grantees with recent transaction activity
- `granteesWithRecentBalanceActivity`: Grantees with recent balance changes
- `granteesWithAnyRecentActivity`: Grantees with any recent activity
- `activityRate`: Percentage of grantees that are actively using their allowances

## Usage Examples

### Basic Usage

```bash
# Get overall totals
curl "https://api.example.com/a/feegrant/totals" \
  -H "x-api-key: YOUR_API_KEY"

# Get amount statistics
curl "https://api.example.com/a/feegrant/amounts" \
  -H "x-api-key: YOUR_API_KEY"

# Get activity for last 7 days
curl "https://api.example.com/a/feegrant/activity?daysAgo=7" \
  -H "x-api-key: YOUR_API_KEY"
```

### JavaScript/TypeScript

```typescript
const apiKey = 'YOUR_API_KEY'
const baseUrl = 'https://api.example.com'

// Get feegrant totals
const totals = await fetch(`${baseUrl}/a/feegrant/totals`, {
  headers: { 'x-api-key': apiKey }
}).then(r => r.json())

console.log(`Active grants: ${totals.totalActiveGrants}`)
console.log(`Active grantees: ${totals.totalActiveGrantees}`)

// Get amounts
const amounts = await fetch(`${baseUrl}/a/feegrant/amounts`, {
  headers: { 'x-api-key': apiKey }
}).then(r => r.json())

// Convert micro units to base units
const xionGranted = Number(amounts.totalXionGranted) / 1_000_000
console.log(`Total XION granted: ${xionGranted.toLocaleString()} XION`)

// Get activity
const activity = await fetch(`${baseUrl}/a/feegrant/activity?daysAgo=30`, {
  headers: { 'x-api-key': apiKey }
}).then(r => r.json())

console.log(`Activity rate: ${activity.activityRate}%`)
```

### Python

```python
import requests

api_key = 'YOUR_API_KEY'
base_url = 'https://api.example.com'
headers = {'x-api-key': api_key}

# Get totals
totals = requests.get(f'{base_url}/a/feegrant/totals', headers=headers).json()
print(f"Active grants: {totals['totalActiveGrants']}")

# Get amounts
amounts = requests.get(f'{base_url}/a/feegrant/amounts', headers=headers).json()
xion_granted = int(amounts['totalXionGranted']) / 1_000_000
print(f"Total XION granted: {xion_granted:,.0f} XION")

# Get activity
activity = requests.get(f'{base_url}/a/feegrant/activity?daysAgo=30', headers=headers).json()
print(f"Activity rate: {activity['activityRate']}%")
```

## Performance Characteristics

### Query Performance
- **Response Time**: < 50ms per endpoint
- **Database Load**: Single optimized query per endpoint
- **Memory Usage**: Minimal - results are small JSON objects
- **Scalability**: Handles millions of records efficiently

### Caching
- **HTTP Cache**: 30-second cache headers reduce server load
- **Database Indexes**: All queries use optimized indexes
- **No Table Scans**: All queries use index-only operations

### Database Optimization
The system uses several optimization techniques:

1. **Pre-parsed Fields**: Amount and type data is parsed during ingestion
2. **Composite Indexes**: Optimized for `DISTINCT ON` queries
3. **Partial Indexes**: Active-only indexes for faster aggregations
4. **CTEs**: Common Table Expressions for efficient subqueries

## Implementation Details

### Architecture
```
API Request → Aggregator → Generic Formula → Database Query → Response
     ↓              ↓              ↓              ↓
30s Cache    Formula Cache   Parsed Fields   Optimized Indexes
```

### Database Schema
The analytics system relies on pre-parsed fields in the `FeegrantAllowances` table:

- `parsedAmount`: Token amount (string)
- `parsedDenom`: Token denomination (e.g., "uxion", "uusdc")
- `parsedAllowanceType`: Allowance type (e.g., "BasicAllowance")
- `parsedExpirationUnixMs`: Expiration timestamp (if applicable)

### Data Flow
1. **Ingestion**: Feegrant events are parsed during blockchain ingestion
2. **Storage**: Parsed data is stored alongside raw protobuf data
3. **Querying**: Analytics queries use pre-parsed fields for speed
4. **Caching**: Results are cached for 30 seconds via HTTP headers

## Monitoring and Maintenance

### Health Checks
Monitor these metrics to ensure optimal performance:

- Query response times (should be < 50ms)
- Cache hit rates (should be > 80%)
- Database connection pool usage
- Index usage statistics

### Maintenance Tasks
- **Backfill**: Run `npm run backfill-feegrant-parsed-data` after major updates
- **Index Monitoring**: Check query plans periodically
- **Cache Warming**: Popular endpoints are automatically cached

## Troubleshooting

### Common Issues

**Slow Queries**
- Check if indexes are being used: `EXPLAIN ANALYZE`
- Verify parsed fields are populated
- Monitor database connection pool

**Incorrect Data**
- Verify protobuf parsing is working correctly
- Check if backfill script needs to be run
- Validate tracer handler is processing events

**Cache Issues**
- Check HTTP cache headers are being sent
- Verify 30-second cache TTL is appropriate
- Monitor cache hit rates

### Support
For issues or questions about the feegrant analytics endpoints:

1. Check the logs for query performance metrics
2. Verify database indexes are optimal
3. Ensure parsed fields are being populated correctly
4. Contact the development team with specific error messages
