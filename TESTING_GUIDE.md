# Comprehensive Testing Guide

This document provides complete guidance for testing the CF-SSAI platform.

## Quick Start

```bash
# Run all tests
./run-tests.sh

# Run only unit tests
./run-tests.sh --unit

# Run only integration tests (requires workers running)
./run-tests.sh --integration

# Run quick smoke tests
./run-tests.sh --quick

# Run specific test file
npm test tests/hls-advanced.test.ts
```

## Test Suites

### 1. Unit Tests

#### Core Utilities (`tests/golden.test.ts`)
- HLS manipulation (insertDiscontinuity, addDaterangeInterstitial)
- URL signing (signPath)
- Time utilities (windowBucket)
- JWT parsing (parseJWTUnsafe)

#### Advanced HLS Tests (`tests/hls-advanced.test.ts`)
- **Parsing**: Master playlist parsing, segment detection, duration calculation
- **DISCONTINUITY**: Insertion before last segment, PDT-based insertion
- **SGAI Interstitials**: DATERANGE tag generation, attribute formatting
- **SSAI Segment Replacement**: Full segment replacement with DISCONTINUITY tags
- **Edge Cases**: Empty manifests, very long manifests (10K+ segments), Unicode
- **Validation**: HLS syntax correctness, segment continuity

**Coverage**: 50+ tests

#### Security & JWT Tests (`tests/security.test.ts`)
- **JWT Parsing**: Unsafe parsing, malformed tokens, custom claims
- **JWT Verification**: HS256/RS256 signature verification, expiration checks
- **URL Signing**: HMAC-SHA256 signatures, IP binding, concurrent operations
- **Security Best Practices**: Algorithm confusion prevention, expiration enforcement
- **Attack Vectors**: 'none' algorithm, tampered payloads, extremely long tokens

**Coverage**: 40+ tests

#### SCTE-35 Tests (`tests/scte35.test.ts`, `tests/scte35-advanced.test.ts`)
- **Basic Parsing**: Break start/end signals, UPID extraction, segment numbering
- **Signal Types**: Provider/distributor ads, program boundaries, chapter markers
- **Advanced Features**: PTS timestamps, auto-return flags, segmentation types
- **Break Detection**: Active break identification, duration calculation
- **Edge Cases**: Malformed attributes, hex segmentation types, multi-pod sequences
- **Real-World Scenarios**: Live sports, multi-segment ad pods, program boundaries

**Coverage**: 60+ tests

#### VAST Parser Tests (`tests/vast.test.ts`)
- **VAST 3.0/4.2**: InLine and Wrapper ads
- **Media Files**: HLS preference, bitrate selection, multiple creatives
- **Tracking URLs**: Impressions, quartiles, clicks, errors
- **Wrappers**: Multi-level wrapper resolution
- **Error Handling**: Invalid XML, empty VAST, missing media files

**Coverage**: 14+ tests

#### Worker Tests (`tests/workers.test.ts`)
- **Beacon Consumer**: Message structure, deduplication, retry logic
- **Decision Service**: Response structure, cache key generation, slate fallback
- **Error Handling**: Invalid URLs, malformed responses, timeout handling

**Coverage**: 20+ tests

### 2. Integration Tests

#### Basic Integration (`tests/integration.test.ts`)
- SCTE-35 detection → Ad insertion (SGAI/SSAI)
- Decision service → VAST parser integration
- End-to-end flow verification
- Waterfall fallback logic
- Bitrate-aware ad selection
- Multi-service health checks

**Coverage**: 20+ tests

#### Comprehensive E2E (`tests/e2e-comprehensive.test.ts`)
- **Complete Workflows**: Manifest → Decision → Ad Insertion → Beacons
- **Mode Selection**: User-Agent based SGAI/SSAI selection
- **Decision Integration**: Caching, geography-based selection, fallbacks
- **VAST Integration**: Inline VAST, wrapper resolution, bitrate selection
- **Multi-Service**: Service bindings, health checks, coordination
- **Real-World Scenarios**: Live sports, news channels, premium subscribers

**Coverage**: 40+ tests

### 3. Performance Tests (`tests/performance.test.ts`)

#### HLS Performance
- Small manifests (< 10ms)
- Large manifests (1K segments < 100ms)
- Extra large manifests (10K segments < 1s)
- Consistent performance across operations

#### SCTE-35 Performance
- Parsing throughput (> 10K ops/sec)
- Signal extraction with large manifests
- Memory efficiency

#### Signing Performance
- URL signing (< 5ms average, > 200 ops/sec)
- Concurrent signing operations
- Throughput benchmarks

#### Latency Targets
- P50/P95/P99 percentiles
- Manifest manipulation (P50 < 5ms)
- SCTE-35 parsing (P50 < 5ms)
- URL signing (P50 < 3ms)

#### Scalability
- High concurrency simulation (100+ concurrent ops)
- Sustained throughput (> 1K ops/sec)

**Coverage**: 25+ performance benchmarks

### 4. Chaos & Failure Tests (`tests/chaos.test.ts`)

#### Malformed Input
- Null/empty manifests
- Binary data in manifests
- Missing required SCTE-35 attributes
- Malformed durations and timestamps

#### Resource Exhaustion
- Very deep nesting (1000+ attributes)
- Very large manifests (50K segments)
- Repeated parsing (memory leak detection)
- Rapid signing operations

#### Concurrent Access
- Concurrent manifest manipulation
- Concurrent SCTE-35 parsing
- Race condition prevention

