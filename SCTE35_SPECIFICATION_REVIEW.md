# 🔍 SCTE-35 Specification Review & Recommendations

**Date:** November 1, 2025  
**Current Implementation:** `src/utils/scte35.ts`  
**Reference:** SCTE 35 2023 (Digital Program Insertion Cueing Message)

---

## ✅ **Current Implementation Strengths**

### **What We Do Well:**

1. **✅ HLS DATERANGE Parsing** - Correctly parses `#EXT-X-DATERANGE` tags
2. **✅ Signal Type Detection** - Identifies `splice_insert`, `time_signal`, `return_signal`
3. **✅ Duration Extraction** - Handles both `DURATION` and `PLANNED-DURATION`
4. **✅ Segmentation Types** - Supports Provider/Distributor Ad, Program/Chapter/Break markers
5. **✅ Multi-segment Pods** - Handles `X-SEGMENT-NUM` and `X-SEGMENTS-EXPECTED`
6. **✅ UPID Support** - Extracts Unique Program Identifiers
7. **✅ Auto-return** - Respects `X-AUTO-RETURN` for content resumption
8. **✅ Apple HLS Format** - Supports `com.apple.hls.scte35.out/in` classes
9. **✅ Graceful Parsing** - Returns null for non-SCTE-35 DATERANGE tags

---

## 🚀 **Recommended Enhancements**

### **Priority 1: Critical SCTE-35 Features (Missing)**

#### **1. Splice Command Parsing**

**Current:** We check for `SCTE35-CMD` but don't parse the base64 binary data

**SCTE-35 Spec:** The `SCTE35-CMD` or `SCTE35-OUT` attributes contain base64-encoded binary splice commands with detailed information:
- Splice event ID
- Program splice flag
- Duration flag
- Break duration in 90kHz ticks
- Component tags
- Segmentation descriptor
- Delivery restrictions

**Recommendation:**
```typescript
/**
 * Parse base64-encoded SCTE-35 binary splice command
 * Spec: SCTE 35 Section 9 - Splice Info Section
 */
export function parseSpliceCommand(base64Cmd: string): SpliceCommandData {
  const buffer = Buffer.from(base64Cmd, 'base64')
  
  // Parse splice info section
  const tableId = buffer.readUInt8(0)  // Should be 0xFC
  const sectionLength = buffer.readUInt16BE(1) & 0x0FFF
  const protocolVersion = buffer.readUInt8(3)
  const encrypted = (buffer.readUInt8(4) & 0x80) !== 0
  const ptsAdjustment = buffer.readUIntBE(5, 5) & 0x1FFFFFFFFN  // 33 bits
  
  // Parse splice command
  const commandType = buffer.readUInt8(11)
  const commandLength = buffer.readUInt16BE(12)
  
  // Command types:
  // 0x05 = splice_insert
  // 0x06 = time_signal
  // 0x07 = bandwidth_reservation
  
  return {
    tableId,
    protocolVersion,
    encrypted,
    ptsAdjustment,
    commandType,
    commandLength,
    // ... parse command-specific data
  }
}
```

**Benefits:**
- ✅ Extract precise PTS (Presentation Time Stamp) for frame-accurate insertion
- ✅ Get splice event ID for tracking
- ✅ Read delivery restrictions (web/no-regional-blackout)
- ✅ Parse segmentation descriptors for detailed ad metadata

**Priority:** 🔴 **HIGH** - Enables frame-accurate ad insertion

---

#### **2. Segmentation Descriptor Parsing**

**Current:** We only parse segmentation type strings

**SCTE-35 Spec:** Segmentation descriptors (Section 10.3.3) contain rich metadata:
- Segmentation type ID (0x00-0xFF)
- Segment number/expected
- Sub-segments
- Segmentation UPID type (8 types: ISCI, Ad-ID, TI, EIDR, etc.)
- Segmentation duration (in 90kHz ticks)
- Delivery restrictions

