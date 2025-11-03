// tests/golden.test.ts
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { insertDiscontinuity, addDaterangeInterstitial } from "../src/utils/hls.ts";
import { signPath } from "../src/utils/sign.ts";
import { windowBucket } from "../src/utils/time.ts";
import { parseJWTUnsafe } from "../src/utils/jwt.ts";

const ORIGIN = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:1000
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:00Z
#EXTINF:4.000,
seg_1000.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:04Z
#EXTINF:4.000,
seg_1001.m4s
#EXT-X-PROGRAM-DATE-TIME:2025-10-31T12:00:08Z
#EXTINF:4.000,
seg_1002.m4s
`;

describe("utils/hls.ts", () => {
  test("insertDiscontinuity(): injects before last media segment (legacy fallback)", () => {
    const out = insertDiscontinuity(ORIGIN);
    // Find the last segment line and ensure a discontinuity is inserted before it.
    const lines = out.trim().split("\n");
    const lastSegIdx = lines.findIndex((l) => l.trim() === "seg_1002.m4s");
    assert.ok(lastSegIdx > 0, "last segment not found");
    assert.equal(lines[lastSegIdx - 1].trim(), "#EXT-X-DISCONTINUITY");
  });

  test("addDaterangeInterstitial(): inserts a valid interstitial DATERANGE tag", () => {
    const out = addDaterangeInterstitial(
      ORIGIN,
      "ad-0",
      "2025-10-31T12:00:08Z",
      30,
      "https://ads.example.com/pods/example-pod/v_1600k/playlist.m3u8"
    );
    assert.match(out, /#EXT-X-DATERANGE:/);
    assert.match(out, /CLASS="com\.apple\.hls\.interstitial"/);
    assert.match(out, /START-DATE="2025-10-31T12:00:08Z"/);
    assert.match(out, /DURATION=30\.000/);
    assert.match(out, /X-ASSET-URI="https:\/\/ads\.example\.com\/pods\/example-pod\/v_1600k\/playlist\.m3u8"/);
  });
});

describe("utils/sign.ts", () => {
  test("signPath(): returns a URL with token and exp", async () => {
    const url = await signPath("media.example.com", "dev_secret", "/pods/x.m3u8", 60);
    const u = new URL(url);
    assert.equal(u.origin, "https://media.example.com");
    assert.equal(u.pathname, "/pods/x.m3u8");
    assert.ok(u.searchParams.get("token"), "token missing");
    assert.ok(/^\d+$/.test(u.searchParams.get("exp") || ""), "exp missing or not a number");
  });

  test("signPath(): throws if path is not absolute", async () => {
    let threw = false;
    try {
      await signPath("media.example.com", "dev_secret", "pods/x.m3u8", 60);
    } catch {
      threw = true;
    }
    assert.ok(threw, "expected throw for non-absolute path");
  });
});

describe("utils/time.ts", () => {
  test("windowBucket(): buckets by stride", () => {
    assert.equal(windowBucket(10, 2), 5);
    assert.equal(windowBucket(9, 2), 4);
    assert.equal(windowBucket(10, 3), 3);
  });
});

describe("utils/jwt.ts", () => {
  test("parseJWTUnsafe(): decodes JWT payload without verification", () => {
    // Create a simple test JWT (header.payload.signature format)
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify({ sub: "user123", exp: 9999999999, bucket: "A" }));
    const signature = "fake_signature";
    const token = `${header}.${payload}.${signature}`;

    const decoded = parseJWTUnsafe(token);
    assert.ok(decoded, "should decode token");
    assert.equal(decoded?.sub, "user123");
    assert.equal(decoded?.bucket, "A");
  });

  test("parseJWTUnsafe(): returns null for malformed tokens", () => {
    assert.equal(parseJWTUnsafe("invalid"), null);
    assert.equal(parseJWTUnsafe("invalid.token"), null);
    assert.equal(parseJWTUnsafe(""), null);
  });
});