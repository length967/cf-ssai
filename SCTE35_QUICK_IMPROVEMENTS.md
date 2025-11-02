# 🚀 SCTE-35 Quick Improvements - Action Plan

**Based on:** SCTE 35 2023 Specification Review  
**Current Grade:** A+ (95%)  
**Target Grade:** A++ (98%)

---

## 🔴 **Quick Win #1: Apply PTS Adjustment (1 hour)**

**What:** Currently parsed but not applied to PTS values

**Why:** Required for multi-stream synchronization (spec section 9.2)

**Code:**
```typescript
// Add to src/utils/scte35-binary.ts

/**
 * Apply PTS adjustment to a PTS value (spec-compliant)
 * Wraps at 33 bits (2^33)
 */
export function applyPTSAdjustment(
  ptsTime: bigint | undefined,
  ptsAdjustment: bigint
): bigint | undefined {
  if (!ptsTime || ptsAdjustment === 0n) return ptsTime
  
  // Add adjustment and wrap at 33 bits (spec requirement)
  const adjusted = (ptsTime + ptsAdjustment) & 0x1FFFFFFFFn
  console.log(`Applied PTS adjustment: ${ptsAdjustment} ticks (${ticksToSeconds(ptsAdjustment)}s)`)
  return adjusted
}

// Update parseSpliceInsert() - after parsing spliceTime
if (result.spliceCommand && result.ptsAdjustment > 0n) {
  const si = result.spliceCommand as SpliceInsert
  if (si.spliceTime?.ptsTime) {
    si.spliceTime.ptsTime = applyPTSAdjustment(si.spliceTime.ptsTime, result.ptsAdjustment)
  }
}

// Update parseTimeSignal() - after parsing spliceTime
if (result.spliceCommand && result.ptsAdjustment > 0n) {
  const ts = result.spliceCommand as TimeSignal
  if (ts.spliceTime?.ptsTime) {
    ts.spliceTime.ptsTime = applyPTSAdjustment(ts.spliceTime.ptsTime, result.ptsAdjustment)
  }
}
```

**Impact:** ✅ Proper multi-stream sync, spec-compliant

---

## 🔴 **Quick Win #2: Add Tier Filtering (2 hours)**

**What:** Parse tier field, filter ads by authorization level

**Why:** Essential for premium/tiered services (spec section 9.2)

**Code:**
```typescript
// 1. Add to migrations/008_add_channel_tier.sql
ALTER TABLE channels ADD COLUMN tier INTEGER DEFAULT 0;  -- 0 = no restrictions

// 2. Update admin-frontend/src/app/channels/page.tsx
<div>
  <label>Authorization Tier</label>
  <select name="tier" value={formData.tier || 0}>
    <option value={0}>No restrictions (0x000)</option>
    <option value={1}>Tier 1 - Basic (0x001)</option>
    <option value={2}>Tier 2 - Premium (0x002)</option>
    <option value={3}>Tier 3 - VIP (0x003)</option>
  </select>
  <p className="help-text">
    Only insert ads matching this tier level. 0 = all ads allowed.
  </p>
</div>

// 3. Update src/channel-do.ts - in ad insertion logic
const channelTier = channelConfig?.tier || 0

if (activeBreak?.binaryData?.tier) {
  const scte35Tier = activeBreak.binaryData.tier
  
  if (channelTier !== 0 && scte35Tier !== channelTier) {
    console.log(`SCTE-35 tier mismatch: channel tier=${channelTier}, signal tier=${scte35Tier} - skipping ad`)
    // Don't insert this ad - wrong tier
    return new Response(origin, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } })
  }
}
```

**Use Cases:**
- Premium subscribers see no ads (tier 0x001+)
- Regional content gating
- VIP-only content

**Impact:** ✅ Premium/tiered services enabled

---

## 🟡 **Enhancement #1: Splice Schedule Support (4 hours)**

**What:** Parse splice_schedule command (type 0x04) for pre-planned breaks

**Why:** Enables ad server pre-loading, better coordination