**Recommendation:**
```typescript
interface SegmentationDescriptor {
  segmentationEventId: number
  segmentationEventCancelIndicator: boolean
  programSegmentationFlag: boolean
  segmentationDuration?: number  // In 90kHz ticks
  segmentationTypeId: number
  segmentNum?: number
  segmentsExpected?: number
  subSegmentNum?: number
  subSegmentsExpected?: number
  upidType: number  // 0x00-0x0F
  upidLength: number
  upid: string
  deliveryRestrictions?: {
    webDeliveryAllowed: boolean
    noRegionalBlackout: boolean
    archiveAllowed: boolean
    deviceRestrictions: number  // 0-3
  }
}

export function parseSegmentationDescriptor(
  spliceCommand: Buffer,
  offset: number
): SegmentationDescriptor {
  // Parse segmentation descriptor (Section 10.3.3)
  const segmentationEventId = spliceCommand.readUInt32BE(offset)
  const flags = spliceCommand.readUInt8(offset + 4)
  
  // ... detailed parsing ...
  
  return descriptor
}
```

**Benefits:**
- ✅ Support all 16 UPID types (ISCI, Ad-ID, TI, EIDR, ADI, etc.)
- ✅ Extract delivery restrictions for compliance
- ✅ Handle sub-segment ad pods
- ✅ Get precise event IDs for deduplication

**Priority:** 🟡 **MEDIUM** - Enhances targeting and compliance

---

#### **3. Time Signal with Segmentation Descriptor**

**Current:** We handle time signals but don't parse their segmentation descriptors

**SCTE-35 Spec:** Time signals (command type 0x06) combined with segmentation descriptors provide the most detailed ad break information used by major broadcasters.

**Recommendation:**
```typescript
interface TimeSignal {
  spliceTime: {
    timeSpecified: boolean
    ptsTime?: bigint  // 33-bit PTS (90kHz clock)
  }
}

export function parseTimeSignal(buffer: Buffer, offset: number): TimeSignal {
  const flags = buffer.readUInt8(offset)
  const timeSpecified = (flags & 0x80) !== 0
  
  if (timeSpecified) {
    const ptsTime = buffer.readUIntBE(offset + 1, 5) & 0x1FFFFFFFFn  // 33 bits
    return { spliceTime: { timeSpecified: true, ptsTime } }
  }
  
  return { spliceTime: { timeSpecified: false } }
}
```

**Benefits:**
- ✅ Frame-accurate ad insertion (90kHz precision)
- ✅ Support for immediate vs scheduled splices
- ✅ Better handling of live stream timing

**Priority:** 🔴 **HIGH** - Critical for broadcast-quality SSAI

---

### **Priority 2: Enhanced Features**

#### **4. Multiple Segmentation Descriptors**

**SCTE-35 Spec:** A single splice command can contain **multiple segmentation descriptors** for different purposes (e.g., chapter start + ad break).

**Recommendation:**
```typescript
export function parseAllSegmentationDescriptors(
  buffer: Buffer
): SegmentationDescriptor[] {
  const descriptors: SegmentationDescriptor[] = []
  
  // Read descriptor loop length
  const descriptorLoopLength = buffer.readUInt16BE(offset)
  
  let pos = offset + 2
  const end = pos + descriptorLoopLength
  
  while (pos < end) {
    const tag = buffer.readUInt8(pos)
    const length = buffer.readUInt8(pos + 1)
    
    if (tag === 0x02) {  // Segmentation descriptor tag
      descriptors.push(parseSegmentationDescriptor(buffer, pos + 2))
    }
    
    pos += 2 + length
  }
  
  return descriptors
}
```

**Priority:** 🟡 **MEDIUM**

---

#### **5. SCTE-35 Encryption Support**

**Current:** We don't check the encryption flag

**SCTE-35 Spec:** SCTE-35 messages can be encrypted (encrypted_packet flag, Section 9.1)

**Recommendation:**
```typescript
export function isSCTE35Encrypted(base64Cmd: string): boolean {
  const buffer = Buffer.from(base64Cmd, 'base64')
  const encryptedPacket = (buffer.readUInt8(4) & 0x80) !== 0
  return encryptedPacket
}

// In parsing logic:
if (isSCTE35Encrypted(scte35Cmd)) {
  console.warn('SCTE-35 command is encrypted - cannot parse without decryption')
  // Optionally: call decryption service
  return null
}
```

