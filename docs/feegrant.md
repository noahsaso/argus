# Feegrant API Endpoints

This document provides a comprehensive guide to all feegrant endpoints available in the Argus API, including their parameters and usage examples.

## Generic Feegrant Endpoints

Generic endpoints available at `/api/generic/_/feegrant/[endpoint]`

### `/totals`
Get aggregate totals for feegrant allowances.

**Parameters:**
- `limit` (optional): Maximum number of results to return

**Response:** Summary statistics of feegrant allowances

### `/feegrantAllowancesSummary`
Enhanced totals with detailed address information and allowance summaries.

**Parameters:**
- `limit` (optional): Maximum number of results to return

**Response:** Detailed summary including granter/grantee addresses and allowance counts

### `/treasuryContractList`
Get list of treasury contracts with feegrant capabilities.

**Parameters:**
- None

**Response:** List of treasury contract addresses and their metadata

### `/amounts`
Get allowance amounts and spending data.

**Parameters:**
- `limit` (optional): Maximum number of results to return

**Response:** Allowance amounts and usage statistics

### `/activity`
Get feegrant activity and usage patterns.

**Parameters:**
- `limit` (optional): Maximum number of results to return

**Response:** Activity metrics and usage patterns

### `/treasuryAnalytics`
Comprehensive analytics for treasury feegrant usage.

**Parameters:**
- `timeWindow` (optional): Time window for analysis (default: 30 days)
- `granularity` (optional): Data granularity level

**Response:** Detailed treasury analytics including spending patterns and efficiency metrics

### `/historicalTrends`
Historical trend analysis of feegrant usage.

**Parameters:**
- `timeWindow` (optional): Time window for analysis (default: 30 days)
- `startTime` (optional): Start timestamp for analysis
- `endTime` (optional): End timestamp for analysis

**Response:** Historical trends and pattern analysis

### `/tokenMovement`
Token movement analytics for feegrant allowances.

**Parameters:**
- `timeWindow` (optional): Time window for analysis (default: 30 days)
- `startTime` (optional): Start timestamp for analysis
- `endTime` (optional): End timestamp for analysis

**Response:** Comprehensive token movement analytics including chain-wide movement, treasury movement, and daily trends

## Treasury Contract Endpoints

Treasury-specific endpoints available at `/api/contract/[contractAddress]/[endpoint]`

### `/grantConfigs`
Get grant configuration settings for the treasury contract.

**Parameters:**
- None

**Response:** Current grant configuration parameters

### `/feeConfig`
Get fee configuration for the treasury contract.

**Parameters:**
- None

**Response:** Fee structure and limits

### `/admin`
Get current admin address of the treasury contract.

**Parameters:**
- None

**Response:** Admin address information

### `/pendingAdmin`
Get pending admin address if there's an admin change in progress.

**Parameters:**
- None

**Response:** Pending admin address information

### `/params`
Get treasury contract parameters and settings.

**Parameters:**
- None

**Response:** Contract parameters and configuration

### `/balances`
Get current balances in the treasury contract.

**Parameters:**
- None

**Response:** Current token balances

### `/balanceHistory`
Get historical balance data for the treasury contract.

**Parameters:**
- `limit` (optional): Maximum number of records to return

**Response:** Historical balance changes over time

### `/activeGrantees`
Get list of active grantees receiving allowances from the treasury.

**Parameters:**
- `limit` (optional): Maximum number of grantees to return

**Response:** List of active grantees with allowance details

### `/granteeActivity`
Get activity metrics for treasury grantees.

**Parameters:**
- `limit` (optional): Maximum number of grantees to include
- `timeWindow` (optional): Time window for activity analysis

**Response:** Grantee activity patterns and usage statistics

### `/usageMetrics`
Get detailed usage metrics for the treasury contract.

**Parameters:**
- `timeWindow` (optional): Time window for metrics calculation

**Response:** Comprehensive usage statistics and efficiency metrics

### `/onboardingMetrics`
Get metrics related to new grantee onboarding.

**Parameters:**
- `timeWindow` (optional): Time window for onboarding analysis

**Response:** Onboarding statistics and trends

### `/treasuryHealth`
Get overall health status and metrics for the treasury.

**Parameters:**
- None

**Response:** Health indicators and status metrics

### `/all`
Get comprehensive treasury data including balances, grants, and activity.

**Parameters:**
- None

**Response:** Complete treasury state and statistics

## Aggregator Endpoints

Time-series aggregated data available at `/api/a/feegrant/[endpoint]`

### `/treasuryOverTime`
Time-series data for treasury feegrant metrics.

**Parameters:**
- `timeWindow` (optional): Time window for aggregation (default: 30 days)
- `granularity` (optional): Data granularity (hourly, daily, weekly)

**Response:** Time-series array of treasury metrics over time

### `/chainwideOverTime`
Chain-wide feegrant metrics over time.

**Parameters:**
- `timeWindow` (optional): Time window for aggregation (default: 30 days)
- `granularity` (optional): Data granularity (hourly, daily, weekly)

**Response:** Time-series array of chain-wide feegrant activity

### `/treasuryOnboardingOverTime`
Treasury onboarding metrics over time.

**Parameters:**
- `timeWindow` (optional): Time window for aggregation (default: 30 days)
- `granularity` (optional): Data granularity (hourly, daily, weekly)

**Response:** Time-series array of onboarding metrics and trends

### `/tokenMovement`
Time-series token movement data for feegrant allowances.

**Parameters:**
- `timeWindow` (optional): Time window for aggregation (default: 30 days)
- `granularity` (optional): Data granularity (hourly, daily, weekly)

**Response:** Time-series array of token movement analytics

### `/tokenMovementOverTime`
Extended time-series token movement analysis.

**Parameters:**
- `timeWindow` (optional): Time window for aggregation (default: 30 days)
- `granularity` (optional): Data granularity (hourly, daily, weekly)

**Response:** Detailed time-series token movement data with extended analytics

## Usage Examples

### Generic Endpoint Usage
```bash
# Get feegrant totals
GET /api/generic/_/feegrant/totals

# Get treasury analytics for last 7 days
GET /api/generic/_/feegrant/treasuryAnalytics?timeWindow=7

# Get token movement with custom time range
GET /api/generic/_/feegrant/tokenMovement?startTime=1640995200&endTime=1643673600
```

### Treasury Contract Usage
```bash
# Get treasury balances
GET /api/contract/xion1treasury.../balances

# Get active grantees (limit 50)
GET /api/contract/xion1treasury.../activeGrantees?limit=50

# Get usage metrics for last 14 days
GET /api/contract/xion1treasury.../usageMetrics?timeWindow=14
```

### Aggregator Usage
```bash
# Get daily treasury metrics for last 30 days
GET /api/a/feegrant/treasuryOverTime?timeWindow=30&granularity=daily

# Get hourly chain-wide data
GET /api/a/feegrant/chainwideOverTime?granularity=hourly

# Get token movement time-series
GET /api/a/feegrant/tokenMovement?timeWindow=7&granularity=daily
```

## Parameter Details

### Common Parameters

- **`timeWindow`**: Number of days to analyze (default: 30)
- **`limit`**: Maximum number of results to return
- **`startTime`**: Unix timestamp for analysis start time
- **`endTime`**: Unix timestamp for analysis end time
- **`granularity`**: Time granularity for aggregated data (`hourly`, `daily`, `weekly`)

### Parameter Validation

- Time windows are bounded between 1 and 90 days
- Limits are bounded between 1 and 1000 results
- Invalid parameters will return appropriate error responses
- Treasury contract endpoints require valid contract addresses
