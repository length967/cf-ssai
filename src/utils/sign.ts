// Web Crypto (Workers-native) HMAC-SHA256 signer.
// token = hex(HMAC_SHA256(secret, path + exp + (ip||"")))

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0")
  return s
}

/**
 * Sign a CDN path for short-lived access.
 * @param host Public host to prefix (no scheme switching here)
 * @param secret Raw secret string (keep in secrets)
 * @param path Absolute URL path beginning with '/'
 * @param ttlSec Token TTL in seconds (default 900s)
 * @param ip Optional IP bind
 */
export async function signPath(
  host: string,
  secret: string,
  path: string,
  ttlSec = 900,
  ip?: string
): Promise<string> {
  if (!path.startsWith("/")) throw new Error("signPath expects an absolute path beginning with '/'")
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const data = enc.encode(`${path}${exp}${ip ?? ""}`)
  const sig = await crypto.subtle.sign("HMAC", key, data)
  const token = toHex(sig)
  const qs = new URLSearchParams({ token, exp: String(exp) })
  if (ip) qs.set("ip", ip)
  return `https://${host}${path}?${qs.toString()}`
}