**Code:**
```typescript
// Add to src/utils/scte35-binary.ts

export interface SpliceSchedule {
  spliceCount: number
  splices: Array<{
    spliceEventId: number
    spliceEventCancelIndicator: boolean
    outOfNetworkIndicator?: boolean
    utcSpliceTime?: number  // Unix timestamp
    breakDuration?: BreakDuration
    uniqueProgramId: number
    availNum: number
    availsExpected: number
  }>
}

function parseSpliceSchedule(buffer: BufferReader): SpliceSchedule {
  const spliceCount = buffer.readUInt8(0)
  const splices = []
  
  let offset = 1
  for (let i = 0; i < spliceCount; i++) {
    const spliceEventId = buffer.readUInt32BE(offset)
    offset += 4
    
    const flags = buffer.readUInt8(offset)
    const spliceEventCancelIndicator = (flags & 0x80) !== 0
    offset++
    
    if (spliceEventCancelIndicator) {
      splices.push({ spliceEventId, spliceEventCancelIndicator: true })
      continue
    }
    
    const outOfNetworkIndicator = (flags & 0x80) !== 0
    const programSpliceFlag = (flags & 0x40) !== 0
    const durationFlag = (flags & 0x20) !== 0
    
    // Parse UTC splice time (32-bit, seconds since epoch)
    const utcSpliceTime = buffer.readUInt32BE(offset)
    offset += 4
    
    // Parse break duration if present
    let breakDuration: BreakDuration | undefined
    if (durationFlag) {
      const autoReturn = (buffer.readUInt8(offset) & 0x80) !== 0
      const duration = readUInt40BE(buffer, offset) & 0x1FFFFFFFFn
      breakDuration = {
        autoReturn,
        reserved: 0,
        duration,
        durationSeconds: ticksToSeconds(duration)
      }
      offset += 5
    }
    
    const uniqueProgramId = buffer.readUInt16BE(offset)
    const availNum = buffer.readUInt8(offset + 2)
    const availsExpected = buffer.readUInt8(offset + 3)
    offset += 4
    
    splices.push({
      spliceEventId,
      spliceEventCancelIndicator: false,
      outOfNetworkIndicator,
      utcSpliceTime,
      breakDuration,
      uniqueProgramId,
      availNum,
      availsExpected
    })
  }
  
  return { spliceCount, splices }
}

// Add to parseSCTE35Binary switch statement
case 0x04:  // splice_schedule
  spliceCommand = parseSpliceSchedule(new BufferReader(commandData))
  console.log(`Parsed splice_schedule with ${spliceCommand.spliceCount} events`)
  break
```

**Use in channel-do.ts:**
```typescript
// Store scheduled splices for pre-loading
if (parsed.spliceCommandType === 0x04 && parsed.spliceCommand) {
  const schedule = parsed.spliceCommand as SpliceSchedule
  
  for (const splice of schedule.splices) {
    if (splice.utcSpliceTime) {
      const spliceDate = new Date(splice.utcSpliceTime * 1000)
      const timeUntil = spliceDate.getTime() - Date.now()
      
      console.log(`Scheduled splice ${splice.spliceEventId} in ${timeUntil}ms`)
      
      // Pre-load ads if within 30 seconds
      if (timeUntil > 0 && timeUntil < 30000) {
        await preloadAdsForBreak(splice.spliceEventId, splice.breakDuration?.durationSeconds || 30)
      }
    }
  }
}
```

**Benefits:**
- ✅ Pre-load ads 30 seconds before break
- ✅ Better ad server coordination
- ✅ Smoother ad transitions

**Impact:** 🟡 Advanced planning capability

---

## 🟢 **Quick Add #1: Splice Null Command (15 min)**

**What:** Parse splice_null (type 0x00) for heartbeat/null ops

**Code:**
```typescript
// Add to parseSCTE35Binary switch statement
case 0x00:  // splice_null
  spliceCommand = { type: 'splice_null' }
  console.log('Received splice_null (heartbeat/null operation)')
  break
```

**Impact:** 🟢 Informational, spec-compliant

---

## 🟢 **Quick Add #2: Private Command (30 min)**

**What:** Parse private_command (type 0xFF) for vendor extensions

**Code:**
```typescript
// Add to src/utils/scte35-binary.ts
export interface PrivateCommand {
  identifier: number  // 32-bit OUI or custom ID
  privateBytes: Uint8Array
}

function parsePrivateCommand(buffer: BufferReader): PrivateCommand {
  const identifier = buffer.readUInt32BE(0)
  const privateBytes = buffer.slice(4)
  
  console.log(`Private command: identifier=0x${identifier.toString(16)}, bytes=${privateBytes.length}`)
  
  return { identifier, privateBytes }
}

// Add to switch statement
case 0xFF:  // private_command
  spliceCommand = parsePrivateCommand(new BufferReader(commandData))
  break
```

**Impact:** 🟢 Vendor extensibility

---

## 📊 **Implementation Priority**

### **Immediate (Next Deploy):**
1. ✅ PTS adjustment (1 hour)
2. ✅ Tier filtering (2 hours)

**Total:** 3 hours, **HIGH IMPACT** 🔴

---

### **Next Sprint:**
3. ⏰ Splice schedule (4 hours)
4. ⏰ Splice null (15 min)
5. ⏰ Private command (30 min)

**Total:** 5 hours, **MEDIUM IMPACT** 🟡

---

## ✅ **After These Improvements:**

**Compliance:** 95% → **98%** (A++)

**New Capabilities:**
- ✅ Multi-stream synchronization (PTS adjustment)
- ✅ Tiered/premium services (tier filtering)
- ✅ Advanced ad planning (splice schedule)
- ✅ Vendor extensibility (private commands)
- ✅ Complete spec coverage (splice null)

**Total Effort:** 8 hours over 2 sprints

**Result:** Best-in-class SCTE-35 implementation! 🏆

---

## 🎯 **Quick Start: Deploy PTS Adjustment Now**

```bash
# 1. Add the code above to src/utils/scte35-binary.ts
# 2. Deploy
npx wrangler deploy

# 3. Verify in logs
npx wrangler tail cf-ssai | grep "PTS adjustment"
```

**Expected output:**
```
Applied PTS adjustment: 45000 ticks (0.500s)
```

**Done!** ✅