**Priority:** 🟢 **LOW** - Rare in practice, but spec-compliant

---

#### **6. Bandwidth Reservation**

**SCTE-35 Spec:** Command type 0x07 reserves bandwidth for future ads

**Recommendation:**
```typescript
interface BandwidthReservation {
  commandType: 0x07
  // Empty command - signals bandwidth reservation
}

export function isBandwidthReservation(commandType: number): boolean {
  return commandType === 0x07
}

// In decision logic:
if (isBandwidthReservation(command.commandType)) {
  console.log('Bandwidth reserved for future ad - no action needed')
  return null  // Don't insert ad yet
}
```

**Priority:** 🟢 **LOW** - Mostly for transport stream management

---

### **Priority 3: Compliance & Standards**

#### **7. CRC-32 Validation**

**SCTE-35 Spec:** All splice info sections have a CRC-32 checksum (Section 9.1)

**Recommendation:**
```typescript
import { crc32 } from 'crc'  // Or implement CRC-32

export function validateSCTE35CRC(base64Cmd: string): boolean {
  const buffer = Buffer.from(base64Cmd, 'base64')
  const length = buffer.readUInt16BE(1) & 0x0FFF
  const dataLength = 3 + length  // From table_id to last byte before CRC
  
  const data = buffer.slice(0, dataLength)
  const receivedCRC = buffer.readUInt32BE(dataLength)
  const calculatedCRC = crc32(data)
  
  return receivedCRC === calculatedCRC
}

// In parsing logic:
if (!validateSCTE35CRC(scte35Cmd)) {
  console.error('SCTE-35 CRC validation failed - corrupt data')
  return null
}
```

**Benefits:**
- ✅ Detect transmission errors
- ✅ Prevent corrupted ad insertion
- ✅ Spec-compliant implementation

**Priority:** 🟡 **MEDIUM** - Good for production robustness

---

#### **8. SCTE-35 Protocol Version Check**

**Current:** We don't validate protocol version

**SCTE-35 Spec:** Current version is 0 (Section 9.2)

**Recommendation:**
```typescript
export function validateProtocolVersion(base64Cmd: string): boolean {
  const buffer = Buffer.from(base64Cmd, 'base64')
  const protocolVersion = buffer.readUInt8(3)
  
  if (protocolVersion !== 0) {
    console.warn(`Unsupported SCTE-35 protocol version: ${protocolVersion}`)
    return false
  }
  
  return true
}
```

**Priority:** 🟢 **LOW** - Future-proofing

---

### **Priority 4: Advanced Features**

#### **9. Avail Descriptor Parsing**

**SCTE-35 Spec:** Avail descriptor (Section 10.3.1) provides additional ad avail information:
- Provider avail ID
- Avails expected

**Recommendation:**
```typescript
interface AvailDescriptor {
  tag: 0x00  // Avail descriptor
  length: number
  providerAvailId: number
}

export function parseAvailDescriptor(buffer: Buffer, offset: number): AvailDescriptor {
  return {
    tag: buffer.readUInt8(offset),
    length: buffer.readUInt8(offset + 1),
    providerAvailId: buffer.readUInt32BE(offset + 2)
  }
}
```

**Priority:** 🟢 **LOW** - Mostly for legacy systems

---

#### **10. DTMF Descriptor**

**SCTE-35 Spec:** DTMF descriptor (Section 10.3.2) for audio tone insertion

**Priority:** 🟢 **LOW** - Not applicable to HLS SSAI

---

#### **11. Component-level Splicing**

**SCTE-35 Spec:** Splice inserts can target specific program components (e.g., multiple audio tracks)

**Recommendation:**
```typescript
interface ComponentSplice {
  componentTag: number  // Identifies audio/video component
  spliceTime?: bigint
}

export function parseComponentSplices(
  buffer: Buffer,
  offset: number
): ComponentSplice[] {
  const componentCount = buffer.readUInt8(offset)
  const components: ComponentSplice[] = []
  
  let pos = offset + 1
  for (let i = 0; i < componentCount; i++) {
    // Parse each component splice
    components.push(parseComponentSplice(buffer, pos))
    pos += getComponentSpliceLength(buffer, pos)
  }
  
  return components
}
```

