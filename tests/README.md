# CF-SSAI Test Suite

Comprehensive test suite for the Cloudflare SSAI/SGAI platform.

## Quick Start

```bash
# Run all tests
npm test

# Run comprehensive test suite with reporting
./run-tests.sh

# Run specific category
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests (requires workers)
npm run test:performance # Performance benchmarks
npm run test:chaos       # Chaos/failure tests
npm run test:quick       # Quick smoke test
```

## Test Files

### Unit Tests
- `golden.test.ts` - Core utilities (HLS, signing, JWT, time)
- `hls-advanced.test.ts` - Advanced HLS manipulation (50+ tests)
- `security.test.ts` - JWT verification and URL signing (40+ tests)
- `scte35.test.ts` - Basic SCTE-35 parsing (15+ tests)
- `scte35-advanced.test.ts` - Advanced SCTE-35 features (60+ tests)
- `vast.test.ts` - VAST XML parsing (14+ tests)
- `workers.test.ts` - Worker structure validation (20+ tests)

### Integration Tests
- `integration.test.ts` - Multi-service integration (20+ tests)
- `e2e-comprehensive.test.ts` - Complete workflows (40+ tests)

### Performance Tests
- `performance.test.ts` - Benchmarks and latency tests (25+ tests)

### Chaos Tests
- `chaos.test.ts` - Failure scenarios and edge cases (50+ tests)

## Test Coverage

- **Total Tests**: 335+
- **Test Files**: 11
- **Coverage**: Comprehensive
- **Status**: ✅ Production Ready

## Running Tests

### Prerequisites

```bash
npm install
```

For integration tests, start workers:
```bash
npm run dev:manifest   # Terminal 1
npm run dev:decision   # Terminal 2
npm run dev:beacon     # Terminal 3
npm run dev:vast       # Terminal 4
```

### Individual Test Files

```bash
npm test tests/hls-advanced.test.ts
npm test tests/security.test.ts
npm test tests/scte35-advanced.test.ts
npm test tests/performance.test.ts
npm test tests/chaos.test.ts
```

### Test Runner Modes

```bash
./run-tests.sh              # All tests
./run-tests.sh --unit       # Unit tests only
./run-tests.sh --integration # Integration tests
./run-tests.sh --performance # Performance benchmarks
./run-tests.sh --chaos      # Chaos tests
./run-tests.sh --quick      # Quick smoke test
```

## Test Categories

### 1. HLS Manipulation
- Parsing master playlists
- DISCONTINUITY insertion
- SGAI interstitial DATERANGE
- SSAI segment replacement
- Edge cases (large manifests, Unicode, etc.)

### 2. SCTE-35 Detection
- All signal types (splice_insert, time_signal, return_signal)
- Segmentation types (provider/distributor ads, program boundaries)
- Break duration calculation
- Multi-pod sequences
- Real-world scenarios

### 3. VAST Parsing
- VAST 3.0/4.2 support
- Inline and wrapper ads
- Media file selection (HLS preference)
- Tracking URL extraction
- Error handling

### 4. Security
- JWT verification (HS256/RS256)
- URL signing with HMAC
- Attack vector prevention
- Injection protection
- Algorithm confusion prevention

### 5. Integration
- Complete SSAI workflow
- Complete SGAI workflow
- User-Agent based mode selection
- Multi-service coordination
- Caching and fallback logic

### 6. Performance
- Latency benchmarks (P50/P95/P99)
- Throughput tests (ops/sec)
- Scalability (concurrent operations)
- Memory efficiency
- Cache effectiveness

### 7. Chaos/Failure
- Malformed input handling
- Resource exhaustion
- Concurrent access patterns
- Edge case data scenarios
- Time/date edge cases
- Data corruption scenarios

## Performance Targets

- HLS manipulation (1K segments): < 100ms
- SCTE-35 parsing: > 10,000 ops/sec
- URL signing: < 3ms P50 latency
- Decision service: < 150ms
- Concurrent operations: 100+

## Documentation

See:
- `../TESTING_GUIDE.md` - Complete testing guide
- `../TEST_SUMMARY.md` - Test suite summary
- `../run-tests.sh` - Test runner script

## Contributing

When adding new tests:
1. Follow existing test structure
2. Use descriptive test names
3. Include edge cases
4. Add performance benchmarks for critical paths
5. Update documentation

## Status

✅ **Production Ready**
- 335+ tests passing
- All categories covered
- Performance benchmarked
- Chaos tested
- Security hardened