#### Edge Cases
- Empty ad segment lists
- Non-existent PDT timestamps
- Negative/zero durations
- Extremely long URLs
- Special characters in names

#### Time/Date Edge Cases
- Year boundaries
- Microsecond precision
- Timezone offsets
- Far past/future dates

#### Attack Vectors
- JWT tampering attempts
- HTML/XSS in attributes
- SQL injection patterns
- Path traversal
- Newline injection

#### Data Corruption
- Partially corrupted manifests
- Mixed encodings
- Truncated data

**Coverage**: 50+ edge cases and failure scenarios

## Test Execution

### Prerequisites

```bash
# Install dependencies
npm install

# For integration tests, start workers:
npm run dev:manifest   # Terminal 1 (port 8787)
npm run dev:decision   # Terminal 2 (port 8788)
npm run dev:beacon     # Terminal 3 (port 8789)
npm run dev:vast       # Terminal 4 (port 8790)
```

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test tests/hls-advanced.test.ts

# With coverage (if configured)
npm run test:coverage

# Watch mode
npm test -- --watch
```

### Using Test Runner

```bash
# Comprehensive test suite
./run-tests.sh

# Unit tests only (no workers required)
./run-tests.sh --unit

# Integration tests (requires workers)
./run-tests.sh --integration

# Performance benchmarks
./run-tests.sh --performance

# Chaos/failure tests
./run-tests.sh --chaos

# Quick smoke test (< 1 minute)
./run-tests.sh --quick
```

## Test Coverage Summary

| Category | Test Files | Test Count | Coverage |
|----------|------------|------------|----------|
| **Unit Tests** | 7 files | 200+ tests | Core functionality, parsers, security |
| **Integration Tests** | 2 files | 60+ tests | Multi-service workflows |
| **Performance Tests** | 1 file | 25+ benchmarks | Latency, throughput, scalability |
| **Chaos Tests** | 1 file | 50+ scenarios | Failure modes, edge cases |
| **TOTAL** | **11 files** | **335+ tests** | **Comprehensive** |

## Performance Targets

### Latency (P50)
- Manifest manipulation: < 5ms
- SCTE-35 parsing: < 5ms
- URL signing: < 3ms
- Decision service: < 150ms

### Throughput
- HLS operations: > 1,000 ops/sec
- SCTE-35 parsing: > 10,000 ops/sec
- URL signing: > 200 ops/sec

### Scalability
- Concurrent operations: 100+ simultaneous
- Large manifests: 10,000 segments in < 1s
- Sustained load: > 1,000 ops/sec

## Best Practices

### Writing Tests

1. **Use descriptive names**: Test names should clearly state what is being tested
2. **Isolate tests**: Each test should be independent and not rely on others
3. **Test edge cases**: Include boundary conditions and error scenarios
4. **Performance benchmarks**: Include timing assertions for critical paths
5. **Clear assertions**: Use specific assertions with meaningful messages

### Test Organization

```typescript
describe("Component Name", () => {
  describe("Feature Group", () => {
    test("Specific behavior test", () => {
      // Arrange
      const input = createTestData()
      
      // Act
      const result = functionUnderTest(input)
      
      // Assert
      assert.equal(result, expectedOutput)
    })
  })
})
```

### Performance Testing

```typescript
// Measure execution time
const start = performance.now()
const result = expensiveOperation()
const duration = performance.now() - start

assert.ok(duration < TARGET_MS, `Should complete in < ${TARGET_MS}ms`)
console.log(`⏱️  Operation took ${duration.toFixed(2)}ms`)
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: ./run-tests.sh --unit
      - run: ./run-tests.sh --performance
```

## Troubleshooting

### Tests Failing

1. **Check Dependencies**: Run `npm install` to ensure all packages are installed
2. **Worker Status**: For integration tests, ensure all workers are running
3. **Port Conflicts**: Verify ports 8787-8790 are available
4. **Environment**: Check that `.dev.vars` is properly configured

### Slow Tests

1. **Reduce Iterations**: Lower iteration counts in performance tests for faster runs
2. **Skip Performance Tests**: Use `./run-tests.sh --unit` to skip benchmarks
3. **Parallel Execution**: Tests run in parallel by default with Node test runner

### Integration Test Failures

1. **Start Workers**: Ensure all workers are running before integration tests
2. **Wait for Ready**: Give workers a few seconds to fully initialize
3. **Check Logs**: Use `wrangler tail` to see worker logs
4. **Network Issues**: Verify localhost connectivity

## Test Metrics

### Expected Results

When all tests pass, you should see:

```
✓ All tests passed!

Total Test Suites:  11
Passed:             11
Failed:             0
Duration:           45s
```

### Performance Benchmarks

Typical performance results on modern hardware:

- HLS manipulation (10K segments): ~50ms
- SCTE-35 parsing throughput: ~15,000 ops/sec
- URL signing P50 latency: ~2ms
- End-to-end SSAI flow: < 200ms

## Contributing

When adding new features:

1. Write tests first (TDD)
2. Include unit tests for new utilities
3. Add integration tests for new workflows
4. Include performance benchmarks for hot paths
5. Add edge case tests to chaos suite
6. Update this guide with new test categories

## Resources

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [TypeScript Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [HLS Specification](https://datatracker.ietf.org/doc/html/rfc8216)
- [SCTE-35 Standard](https://www.scte.org/standards/library/catalog/scte-35-digital-program-insertion-cueing-message/)
- [VAST Specification](https://www.iab.com/guidelines/vast/)