**Priority:** 🟢 **LOW** - Complex, rarely used in streaming

---

## 📊 **Priority Matrix**

| Feature | Priority | Effort | Impact | Recommendation |
|---------|----------|--------|--------|----------------|
| **Splice Command Parsing** | 🔴 HIGH | Medium | High | ✅ Implement |
| **Time Signal + Descriptor** | 🔴 HIGH | Medium | High | ✅ Implement |
| **Segmentation Descriptor** | 🟡 MEDIUM | High | Medium | ⏰ Phase 2 |
| **CRC-32 Validation** | 🟡 MEDIUM | Low | Medium | ⏰ Phase 2 |
| **Multiple Descriptors** | 🟡 MEDIUM | Medium | Low | ⏰ Phase 2 |
| **Encryption Check** | 🟢 LOW | Low | Low | 🔮 Future |
| **Protocol Version Check** | 🟢 LOW | Low | Low | 🔮 Future |
| **Bandwidth Reservation** | 🟢 LOW | Low | Low | 🔮 Future |
| **Avail Descriptor** | 🟢 LOW | Low | Low | 🔮 Future |
| **Component Splicing** | 🟢 LOW | High | Low | ❌ Skip |

---

## 🎯 **Recommended Implementation Phases**

### **Phase 1: Frame-Accurate Insertion** (Now)

```typescript
// Add to src/utils/scte35.ts

export interface SpliceInsertCommand {
  spliceEventId: number
  spliceEventCancelIndicator: boolean
  outOfNetworkIndicator: boolean
  programSpliceFlag: boolean
  durationFlag: boolean
  spliceTime?: {
    ptsTime: bigint  // 90kHz ticks
  }
  breakDuration?: {
    autoReturn: boolean
    duration: bigint  // 90kHz ticks (convert to seconds: / 90000)
  }
  componentSplices?: ComponentSplice[]
}

export function parseSpliceInsert(buffer: Buffer, offset: number): SpliceInsertCommand {
  const spliceEventId = buffer.readUInt32BE(offset)
  const flags = buffer.readUInt8(offset + 4)
  
  const spliceEventCancelIndicator = (flags & 0x80) !== 0
  const outOfNetworkIndicator = (flags & 0x40) !== 0
  const programSpliceFlag = (flags & 0x20) !== 0
  const durationFlag = (flags & 0x10) !== 0
  const spliceImmediateFlag = (flags & 0x08) !== 0
  
  let pos = offset + 5
  
  // Parse splice time or component splices
  let spliceTime: { ptsTime: bigint } | undefined
  let componentSplices: ComponentSplice[] | undefined
  
  if (programSpliceFlag && !spliceImmediateFlag) {
    // Parse splice time
    const timeSpecified = (buffer.readUInt8(pos) & 0x80) !== 0
    if (timeSpecified) {
      spliceTime = {
        ptsTime: buffer.readBigUInt64BE(pos + 1) & 0x1FFFFFFFFn  // 33 bits
      }
    }
    pos += 5
  } else if (!programSpliceFlag) {
    // Parse component splices
    componentSplices = parseComponentSplices(buffer, pos)
    pos += getComponentSplicesLength(buffer, pos)
  }
  
  // Parse break duration
  let breakDuration: { autoReturn: boolean, duration: bigint } | undefined
  if (durationFlag) {
    const autoReturn = (buffer.readUInt8(pos) & 0x80) !== 0
    const duration = buffer.readBigUInt64BE(pos + 1) & 0xFFFFFFFFFFn  // 40 bits
    breakDuration = { autoReturn, duration }
    pos += 5
  }
  
  return {
    spliceEventId,
    spliceEventCancelIndicator,
    outOfNetworkIndicator,
    programSpliceFlag,
    durationFlag,
    spliceTime,
    breakDuration,
    componentSplices
  }
}

// Convert 90kHz ticks to seconds
export function ticksToSeconds(ticks: bigint): number {
  return Number(ticks) / 90000
}

// Use in channel-do.ts for frame-accurate insertion
const spliceInsert = parseSpliceInsert(cmdBuffer, 14)  // After header
const preciseStartTimePTS = spliceInsert.spliceTime?.ptsTime
const preciseDurationSec = spliceInsert.breakDuration 
  ? ticksToSeconds(spliceInsert.breakDuration.duration)
  : 30
```

