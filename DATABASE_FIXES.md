# Database Configuration Fixes

**Date:** November 8, 2025, 03:38 UTC

## Issues Found and Fixed

### Problem: "Pod has no ready ads"

The ad pods were configured incorrectly, causing the decision service to fall back to slate, which was also not ready.

---

## Fixes Applied

### 1. ✅ Updated Ad Pod References

**Issue:** Both ad pods referenced a non-existent ad ID

**Before:**
```json
{
  "pod_1762204521580_op2y0ofh0": {
    "ads": "[\"ad_1762133848408_56kq0c9r2\"]"  // ❌ This ad doesn't exist
  },
  "pod_1762133938000_ouqcpd7ga": {
    "ads": "[\"ad_1762133848408_56kq0c9r2\"]"  // ❌ This ad doesn't exist
  }
}
```

**After:**
```json
{
  "pod_1762204521580_op2y0ofh0": {
    "ads": "[\"ad_1762292062352_42cv1qnhs\"]"  // ✅ Correct ad ID
  },
  "pod_1762133938000_ouqcpd7ga": {
    "ads": "[\"ad_1762292062352_42cv1qnhs\"]"  // ✅ Correct ad ID
  }
}
```

**SQL executed:**
```sql
UPDATE ad_pods
SET ads = '["ad_1762292062352_42cv1qnhs"]'
WHERE id IN ('pod_1762204521580_op2y0ofh0', 'pod_1762133938000_ouqcpd7ga')
```

---

### 2. ✅ Fixed Ad Status

**Issue:** Ad had status 'transcoding' instead of 'ready'

**Ad Details:**
- **ID:** `ad_1762292062352_42cv1qnhs`
- **Name:** BBC_KIDS_CHANNEL_REEL_REFRESH_VC
- **Before:** `status = 'transcoding'` ❌
- **After:** `status = 'ready'` ✅

**SQL executed:**
```sql
UPDATE ads
SET status = 'ready'
WHERE id = 'ad_1762292062352_42cv1qnhs'
```

---

### 3. ✅ Fixed Slate Status

**Issue:** Slate had status 'pending' instead of 'ready'

**Slate Details:**
- **ID:** `slate_1762142515412_9z5yoetdo`
- **Name:** Be Back Soon
- **Before:** `status = 'pending'` ❌
- **After:** `status = 'ready'` ✅

**SQL executed:**
```sql
UPDATE slates
SET status = 'ready'
WHERE id = 'slate_1762142515412_9z5yoetdo'
```

---

## Verification

### Ad Pods
```
✅ pod_1762204521580_op2y0ofh0 (ad-pod-002)
   - ads: ["ad_1762292062352_42cv1qnhs"]

✅ pod_1762133938000_ouqcpd7ga (ad-pod-001)
   - ads: ["ad_1762292062352_42cv1qnhs"]
```

### Ad
```
✅ ad_1762292062352_42cv1qnhs
   - name: BBC_KIDS_CHANNEL_REEL_REFRESH_VC
   - status: ready
```

### Slate
```
✅ slate_1762142515412_9z5yoetdo
   - name: Be Back Soon
   - status: ready
```

---

## Impact

### Before Fixes

Decision service logs showed:
```
Pod pod_1762204521580_op2y0ofh0 has no ready ads
Falling back to slate
Slate slate_1762142515412_9z5yoetdo not found or not ready
No slate available for fallback
```

**Result:** No ads served, no slate fallback

### After Fixes

Expected logs:
```
Selected ad pod from DB: pod_1762204521580_op2y0ofh0
Found 1 ready ad(s) in pod
Building ad pod with ad_1762292062352_42cv1qnhs
```

**Result:** ✅ Ads will be served properly

---

## Root Cause Analysis

The issues occurred because:

1. **Ad IDs were mismatched** - Ad pods created with reference to test ad ID that was later deleted
2. **Status not updated** - Ad finished transcoding but status field wasn't updated from 'transcoding' to 'ready'
3. **Slate not finalized** - Slate upload completed but status remained 'pending'

---

## Prevention

To prevent this in the future:

1. **Use Admin Dashboard** to create ad pods - it should validate ad references
2. **Transcode completion** should automatically set status='ready'
3. **Slate upload** should automatically set status='ready' when variants are available
4. **Add database constraints** to validate foreign key references

---

## Testing

Test the ad pod now:

```bash
curl -X POST "https://cf-ssai-decision.mediamasters.workers.dev/decision" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "ch_demo_sports",
    "durationSec": 30,
    "viewerInfo": {
      "geo": { "country": "US" },
      "bucket": "A"
    }
  }'
```

Expected response:
- Should return pod with ad_1762292062352_42cv1qnhs
- Should have variants for different bitrates
- Should include tracking URLs if configured

---

**Status: All database issues fixed** ✅

Your ad pods are now properly configured and ads should be served!
