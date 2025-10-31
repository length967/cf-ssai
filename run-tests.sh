#!/bin/bash
# Comprehensive Test Runner for CF-SSAI Platform
# Runs all test suites with proper reporting

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   CF-SSAI Comprehensive Test Suite                      ║${NC}"
echo -e "${BLUE}║   Testing SSAI/SGAI Platform Components                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to run a test suite
run_test_suite() {
    local suite_name=$1
    local test_file=$2
    
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Running: ${suite_name}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    if npm test -- "$test_file" 2>&1; then
        echo -e "${GREEN}✓ ${suite_name} passed${NC}"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ ${suite_name} failed${NC}"
        ((FAILED_TESTS++))
    fi
    
    ((TOTAL_TESTS++))
    echo ""
}

# Parse command line arguments
MODE="all"
if [ "$1" = "--unit" ]; then
    MODE="unit"
elif [ "$1" = "--integration" ]; then
    MODE="integration"
elif [ "$1" = "--performance" ]; then
    MODE="performance"
elif [ "$1" = "--chaos" ]; then
    MODE="chaos"
elif [ "$1" = "--quick" ]; then
    MODE="quick"
fi

# Quick smoke tests (essential tests only)
if [ "$MODE" = "quick" ]; then
    echo -e "${YELLOW}Running quick smoke tests...${NC}"
    echo ""
    
    run_test_suite "Core HLS Tests" "tests/golden.test.ts"
    run_test_suite "SCTE-35 Basic Tests" "tests/scte35.test.ts"
    run_test_suite "VAST Basic Tests" "tests/vast.test.ts"
fi

# Unit tests
if [ "$MODE" = "all" ] || [ "$MODE" = "unit" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Unit Tests${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    run_test_suite "Core Utilities" "tests/golden.test.ts"
    run_test_suite "Worker Components" "tests/workers.test.ts"
    run_test_suite "HLS Advanced" "tests/hls-advanced.test.ts"
    run_test_suite "Security & JWT" "tests/security.test.ts"
    run_test_suite "SCTE-35 Parser" "tests/scte35.test.ts"
    run_test_suite "SCTE-35 Advanced" "tests/scte35-advanced.test.ts"
    run_test_suite "VAST Parser" "tests/vast.test.ts"
fi

# Integration tests (require workers to be running)
if [ "$MODE" = "all" ] || [ "$MODE" = "integration" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Integration Tests${NC}"
    echo -e "${BLUE}   (Requires workers running: npm run dev:*)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Check if workers are running
    if ! curl -s http://localhost:8787 > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Warning: Manifest worker not running at localhost:8787${NC}"
        echo -e "${YELLOW}   Start with: npm run dev:manifest${NC}"
        echo ""
    fi
    
    run_test_suite "Integration Tests" "tests/integration.test.ts"
    run_test_suite "End-to-End Tests" "tests/e2e-comprehensive.test.ts"
fi

# Performance tests
if [ "$MODE" = "all" ] || [ "$MODE" = "performance" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Performance Tests${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    run_test_suite "Performance & Load Tests" "tests/performance.test.ts"
fi

# Chaos/failure tests
if [ "$MODE" = "all" ] || [ "$MODE" = "chaos" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}   Chaos & Failure Tests${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    run_test_suite "Chaos & Edge Cases" "tests/chaos.test.ts"
fi

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Print summary
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Test Summary                                           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Total Test Suites:  ${TOTAL_TESTS}"
echo -e "  ${GREEN}Passed:             ${PASSED_TESTS}${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "  ${RED}Failed:             ${FAILED_TESTS}${NC}"
fi
echo -e "  Duration:           ${DURATION}s"
echo ""

# Exit with appropriate code
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
fi