**Benefits:**
- ✅ Frame-accurate ad insertion (precision: 1/90000 second)
- ✅ Extract auto-return flag directly from splice command
- ✅ Get splice event ID for deduplication
- ✅ Handle immediate vs scheduled splices

---

### **Phase 2: Enhanced Metadata** (Next)

```typescript
// Add comprehensive segmentation descriptor parsing

export interface EnhancedSegmentationDescriptor {
  segmentationEventId: number
  segmentationDuration?: number  // In seconds (converted from 90kHz)
  segmentationTypeId: number
  segmentationTypeName: string
  upidType: UPIDType
  upid: string
  deliveryRestrictions?: DeliveryRestrictions
  segmentNum?: number
  segmentsExpected?: number
}

export enum UPIDType {
  NOT_USED = 0x00,
  USER_DEFINED = 0x01,
  ISCI = 0x02,
  AD_ID = 0x03,
  UMID = 0x04,
  ISAN = 0x05,
  EIDR = 0x07,
  TI = 0x08,
  ADI = 0x09,
  EIDR_URN = 0x0A,
  ATSC_CONTENT_ID = 0x0B,
  MPU = 0x0C,
  MID = 0x0D,
  ADS_INFO = 0x0E,
  URI = 0x0F
}

export function parseEnhancedSegmentationDescriptor(
  buffer: Buffer,
  offset: number
): EnhancedSegmentationDescriptor {
  // Full implementation of Section 10.3.3
  // ... (detailed parsing) ...
}
```

---

### **Phase 3: Validation & Compliance** (Future)

```typescript
// Add CRC validation, protocol version checks, etc.

export interface SCTE35ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateSCTE35Command(base64Cmd: string): SCTE35ValidationResult {
  const result: SCTE35ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  }
  
  // Check table ID
  // Check protocol version
  // Validate CRC
  // Check command type
  // Validate lengths
  
  return result
}
```

---

## 🔧 **Immediate Actions (Quick Wins)**

### **1. Add PTS Extraction Helper**

```typescript
// Add to src/utils/scte35.ts NOW (5 minutes)

export function extractPTSFromSCTE35(attrs: Record<string, string>): bigint | null {
  if (attrs["X-PTS"]) {
    return BigInt(attrs["X-PTS"])
  }
  
  // If SCTE35-CMD is present, parse it
  if (attrs["SCTE35-CMD"] || attrs["SCTE35-OUT"]) {
    const base64 = attrs["SCTE35-CMD"] || attrs["SCTE35-OUT"]
    try {
      const buffer = Buffer.from(base64, 'base64')
      // Quick PTS extraction without full parsing
      const commandType = buffer.readUInt8(11)
      if (commandType === 0x05) {  // splice_insert
        const offset = 14  // After header
        const flags = buffer.readUInt8(offset + 4)
        const programSpliceFlag = (flags & 0x20) !== 0
        const spliceImmediateFlag = (flags & 0x08) !== 0
        
        if (programSpliceFlag && !spliceImmediateFlag) {
          const timeSpecified = (buffer.readUInt8(offset + 5) & 0x80) !== 0
          if (timeSpecified) {
            // Read 33-bit PTS
            const ptsHigh = buffer.readUInt8(offset + 6) & 0x01
            const ptsLow = buffer.readUInt32BE(offset + 7)
            return (BigInt(ptsHigh) << 32n) | BigInt(ptsLow)
          }
        }
      }
    } catch (e) {
      console.error('Failed to extract PTS from SCTE35-CMD:', e)
    }
  }
  
  return null
}
```

