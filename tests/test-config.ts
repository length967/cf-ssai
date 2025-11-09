// Test Configuration
// Centralized configuration for test URLs and settings
// Supports both local development and CI/production testing

/**
 * Base URLs for different workers in test environments
 *
 * Local Development:
 * - Set TEST_ENV=local (default)
 * - Uses localhost URLs matching package.json dev scripts
 *
 * CI/Production Testing:
 * - Set TEST_ENV=production
 * - Override individual URLs via environment variables
 */

const TEST_ENV = process.env.TEST_ENV || "local"

// Default local development URLs (from package.json dev scripts)
const LOCAL_URLS = {
  MANIFEST: "http://localhost:8787",
  DECISION: "http://localhost:8788",
  BEACON: "http://localhost:8789",
  VAST: "http://localhost:8790",
  ADMIN_API: "http://localhost:8791",
}

// Production/deployed URLs (override via environment variables)
const PRODUCTION_URLS = {
  MANIFEST: process.env.TEST_URL_MANIFEST || "https://cf-ssai.YOUR_SUBDOMAIN.workers.dev",
  DECISION: process.env.TEST_URL_DECISION || "https://cf-ssai-decision.YOUR_SUBDOMAIN.workers.dev",
  BEACON: process.env.TEST_URL_BEACON || "https://cf-ssai-beacon-consumer.YOUR_SUBDOMAIN.workers.dev",
  VAST: process.env.TEST_URL_VAST || "https://cf-ssai-vast-parser.YOUR_SUBDOMAIN.workers.dev",
  ADMIN_API: process.env.TEST_URL_ADMIN_API || "https://cf-ssai-admin-api.YOUR_SUBDOMAIN.workers.dev",
}

// Select URLs based on environment
const URLS = TEST_ENV === "production" ? PRODUCTION_URLS : LOCAL_URLS

/**
 * Exported test configuration
 */
export const TEST_CONFIG = {
  // Worker URLs
  BASE_URL_MANIFEST: URLS.MANIFEST,
  BASE_URL_DECISION: URLS.DECISION,
  BASE_URL_BEACON: URLS.BEACON,
  BASE_URL_VAST: URLS.VAST,
  BASE_URL_ADMIN_API: URLS.ADMIN_API,

  // Test data URLs (fake but realistic)
  FAKE_AD_URL: "https://test-ads.example.internal/ad.m3u8",
  FAKE_ORIGIN_URL: "https://test-origin.example.internal/stream.m3u8",
  FAKE_VAST_URL: "https://test-vast.example.internal/vast.xml",
  FAKE_BEACON_URL: "https://test-tracking.example.internal/beacon",

  // Test settings
  IS_LOCAL: TEST_ENV === "local",
  IS_PRODUCTION: TEST_ENV === "production",
  TIMEOUT_MS: parseInt(process.env.TEST_TIMEOUT_MS || "10000"),

  // Skip integration tests if workers aren't running
  SKIP_INTEGRATION: process.env.SKIP_INTEGRATION === "1",
}

/**
 * Helper to check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  if (TEST_CONFIG.SKIP_INTEGRATION) {
    return false
  }

  // In local mode, integration tests require dev servers running
  if (TEST_CONFIG.IS_LOCAL) {
    return true // Assume dev servers are running (will fail fast if not)
  }

  // In production mode, always run
  return true
}

/**
 * Helper to get full URL for a path
 */
export function getWorkerUrl(worker: keyof typeof URLS, path = ""): string {
  const baseUrl = TEST_CONFIG[`BASE_URL_${worker}`]
  return `${baseUrl}${path}`
}

// Export individual URLs for backward compatibility
export const {
  BASE_URL_MANIFEST,
  BASE_URL_DECISION,
  BASE_URL_BEACON,
  BASE_URL_VAST,
  BASE_URL_ADMIN_API,
  FAKE_AD_URL,
  FAKE_ORIGIN_URL,
  FAKE_VAST_URL,
  FAKE_BEACON_URL,
} = TEST_CONFIG
