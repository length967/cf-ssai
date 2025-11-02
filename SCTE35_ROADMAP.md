# 🗺️ SCTE-35 Enhancement Roadmap

**Quick Reference for Implementation Planning**

---

## 🎯 **Current State: What We Have**

✅ HLS `#EXT-X-DATERANGE` parsing  
✅ Signal type detection (splice_insert, time_signal, return_signal)  
✅ Duration extraction (DURATION, PLANNED-DURATION)  
✅ Basic segmentation types (Provider/Distributor Ad, Break markers)  
✅ UPID extraction  
✅ Multi-segment pod support  
✅ Auto-return flag  

**Rating: 8/10** - Production-ready for most streaming use cases

---

## ⚡ **Quick Win (This Week) - 2 hours**

### **Add Frame-Accurate PTS Extraction**

**Why:** Currently we rely on DATERANGE attributes. Binary parsing gives us **90kHz precision** (0.011ms accuracy) instead of second-level timing.

**What to add:**

```typescript
// src/utils/scte35.ts

export function extractPrecisePTS(attrs: Record<string, string>): bigint | null {
  const cmd = attrs["SCTE35-CMD"] || attrs["SCTE35-OUT"]
  if (!cmd) return null
  
  try {
    const buffer = Buffer.from(cmd, 'base64')
    const commandType = buffer.readUInt8(11)
    
    if (commandType === 0x05) {  // splice_insert
      const flags = buffer.readUInt8(18)
      if ((flags & 0x20) && !(flags & 0x08)) {  // Program splice, not immediate
        const timeSpecified = buffer.readUInt8(19) & 0x80
        if (timeSpecified) {
          const ptsHigh = buffer.readUInt8(20) & 0x01
          const ptsLow = buffer.readUInt32BE(21)
          return (BigInt(ptsHigh) << 32n) | BigInt(ptsLow)
        }
      }
    }
  } catch (e) {
    return null
  }
  
  return null
}

export function ptsToSeconds(pts: bigint): number {
  return Number(pts) / 90000
}
```

**Use in channel-do.ts:**

```typescript
const pts = extractPrecisePTS(attrs)
if (pts) {
  console.log(`Frame-accurate insertion point: ${ptsToSeconds(pts)}s`)
  // Use for exact ad insertion timing
}
```

**Impact:** ✅ Frame-accurate ad insertion (broadcast quality)

---

## 🚀 **Phase 1: Broadcast Quality (2-3 weeks)**

### **Implement Full Binary Parsing**

**Goal:** Parse the base64 SCTE-35 binary commands for complete metadata

**Features to add:**

1. **Splice Insert Command** (command type 0x05)
   - Splice event ID
   - Out-of-network indicator
   - Break duration (in 90kHz ticks)
   - Auto-return flag (from binary, not attribute)
   - Component splices (for multi-audio)

2. **Time Signal** (command type 0x06)
   - Precise PTS timing
   - Combined with segmentation descriptors

3. **CRC-32 Validation**
   - Detect corrupt SCTE-35 messages
   - Prevent bad ad insertions

**Files to create:**

```
src/utils/scte35-binary.ts  (new)
├── parseSpliceInsert()
├── parseTimeSignal()
├── validateCRC32()
└── convertTicksToSeconds()

tests/scte35-binary.test.ts  (new)
└── Test with real broadcast SCTE-35 samples
```

**Example usage:**

```typescript
import { parseSCTE35Binary } from './utils/scte35-binary'

const cmd = attrs["SCTE35-CMD"]
const parsed = parseSCTE35Binary(cmd)

if (parsed.valid) {
  console.log('Splice Event ID:', parsed.spliceEventId)
  console.log('Precise Duration:', parsed.breakDuration.seconds, 's')
  console.log('Auto-return:', parsed.breakDuration.autoReturn)
  console.log('Frame-accurate PTS:', parsed.spliceTime.ptsTime)
}
```

**Effort:** ~20 hours  
**Impact:** 🔴 **HIGH** - Industry-standard broadcast quality

---

## 📈 **Phase 2: Enhanced Metadata (1-2 months)**

### **Segmentation Descriptor Parsing**

**Goal:** Extract rich metadata from segmentation descriptors

**Features to add:**

1. **All Segmentation Types** (0x00-0x51)
   - Program Start/End
   - Chapter markers
   - Provider/Distributor ads
   - Placement opportunities
   - Unscheduled events
   - Network boundaries

2. **UPID Types** (All 16 types)
   - ISCI (0x02)
   - Ad-ID (0x03)
   - EIDR (0x07)
   - TI (0x08)
   - ADI (0x09)
   - URI (0x0F)
   - etc.

3. **Delivery Restrictions**
   - Web delivery allowed?
   - Regional blackout restrictions
   - Archive restrictions
   - Device restrictions

4. **Multiple Descriptors**
   - One splice can have multiple descriptors
   - E.g., Chapter Start + Ad Break

**Example:**

```typescript
const descriptor = parseSegmentationDescriptor(cmdBuffer, offset)

console.log('Type:', descriptor.typeName)  // "Provider Advertisement Start"
console.log('Duration:', descriptor.durationSeconds)  // 30.0
console.log('UPID Type:', descriptor.upidType)  // "Ad-ID"
console.log('UPID:', descriptor.upid)  // "ABC123XYZ"
console.log('Web Delivery:', descriptor.deliveryRestrictions.webAllowed)  // true
```