**Use immediately for better timing:**
```typescript
// In channel-do.ts
const pts = extractPTSFromSCTE35(attrs)
if (pts) {
  console.log(`Frame-accurate PTS: ${pts} (${Number(pts) / 90000}s)`)
}
```

---

### **2. Add Segmentation Type ID Mapping**

```typescript
// Add complete segmentation type mapping (10 minutes)

export const SEGMENTATION_TYPE_NAMES: Record<number, string> = {
  0x00: "Not Indicated",
  0x01: "Content Identification",
  0x10: "Program Start",
  0x11: "Program End",
  0x12: "Program Early Termination",
  0x13: "Program Breakaway",
  0x14: "Program Resumption",
  0x15: "Program Runover Planned",
  0x16: "Program Runover Unplanned",
  0x17: "Program Overlap Start",
  0x18: "Program Blackout Override",
  0x19: "Program Start - In Progress",
  0x20: "Chapter Start",
  0x21: "Chapter End",
  0x22: "Break Start",
  0x23: "Break End",
  0x24: "Opening Credit Start",
  0x25: "Opening Credit End",
  0x26: "Closing Credit Start",
  0x27: "Closing Credit End",
  0x30: "Provider Advertisement Start",
  0x31: "Provider Advertisement End",
  0x32: "Distributor Advertisement Start",
  0x33: "Distributor Advertisement End",
  0x34: "Provider Placement Opportunity Start",
  0x35: "Provider Placement Opportunity End",
  0x36: "Distributor Placement Opportunity Start",
  0x37: "Distributor Placement Opportunity End",
  0x38: "Provider Overlay Placement Opportunity Start",
  0x39: "Provider Overlay Placement Opportunity End",
  0x3A: "Distributor Overlay Placement Opportunity Start",
  0x3B: "Distributor Overlay Placement Opportunity End",
  0x40: "Unscheduled Event Start",
  0x41: "Unscheduled Event End",
  0x50: "Network Start",
  0x51: "Network End"
}

export function getSegmentationTypeName(typeId: number): string {
  return SEGMENTATION_TYPE_NAMES[typeId] || `Unknown (0x${typeId.toString(16)})`
}
```

---

## 📚 **Testing Recommendations**

### **Test Cases to Add:**

```typescript
// tests/scte35-binary.test.ts (new file)

describe("SCTE-35 Binary Parsing", () => {
  test("Parse splice_insert with PTS", () => {
    // Example SCTE-35 splice_insert (base64)
    const cmd = "/DA0AAAAAAAA///wBQb+cr0AUAAeAhxDVUVJSAAAjn+fCAgAAAAALKChijUCAAmynwAAAAAAAKSR0k8="
    
    const parsed = parseSpliceInsert(cmd)
    
    expect(parsed.spliceEventId).toBe(1207959694)
    expect(parsed.outOfNetworkIndicator).toBe(true)
    expect(parsed.breakDuration.autoReturn).toBe(true)
    expect(parsed.breakDuration.duration).toBe(2700000n)  // 30 seconds in 90kHz
    expect(ticksToSeconds(parsed.breakDuration.duration)).toBe(30)
  })
  
  test("Validate CRC-32", () => {
    const cmd = "/DA0AAAAAAAA///wBQb+cr0AUAAeAhxDVUVJSAAAjn+fCAgAAAAALKChijUCAAmynwAAAAAAAKSR0k8="
    expect(validateSCTE35CRC(cmd)).toBe(true)
  })
  
  test("Parse time_signal with segmentation descriptor", () => {
    const cmd = "/DAlAAAAAAAAAP/wFAUAAAABf+/+LRQrAP4BI9MIAAEBAQAAfxV6OA=="
    
    const parsed = parseTimeSignalWithDescriptor(cmd)
    
    expect(parsed.timeSignal.timeSpecified).toBe(true)
    expect(parsed.descriptors).toHaveLength(1)
    expect(parsed.descriptors[0].segmentationTypeId).toBe(0x34)
    expect(parsed.descriptors[0].segmentationTypeName).toBe("Provider Placement Opportunity Start")
  })
})
```

---

