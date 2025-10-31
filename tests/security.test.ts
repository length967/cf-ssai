// Security and JWT Tests
// Comprehensive tests for JWT verification, signing, and security features

import { strict as assert } from "node:assert"
import { test, describe } from "node:test"
import { verifyJWT, parseJWTUnsafe } from "../src/utils/jwt"
import { signPath } from "../src/utils/sign"

// Test keys (for testing only - never use in production)
const TEST_HS256_SECRET = "test-secret-key-do-not-use-in-production"
const TEST_RS256_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JTYqb5fhPZJJpZ
-----END PUBLIC KEY-----`

describe("JWT Parsing (Unsafe)", () => {
  test("parseJWTUnsafe() decodes valid JWT payload", () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = btoa(JSON.stringify({ sub: "user123", exp: 9999999999, bucket: "premium" }))
    const signature = "fake_signature"
    const token = `${header}.${payload}.${signature}`

    const decoded = parseJWTUnsafe(token)
    
    assert.ok(decoded)
    assert.equal(decoded?.sub, "user123")
    assert.equal(decoded?.bucket, "premium")
  })

  test("parseJWTUnsafe() returns null for invalid format", () => {
    const invalid = [
      "invalid",
      "invalid.token",
      "invalid.token.signature.extra",
      "",
      ".",
      "..",
      "...",
    ]

    for (const token of invalid) {
      const result = parseJWTUnsafe(token)
      assert.equal(result, null, `Should reject: ${token}`)
    }
  })

  test("parseJWTUnsafe() handles malformed base64", () => {
    const token = "invalid_base64.invalid_base64.sig"
    const result = parseJWTUnsafe(token)
    
    assert.equal(result, null)
  })

  test("parseJWTUnsafe() extracts all standard JWT claims", () => {
    const payload = {
      sub: "user123",
      iss: "test-issuer",
      aud: "test-audience",
      exp: 9999999999,
      nbf: 1000000000,
      iat: 1000000000,
      jti: "token-id-123"
    }

    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    const token = `${header}.${payloadB64}.sig`

    const decoded = parseJWTUnsafe(token)
    
    assert.equal(decoded?.sub, "user123")
    assert.equal((decoded as any)?.iss, "test-issuer")
    assert.equal((decoded as any)?.aud, "test-audience")
  })

  test("parseJWTUnsafe() handles custom claims", () => {
    const payload = {
      sub: "user123",
      exp: 9999999999,
      bucket: "premium",
      geo: { country: "US", region: "CA" },
      consent: { tcf: "CPXXXXXX" },
      customField: "customValue"
    }

    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    const token = `${header}.${payloadB64}.sig`

    const decoded = parseJWTUnsafe(token)
    
    assert.equal(decoded?.bucket, "premium")
    assert.equal(decoded?.geo?.country, "US")
    assert.equal(decoded?.consent?.tcf, "CPXXXXXX")
  })
})

describe("JWT Verification (HS256)", () => {
  test("verifyJWT() accepts valid HS256 token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const payload = { sub: "user123", exp, bucket: "A" }
    
    // Create a properly signed JWT (simplified for test)
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    // Generate signature using WebCrypto
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(TEST_HS256_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const signedData = `${header}.${payloadB64}`
    const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedData))
    const sigArray = new Uint8Array(sigBuffer)
    const sigB64 = btoa(String.fromCharCode(...sigArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    
    const token = `${header}.${payloadB64}.${sigB64}`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    
    assert.ok(verified)
    assert.equal(verified?.sub, "user123")
  })

  test("verifyJWT() rejects expired token", async () => {
    const exp = Math.floor(Date.now() / 1000) - 3600  // Expired 1 hour ago
    const payload = { sub: "user123", exp, bucket: "A" }
    
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(TEST_HS256_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const signedData = `${header}.${payloadB64}`
    const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedData))
    const sigArray = new Uint8Array(sigBuffer)
    const sigB64 = btoa(String.fromCharCode(...sigArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    
    const token = `${header}.${payloadB64}.${sigB64}`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    
    assert.equal(verified, null, "Should reject expired token")
  })

  test("verifyJWT() rejects token with invalid signature", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const payload = { sub: "user123", exp, bucket: "A" }
    
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    const invalidSig = "invalid_signature"
    
    const token = `${header}.${payloadB64}.${invalidSig}`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    
    assert.equal(verified, null, "Should reject invalid signature")
  })

  test("verifyJWT() rejects algorithm mismatch", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const payload = { sub: "user123", exp }
    
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))  // Claims RS256
    const payloadB64 = btoa(JSON.stringify(payload))
    const sig = "some_signature"
    
    const token = `${header}.${payloadB64}.${sig}`
    
    // Try to verify as HS256
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    
    assert.equal(verified, null, "Should reject algorithm mismatch")
  })

  test("verifyJWT() handles token without expiration", async () => {
    const payload = { sub: "user123", bucket: "A" }  // No exp claim
    
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(TEST_HS256_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const signedData = `${header}.${payloadB64}`
    const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedData))
    const sigArray = new Uint8Array(sigBuffer)
    const sigB64 = btoa(String.fromCharCode(...sigArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    
    const token = `${header}.${payloadB64}.${sigB64}`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    
    // Should accept token without expiration
    assert.ok(verified)
  })
})

describe("URL Signing", () => {
  test("signPath() generates signed URL with token and expiration", async () => {
    const signedUrl = await signPath("media.example.com", "secret123", "/ads/pod1.m3u8", 600)
    
    const url = new URL(signedUrl)
    
    assert.equal(url.protocol, "https:")
    assert.equal(url.hostname, "media.example.com")
    assert.equal(url.pathname, "/ads/pod1.m3u8")
    assert.ok(url.searchParams.has("token"))
    assert.ok(url.searchParams.has("exp"))
  })

  test("signPath() generates valid HMAC signature", async () => {
    const secret = "test-secret"
    const path = "/test/path.m3u8"
    const ttl = 300
    
    const signedUrl = await signPath("media.example.com", secret, path, ttl)
    const url = new URL(signedUrl)
    
    const token = url.searchParams.get("token")
    const exp = url.searchParams.get("exp")
    
    assert.ok(token)
    assert.ok(exp)
    assert.equal(token.length, 64)  // HMAC-SHA256 = 32 bytes = 64 hex chars
  })

  test("signPath() includes IP binding when provided", async () => {
    const signedUrl = await signPath("media.example.com", "secret123", "/ads/pod1.m3u8", 600, "192.168.1.1")
    
    const url = new URL(signedUrl)
    assert.equal(url.searchParams.get("ip"), "192.168.1.1")
  })

  test("signPath() sets correct expiration time", async () => {
    const ttl = 300
    const before = Math.floor(Date.now() / 1000) + ttl
    
    const signedUrl = await signPath("media.example.com", "secret123", "/ads/pod1.m3u8", ttl)
    
    const url = new URL(signedUrl)
    const exp = parseInt(url.searchParams.get("exp") || "0")
    const after = Math.floor(Date.now() / 1000) + ttl
    
    assert.ok(exp >= before && exp <= after, "Expiration should be approximately now + TTL")
  })

  test("signPath() throws on relative path", async () => {
    await assert.rejects(
      async () => {
        await signPath("media.example.com", "secret123", "relative/path.m3u8", 600)
      },
      /absolute path/
    )
  })

  test("signPath() handles paths with query parameters", async () => {
    const path = "/ads/pod1.m3u8?variant=high"
    
    const signedUrl = await signPath("media.example.com", "secret123", path, 600)
    const url = new URL(signedUrl)
    
    assert.equal(url.pathname, "/ads/pod1.m3u8")
    assert.ok(url.searchParams.has("variant"))
    assert.ok(url.searchParams.has("token"))
  })

  test("signPath() generates different tokens for different paths", async () => {
    const url1 = await signPath("media.example.com", "secret", "/path1.m3u8", 600)
    const url2 = await signPath("media.example.com", "secret", "/path2.m3u8", 600)
    
    const token1 = new URL(url1).searchParams.get("token")
    const token2 = new URL(url2).searchParams.get("token")
    
    assert.notEqual(token1, token2)
  })

  test("signPath() generates different tokens for different IPs", async () => {
    const url1 = await signPath("media.example.com", "secret", "/path.m3u8", 600, "192.168.1.1")
    const url2 = await signPath("media.example.com", "secret", "/path.m3u8", 600, "192.168.1.2")
    
    const token1 = new URL(url1).searchParams.get("token")
    const token2 = new URL(url2).searchParams.get("token")
    
    assert.notEqual(token1, token2)
  })

  test("signPath() handles Unicode in paths", async () => {
    const path = "/ads/测试.m3u8"
    
    const signedUrl = await signPath("media.example.com", "secret123", path, 600)
    const url = new URL(signedUrl)
    
    assert.ok(url.href.includes(encodeURIComponent("测试")))
  })
})

describe("Security Best Practices", () => {
  test("JWT expiration is enforced", async () => {
    const expiredPayload = { 
      sub: "user123", 
      exp: Math.floor(Date.now() / 1000) - 1 
    }
    
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(expiredPayload))
    
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(TEST_HS256_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const signedData = `${header}.${payloadB64}`
    const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedData))
    const sigArray = new Uint8Array(sigBuffer)
    const sigB64 = btoa(String.fromCharCode(...sigArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    
    const token = `${header}.${payloadB64}.${sigB64}`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    assert.equal(verified, null, "Expired token must be rejected")
  })

  test("Signature verification is mandatory", async () => {
    const payload = { sub: "user123", exp: 9999999999 }
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    // Wrong signature
    const token = `${header}.${payloadB64}.wrong_signature`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    assert.equal(verified, null, "Invalid signature must be rejected")
  })

  test("Algorithm confusion is prevented", async () => {
    // Token claims to use RS256 but we try to verify with HS256
    const payload = { sub: "user123", exp: 9999999999 }
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    const sig = "some_sig"
    
    const token = `${header}.${payloadB64}.${sig}`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    assert.equal(verified, null, "Algorithm mismatch must be rejected")
  })

  test("URL signatures use cryptographically secure HMAC", async () => {
    const path = "/ads/pod1.m3u8"
    const secret = "test-secret-key"
    
    const url1 = await signPath("media.example.com", secret, path, 600)
    const url2 = await signPath("media.example.com", secret, path, 600)
    
    // Same path should generate similar tokens (with different exp)
    const token1 = new URL(url1).searchParams.get("token")
    const token2 = new URL(url2).searchParams.get("token")
    
    // Tokens should be hex strings (HMAC output)
    assert.match(token1 || "", /^[0-9a-f]{64}$/)
    assert.match(token2 || "", /^[0-9a-f]{64}$/)
  })

  test("Signature cannot be forged without secret", async () => {
    const secret1 = "secret1"
    const secret2 = "secret2"
    const path = "/ads/pod1.m3u8"
    
    const url1 = await signPath("media.example.com", secret1, path, 600)
    const url2 = await signPath("media.example.com", secret2, path, 600)
    
    const token1 = new URL(url1).searchParams.get("token")
    const token2 = new URL(url2).searchParams.get("token")
    
    assert.notEqual(token1, token2, "Different secrets produce different signatures")
  })
})

describe("Attack Vectors", () => {
  test("Rejects JWT with 'none' algorithm", async () => {
    const payload = { sub: "attacker", exp: 9999999999 }
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    const token = `${header}.${payloadB64}.`
    
    const verified = await verifyJWT(token, TEST_HS256_SECRET, "HS256")
    assert.equal(verified, null, "Must reject 'none' algorithm")
  })

  test("Rejects tampered payload", async () => {
    // Create valid token first
    const payload = { sub: "user123", exp: 9999999999, bucket: "free" }
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(payload))
    
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(TEST_HS256_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const signedData = `${header}.${payloadB64}`
    const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedData))
    const sigArray = new Uint8Array(sigBuffer)
    const sigB64 = btoa(String.fromCharCode(...sigArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    
    // Tamper with payload (change bucket to premium)
    const tamperedPayload = { sub: "user123", exp: 9999999999, bucket: "premium" }
    const tamperedPayloadB64 = btoa(JSON.stringify(tamperedPayload))
    
    const tamperedToken = `${header}.${tamperedPayloadB64}.${sigB64}`
    
    const verified = await verifyJWT(tamperedToken, TEST_HS256_SECRET, "HS256")
    assert.equal(verified, null, "Must reject tampered payload")
  })

  test("Handles extremely long tokens", async () => {
    const longPayload = {
      sub: "user",
      exp: 9999999999,
      data: "x".repeat(100000)
    }
    
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadB64 = btoa(JSON.stringify(longPayload))
    
    const token = `${header}.${payloadB64}.sig`
    
    // Should handle gracefully without crashing
    const parsed = parseJWTUnsafe(token)
    assert.ok(parsed)
  })

  test("Handles malicious path injection in URL signing", async () => {
    const maliciousPath = "/../../etc/passwd"
    
    // Should sign the path as-is (validation should happen elsewhere)
    const signedUrl = await signPath("media.example.com", "secret", maliciousPath, 600)
    
    const url = new URL(signedUrl)
    assert.ok(url.pathname.includes(".."))
  })
})