**Use cases:**
- Better ad targeting (UPID matching)
- Compliance (delivery restrictions)
- Analytics (segmentation metadata)
- Dynamic ad decisioning (event IDs)

**Effort:** ~40 hours  
**Impact:** 🟡 **MEDIUM** - Enhanced targeting & compliance

---

## 🔮 **Phase 3: Advanced Features (Future)**

### **Nice-to-Have Enhancements**

1. **Encryption Detection** - Warn if SCTE-35 is encrypted
2. **Bandwidth Reservation** - Handle command type 0x07
3. **Protocol Version Validation** - Future-proof for SCTE-35 v1+
4. **Avail Descriptor** - Legacy avail numbering
5. **Component-Level Splicing** - Per-audio-track insertion

**Effort:** ~20 hours  
**Impact:** 🟢 **LOW** - Rarely needed, but spec-compliant

---

## 📊 **Implementation Matrix**

| Feature | Priority | Effort | Impact | When |
|---------|----------|--------|--------|------|
| **PTS Extraction** | 🔴 Critical | 2h | Frame accuracy | This week |
| **Binary Parsing** | 🔴 High | 20h | Broadcast quality | Next 2-3 weeks |
| **CRC Validation** | 🟡 Medium | 4h | Robustness | With binary parsing |
| **Segmentation Descriptors** | 🟡 Medium | 40h | Metadata richness | Q1 2026 |
| **UPID Parsing** | 🟡 Medium | 8h | Better targeting | Q1 2026 |
| **Delivery Restrictions** | 🟢 Low | 4h | Compliance | Q2 2026 |
| **Encryption Check** | 🟢 Low | 2h | Graceful handling | Q2 2026 |
| **Multiple Descriptors** | 🟢 Low | 8h | Edge cases | Q2 2026 |

---

## 🎯 **Recommended Next Steps**

### **This Week:**
1. ✅ Implement `extractPrecisePTS()` (2 hours)
2. ✅ Test with real broadcast streams
3. ✅ Measure timing improvement

### **This Month:**
1. ✅ Create `scte35-binary.ts` module
2. ✅ Implement splice_insert parsing
3. ✅ Add CRC-32 validation
4. ✅ Write comprehensive tests

### **Next Quarter:**
1. ⏰ Full segmentation descriptor parsing
2. ⏰ UPID type support (all 16)
3. ⏰ Delivery restriction handling
4. ⏰ Update GUI to show enhanced metadata

---

## 📚 **Resources for Implementation**

### **SCTE-35 Specification:**
- [SCTE 35 2023 Standard](https://www.scte.org/standards/library/catalog/scte-35-digital-program-insertion-cueing-message/)
- Section 9: Splice Info Section
- Section 10: Splice Descriptors

### **Reference Implementations:**
- [comcast/scte35-js](https://github.com/comcast/scte35-js)
- [futzu/threefive](https://github.com/futzu/threefive) (Python)
- [Eyevinn/scte35](https://github.com/Eyevinn/scte35) (TypeScript)

### **Test Streams:**
- [Unified Streaming SCTE-35 Demo](https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8)
- [Apple HLS SCTE-35 Examples](https://developer.apple.com/streaming/examples/)

### **Validation Tools:**
- [SCTE-35 Decoder](https://www.atis.org/scte/scte-35/)
- [HLS Validator](https://hlsbook.net/hls-validator/)

---

## 🏆 **Success Metrics**

### **After Phase 1:**
- ✅ Frame-accurate insertion (±0.011ms precision)
- ✅ Zero CRC errors in logs
- ✅ Splice event ID tracking
- ✅ Reduced ad timing drift to <100ms

### **After Phase 2:**
- ✅ Support all 16 UPID types
- ✅ Extract delivery restrictions
- ✅ Parse all segmentation types (50+)
- ✅ Enhanced analytics dashboard

### **After Phase 3:**
- ✅ 100% SCTE-35 spec compliance
- ✅ Handle all edge cases gracefully
- ✅ Industry-leading SCTE-35 implementation

---

## 💬 **Questions to Answer**

Before starting implementation, discuss:

1. **Do we need frame-accurate insertion?**
   - For premium broadcast content: **YES**
   - For web streaming only: **Maybe not**

2. **What's our priority: speed or features?**
   - Speed: Just add PTS extraction (Phase 1A)
   - Features: Full binary parsing (Phase 1 complete)

3. **Do we have real SCTE-35 test streams?**
   - Need to test with actual broadcast signals
   - Unified Streaming demo is good start

4. **What metadata do ad servers need?**
   - Splice event IDs for deduplication?
   - UPIDs for targeting?
   - Delivery restrictions for compliance?

---

## 🎯 **TL;DR - What to Do Now**

**Minimum (Good):**
- Current implementation is fine for streaming

**Recommended (Better):**
- Add PTS extraction this week (2 hours)
- Implement binary parsing next month (20 hours)

**Optimal (Best):**
- Complete Phase 1 + Phase 2 (60 hours total)
- Industry-leading SCTE-35 implementation

**Decision:** Up to business priorities and timeline!

---

**Next Action:** Discuss with team and decide on Phase 1 timeline.

