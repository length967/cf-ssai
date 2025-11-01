import { createHash } from "node:crypto"

function md5(s: string) { return createHash("md5").update(s).digest("hex") }

export interface Env { 
  SEGMENT_SECRET: string
  R2_PUBLIC_URL: string
}

export default {
  async fetch(req: Request, env: Env) {
    const u = new URL(req.url)
    const token = u.searchParams.get("token") || ""
    const exp = Number(u.searchParams.get("exp") || "0")
    if (!token || (Date.now()/1000) > exp) return new Response("expired", { status: 403 })

    const base = `${env.SEGMENT_SECRET}${u.pathname}${exp}`
    if (md5(base) !== token) return new Response("forbidden", { status: 403 })

    // Proxy to R2 public origin (from environment)
    u.searchParams.delete("token"); u.searchParams.delete("exp")
    const r2BaseUrl = env.R2_PUBLIC_URL || "https://pub-24423d0273094578a7f498bd462c2e20.r2.dev"
    const origin = `${r2BaseUrl}${u.pathname}${u.search}`
    return fetch(origin, { cf: { cacheTtl: 3600, cacheEverything: true } })
  }
}