## 🎓 **Best Practices from Specification**

### **1. Always Validate Before Parsing**

```typescript
export function validateAndParseSCTE35(attrs: Record<string, string>): SCTE35Signal | null {
  const cmd = attrs["SCTE35-CMD"] || attrs["SCTE35-OUT"]
  
  if (cmd) {
    // 1. Check it's valid base64
    if (!isValidBase64(cmd)) {
      console.error('Invalid base64 in SCTE35-CMD')
      return null
    }
    
    // 2. Check table ID (must be 0xFC)
    if (!isValidSCTE35TableId(cmd)) {
      console.error('Invalid table ID (expected 0xFC)')
      return null
    }
    
    // 3. Validate CRC
    if (!validateSCTE35CRC(cmd)) {
      console.error('CRC validation failed')
      return null
    }
    
    // 4. Now safe to parse
    return parseSCTE35Command(cmd, attrs)
  }
  
  return fallbackParsing(attrs)  // Use current method
}
```

---

### **2. Handle Encrypted Commands Gracefully**

```typescript
if (isSCTE35Encrypted(cmd)) {
  console.warn('SCTE-35 is encrypted - using fallback attributes')
  // Fall back to DATERANGE attributes (DURATION, X-BREAK-DURATION, etc.)
  return parseDateRangeAttributesOnly(attrs)
}
```

---

### **3. Log All Parsed Metadata**

```typescript
export function logSCTE35Details(signal: SCTE35Signal, command?: SpliceInsertCommand) {
  console.log('SCTE-35 Signal:', {
    id: signal.id,
    type: signal.type,
    duration: signal.breakDuration || signal.duration,
    pts: command?.spliceTime?.ptsTime,
    eventId: command?.spliceEventId,
    autoReturn: command?.breakDuration?.autoReturn || signal.autoReturn,
    upid: signal.upid,
    segmentationType: signal.segmentationType
  })
}
```

---

## 🎯 **Summary & Recommendations**

### **Priority Actions:**

| Action | Timeline | Impact |
|--------|----------|--------|
| **1. Add PTS extraction** | This week | 🔴 High - Frame-accurate insertion |
| **2. Implement splice_insert parsing** | Next 2 weeks | 🔴 High - Broadcast quality |
| **3. Add CRC validation** | Next month | 🟡 Medium - Robustness |
| **4. Parse segmentation descriptors** | Q1 2026 | 🟡 Medium - Enhanced metadata |
| **5. Support all UPID types** | Q1 2026 | 🟢 Low - Better targeting |

---

### **What to Implement:**

✅ **Phase 1 (Now):**
1. Binary splice command parsing
2. PTS extraction and conversion
3. Frame-accurate timing
4. Splice event ID tracking

✅ **Phase 2 (Next):**
1. CRC-32 validation
2. Enhanced segmentation descriptors
3. Multiple descriptor support
4. All segmentation type IDs

⏰ **Phase 3 (Future):**
1. Encryption detection
2. UPID type parsing (all 16 types)
3. Delivery restrictions
4. Component-level splicing

---

### **Current Implementation Rating:**

**Overall: 8/10** 🌟

**Strengths:**
- ✅ Solid HLS DATERANGE parsing
- ✅ Good signal type detection
- ✅ Handles common use cases well
- ✅ Clean, maintainable code

**Gaps:**
- ❌ No binary splice command parsing (frame-accurate timing)
- ❌ No CRC validation (robustness)
- ⚠️ Limited segmentation descriptor parsing

**Recommendation:**
Implement **Phase 1** (binary parsing + PTS) for production broadcast quality. Current implementation is fine for most streaming use cases, but binary parsing unlocks frame-accurate insertion for premium content.

---

**Next Steps:**
1. Review this document with the team
2. Prioritize Phase 1 features
3. Implement PTS extraction (quick win)
4. Plan full binary parsing for Q4 2025

---

**References:**
- SCTE 35 2023 Standard (Digital Program Insertion Cueing Message)
- Apple HLS SCTE-35 Specification
- MPEG-2 Systems (ISO/IEC 13818-1) for PTS/DTS

