// JWT verification using Cloudflare Workers WebCrypto API
// Supports HS256 (HMAC-SHA256) and RS256 (RSA-SHA256)

import type { ViewerJWT } from "../types"

/**
 * Base64 URL decode (RFC 4648)
 */
function base64UrlDecode(str: string): Uint8Array {
  // Convert base64url to base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  // Add padding if needed
  const pad = base64.length % 4
  if (pad) {
    base64 += "=".repeat(4 - pad)
  }
  // Decode base64 to binary
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Parse JWT header and payload without verification (for inspection)
 */
function parseJWTParts(token: string): { header: any; payload: any; signature: Uint8Array; signedData: string } | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])))
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])))
    const signature = base64UrlDecode(parts[2])
    const signedData = `${parts[0]}.${parts[1]}`

    return { header, payload, signature, signedData }
  } catch {
    return null
  }
}

/**
 * Import HMAC key for HS256
 */
async function importHS256Key(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
}

/**
 * Import RSA public key for RS256
 * Expects PEM format or JWK format
 */
async function importRS256Key(publicKey: string): Promise<CryptoKey> {
  // Try to parse as JWK first
  if (publicKey.trim().startsWith("{")) {
    try {
      const jwk = JSON.parse(publicKey)
      return await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      )
    } catch {
      // Fall through to PEM parsing
    }
  }

  // Parse PEM format
  const pemHeader = "-----BEGIN PUBLIC KEY-----"
  const pemFooter = "-----END PUBLIC KEY-----"
  const pemContents = publicKey
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "")

  const binaryDer = base64UrlDecode(pemContents)
  return await crypto.subtle.importKey(
    "spki",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  )
}

/**
 * Verify JWT signature using WebCrypto
 * @param token JWT token string
 * @param keyOrSecret Public key (RS256) or secret (HS256)
 * @param algorithm Expected algorithm ('HS256' or 'RS256')
 * @returns Parsed payload if valid, null otherwise
 */
export async function verifyJWT(
  token: string,
  keyOrSecret: string,
  algorithm: "HS256" | "RS256" = "RS256"
): Promise<ViewerJWT | null> {
  const parts = parseJWTParts(token)
  if (!parts) return null

  const { header, payload, signature, signedData } = parts

  // Verify algorithm matches
  if (header.alg !== algorithm) {
    console.warn(`JWT algorithm mismatch: expected ${algorithm}, got ${header.alg}`)
    return null
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) {
    console.warn("JWT expired")
    return null
  }

  // Import key based on algorithm
  let key: CryptoKey
  try {
    if (algorithm === "HS256") {
      key = await importHS256Key(keyOrSecret)
    } else {
      key = await importRS256Key(keyOrSecret)
    }
  } catch (err) {
    console.error("Failed to import key:", err)
    return null
  }

  // Verify signature
  const enc = new TextEncoder()
  const valid = await crypto.subtle.verify(
    algorithm === "HS256" ? "HMAC" : "RSASSA-PKCS1-v1_5",
    key,
    signature,
    enc.encode(signedData)
  )

  if (!valid) {
    console.warn("JWT signature verification failed")
    return null
  }

  return payload as ViewerJWT
}

/**
 * Parse JWT without verification (dev/testing only - INSECURE)
 * Only use when DEV_ALLOW_NO_AUTH is enabled
 */
export function parseJWTUnsafe(token: string): ViewerJWT | null {
  const parts = parseJWTParts(token)
  return parts ? (parts.payload as ViewerJWT) : null
}

