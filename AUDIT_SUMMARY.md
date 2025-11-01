# 📊 Codebase Audit Summary

## ✅ Good News: No TODOs or FIXMEs!

The codebase is clean of TODO/FIXME comments, which is excellent.

---

## 🔍 Issues Found: 26 Total

### 🔴 Critical (8) - Need Immediate Fix
1. **"example-pod" hardcoded fallback** - Will cause 404s
2. **Hardcoded "slate" pod URLs** (5 locations) - Assumes specific R2 structure
3. **DEV FALLBACK fake segment generator** - Generates non-existent segments
4. **Hardcoded tracking.example.com** - Non-functional tracking
5. **Hardcoded r2-public.example.com** - Segment guard won't work
6. **Hardcoded bitrate arrays** - Don't match actual transcoded ads
7. **Localhost in transcode worker** - Not configurable
8. **Localhost CORS origins** - Not flexible for production

### 🟡 Medium Priority (13)
- "Crude detection" comment for SGAI detection
- Hardcoded default bitrates in VAST parser
- Multiple fallback code sections (mostly acceptable)

### 🟢 Low Priority (5)
- Legitimate fallback mechanisms (no fix needed)
- Comments about production (reminders, not issues)

---

## 🎯 Recommended Action Plan

### Phase 1: Fix Critical Issues (4-6 hours)

1. **Replace all hardcoded "slate" references with database queries**
   - Files: `channel-do.ts`, `decision-worker.ts`, `vast-parser-worker.ts`
   - Implementation: Query `ad_pods` table for slate pod, use actual variants

2. **Remove DEV FALLBACK fake segment generator**
   - File: `channel-do.ts:171-187`
   - Implementation: Return proper 502 error instead

3. **Fix "example-pod" to use channel's slate**
   - File: `channel-do.ts:343`
   - Implementation: Use `channelConfig.slatePodId`

4. **Make hardcoded URLs configurable**
   - Add environment variables:
     - `CONTAINER_URL` (default: `http://localhost:8080`)
     - `TRACKING_BASE_URL` (optional)
     - `ALLOWED_ORIGINS` (comma-separated)

### Phase 2: Quality Improvements (Next Sprint)

5. Improve SGAI detection (feature-based, not UA-based)
6. Make VAST default bitrates dynamic
7. Clean up remaining hardcoded values

---

## 📈 Impact Assessment

### Current Risk: 🟡 MEDIUM

**Why:**
- Most hardcoded values are fallbacks (only triggered on errors)
- Primary flow (SCTE-35 → decision service → real ads) is working
- Slate pod (`pod_demo_slate`) happens to exist and is configured correctly
- Sticking issue was already fixed (fake segment URLs)

### After Fixes: 🟢 LOW

**Benefits:**
- No more 404 errors on fallback paths
- Fully database-driven configuration
- Production-ready error handling
- Flexible deployment (no hardcoded URLs)

---

## 📝 Files Requiring Changes

| File | Lines | Priority | Issue |
|------|-------|----------|-------|
| `src/channel-do.ts` | 171-187 | 🔴 HIGH | DEV FALLBACK generator |
| `src/channel-do.ts` | 280-285 | 🔴 HIGH | Hardcoded slate pod |
| `src/channel-do.ts` | 343 | 🔴 HIGH | "example-pod" fallback |
| `src/decision-worker.ts` | 317 | 🔴 HIGH | Hardcoded "slate" ID |
| `src/decision-worker.ts` | 446 | 🔴 HIGH | tracking.example.com |
| `src/vast-parser-worker.ts` | 422-423, 572-573 | 🔴 HIGH | Hardcoded slate pod |
| `src/segment-guard.ts` | 19 | 🔴 HIGH | r2-public.example.com |
| `src/transcode-worker.ts` | 81 | 🔴 HIGH | localhost:8080 |
| `src/admin-api-worker.ts` | 163-164 | 🟡 MED | Hardcoded CORS |
| `src/channel-do.ts` | 197 | 🟡 MED | Crude UA detection |

---

## ✅ What's Working Well

1. **No TODOs/FIXMEs** - Clean codebase
2. **Database-driven decision service** - Already implemented
3. **Real ad segment fetching** - Fixed in latest deployment
4. **Proper SCTE-35 parsing** - Working correctly
5. **Legitimate fallback mechanisms** - Good error handling

---

## 🚀 Ready to Fix?

**Review:**
1. Read `CODEBASE_AUDIT_REPORT.md` for detailed fixes
2. Run `./fix-hardcoded-values.sh` for interactive guide

**Test Plan:**
```bash
# After implementing fixes, test:
1. Normal ad insertion (should still work)
2. Decision service failure → slate pod from DB
3. Origin failure → 502 error (not fake segments)
4. /cue API without pod_url → channel's slate
5. CORS with production origins
```

**Estimated Time:** 4-6 hours  
**Risk Level:** Low (mostly configuration improvements)  
**Breaking Changes:** None (fallback paths improved)

---

**Current Status:** ✅ Ads are inserting correctly every 2 minutes!  
**Next Step:** Clean up hardcoded values for production readiness.
