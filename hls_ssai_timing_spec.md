# HLS SSAI Timing & Manifest Conditioning Specification

**Scope:** HLS live/linear workflows with Server‑Side Ad Insertion (SSAI). Input is MPEG‑TS with in‑band SCTE‑35. Output is HLS master + media playlists with stitched ad media and manifest decoration compliant with Apple HLS (RFC 8216 + current DATERANGE guidance). Examples also include MediaTailor‑style CUE tags for ecosystem compatibility.

**Stack Assumptions:** Node.js (TypeScript), packager/segmenter capable of IDR alignment and segment boundary control. Future MPEG‑DASH support is out of scope for this spec.

---

## 1. Goals

1. Ads never end early or cut into program content.
2. Splice points land on GOP/segment boundaries (IDR‑aligned) and remain stable across variants.
3. Manifest signals are consistent and self‑correcting: OUT is announced, IN is finalized using the same ID.
4. Timing is derived from media PTS, mapped deterministically to wall‑clock (`PROGRAM-DATE-TIME`).
5. The SCTE‑35 PID is always discovered, preserved, and parsed.

---

## 2. Terminology & Standards

- **SCTE‑35**: In‑band cue messages carried on a dedicated PID within an MPEG‑TS Program.
- **PID**: Packet Identifier. SCTE‑35 cues appear on a distinct PID described by the Program's PMT.
- **PTS**: 90 kHz timestamp used in TS elementary streams and referenced by SCTE‑35 (`pts_time`).
- **HLS DATERANGE**: `#EXT-X-DATERANGE` entries used to represent splice OUT/IN windows and metadata.
- **CUE tags**: `#EXT-X-CUE-OUT` / `#EXT-X-CUE-IN` (widely supported, non‑normative). Use alongside DATERANGE for compatibility.
- **Planned vs Actual**: `PLANNED-DURATION` is advisory; `DURATION`/`END-DATE` closes the break authoritatively.

---

## 3. System Architecture (High‑Level)

```
[TS Ingest] -> [Demux + PMT parse] -> [Find SCTE-35 PID] -> [Parse splice events]
    -> [PTS<->PDT Mapper] -> [IDR/GOP Quantizer] -> [Ad Decisioning/Pod Builder]
    -> [Manifest Decorator] -> [Segment Stitcher across Variants] -> [HLS Out]
    -> [Validator + Metrics]
```

---

## 4. MUST/SHOULD Requirements

**MUST**

1. Detect SCTE‑35 PID via PMT and parse all `splice_info_section` messages.
2. Maintain a continuous **PTS↔PDT** affine mapping for each variant.
3. At each OUT and IN, force a segment boundary at the **first video IDR ≥ cue time** (IDR‑snap forward).
4. Use a single **DATERANGE **`` to represent the break: one record to announce OUT, another to finalize with `DURATION` or `END-DATE` (and optional IN cue).
5. Keep `PROGRAM-DATE-TIME` monotonic across breaks; insert `#EXT-X-DISCONTINUITY` when codecs/timelines change.
6. Stitch ads across **all variants**; preserve `EXT-X-MEDIA-SEQUENCE` progression; maintain **≥3 target durations** in live windows.

**SHOULD**

1. Emit both **DATERANGE** and **CUE** tags for ecosystem compatibility.
2. Use `PLANNED-DURATION` initially; later add `DURATION`/`END-DATE`. Never shorten an already announced window.
3. Sum **actual ad media durations** (post‑transcode) to compute final `DURATION`.
4. Provide a small slate/filler segment if pod sum under‑laps to the next IDR.
5. Expose observability (see §12) for PID continuity, cue decode, boundary alignment, and drift.

**MAY**

1. Use SCTE‑224 out‑of‑band schedules as hints.
2. Include ad metadata on DATERANGE (e.g., `X-ASSET-URI`, `X-AD-ID`).

---

## 5. Encoder/Packager Preconditions

- **IDR at Cues**: Configure encoder/packager to insert IDR at or just before splice OUT and IN.
- **Segmenter**: Segment boundaries must be permitted at cue‑aligned IDRs.
- **PMT**: Ensure the SCTE‑35 PID is present and stable; monitor for continuity errors.

---

## 6. Cue Parsing & Data Model

### 6.1 Event Model

```ts
export type SpliceType = "OUT" | "IN";

export interface Scte35Event {
  eventId: string;            // stable id across OUT/IN for a break
  type: SpliceType;           // OUT or IN
  ptsTime90k: number;         // pts_time in 90kHz units
  breakDuration90k?: number;  // optional from descriptors
  rawHex: string;             // full encoded splice_info_section as 0x...
  recvAtMs: number;           // wall-clock receipt time (for logging)
}
```

### 6.2 Parsing in Node.js

Use an existing SCTE‑35 parser (e.g., `scte35` npm) or integrate a minimal reader. Example shim:

```ts
import { parseScte35 } from "./vendor/scte35"; // wrap your chosen lib

export function decodeScte35(raw: Buffer): Scte35Event[] {
  const msg = parseScte35(raw);
  const out: Scte35Event[] = [];
  if (msg.type === "splice_insert") {
    const base: Partial<Scte35Event> = {
      eventId: String(msg.event_id),
      ptsTime90k: Math.round(msg.pts_time * 90000),
      breakDuration90k: msg.break_duration ? Math.round(msg.break_duration * 90000) : undefined,
      rawHex: "0x" + raw.toString("hex"),
      recvAtMs: Date.now(),
    };
    if (msg.out_of_network_indicator) {
      out.push({ ...(base as any), type: "OUT" });
    } else {
      out.push({ ...(base as any), type: "IN" });
    }
  } else if (msg.type === "time_signal") {
    // interpret via descriptors (e.g., segmentation_type_id)
    const isOut = msg.segmentation_type_id === 0x10 /* provider_ad_start */;
    const isIn  = msg.segmentation_type_id === 0x11 /* provider_ad_end */;
    if (isOut || isIn) {
      out.push({
        eventId: String(msg.segmentation_event_id ?? msg.event_id ?? Date.now()),
        type: isOut ? "OUT" : "IN",
        ptsTime90k: Math.round(msg.pts_time * 90000),
        breakDuration90k: msg.break_duration ? Math.round(msg.break_duration * 90000) : undefined,
        rawHex: "0x" + raw.toString("hex"),
        recvAtMs: Date.now(),
      });
    }
  }
  return out;
}
```

> **Note:** Derive exact descriptor semantics from your parser library; the above illustrates the shape.

---

## 7. PTS↔PDT Mapping

Maintain a linear transform per variant:

```
PDT_ms = a * PTS_90k + b
```

- Update `(a,b)` using observed segment boundaries where both PTS and `EXT-X-PROGRAM-DATE-TIME` are known.
- Persist the latest mapping and extrapolate between updates. Guard against discontinuities by resetting on `#EXT-X-DISCONTINUITY`.

```ts
export interface PtsPdtMap { a: number; b: number; }

export function fitPtsPdt(pairs: Array<{ pts90k: number; pdtMs: number }>): PtsPdtMap {
  // simple linear regression (or just two-point fit if you trust stability)
  const n = pairs.length;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const p of pairs) { sumX += p.pts90k; sumY += p.pdtMs; sumXX += p.pts90k*p.pts90k; sumXY += p.pts90k*p.pdtMs; }
  const a = (n*sumXY - sumX*sumY) / (n*sumXX - sumX*sumX);
  const b = (sumY - a*sumX) / n;
  return { a, b };
}

export const pts90kToIso = (map: PtsPdtMap, pts90k: number) => new Date(map.a*pts90k + map.b).toISOString();
```

---

## 8. IDR/GOP Quantization & Segment Policy

- **IDR‑Snap Forward:** For OUT/IN cues that land mid‑GOP, snap to the **first IDR ≥ cue time**.
- **Segment Start at OUT/IN:** Force a new segment at each snapped boundary.
- **Tolerances:**
  - Max boundary error: **≤ 250 ms** vs cue target.
  - Live target duration stable (e.g., 6s).
- **No Mid‑GOP Cuts:** Never cut on P/B frames.

```ts
export interface BoundaryDecision {
  targetPts90k: number; // cue time
  snappedPts90k: number; // first IDR >= target
  reason: "aligned" | "snapped_to_next_idr";
}
```

---

## 9. Manifest Decoration

### 9.1 Apple‑Spec DATERANGE (authoritative)

**Start of break (announce + plan):**

```m3u8
#EXT-X-DATERANGE:ID="evt-1234",
  START-DATE="2025-11-08T00:15:12.123Z",
  SCTE35-OUT=0xFC30ABCD...,
  PLANNED-DURATION=60.0
```

**Close break (finalize):**

```m3u8
#EXT-X-DATERANGE:ID="evt-1234",
  END-DATE="2025-11-08T00:16:12.123Z",
  DURATION=60.0,
  SCTE35-IN=0xFC30ABCD...
```

**Notes**

- Use the **same **`` for both lines.
- You may also attach `X-AD-ID`, `X-CAMPAIGN-ID`, and `X-POD-SEQ` vendor keys.

### 9.2 MediaTailor‑Style CUE Tags (compatibility)

```m3u8
#EXT-X-CUE-OUT:DURATION=60.0
... ad segments ...
#EXT-X-CUE-IN
```

> Emit **both DATERANGE and CUE** for maximum player/CDN compatibility.

### 9.3 Discontinuities & Date Time

- Keep `#EXT-X-PROGRAM-DATE-TIME` continuous across the break.
- Insert `#EXT-X-DISCONTINUITY` if codecs/timebases change between program and ad ladder.

### 9.4 Multi‑Variant Consistency

- Apply identical DATERANGE/CUE decorations and boundary sequence numbers to each variant playlist.
- **All variants must segment at the same boundaries.**

---

## 10. Ad Pod Construction

1. Derive **planned duration** from SCTE‑35 descriptors or ad decision response.
2. Fetch creatives per rendition (or transcode to ladder). Ensure GOP structure matches the program’s cadence where possible.
3. Compute **actual pod duration** by summing segment durations post‑transcode.
4. If sum < next program IDR, add slate filler to meet the IDR boundary; else trim at the IN boundary.
5. When finalized, output DATERANGE update with `DURATION` and/or `END-DATE` using the same `ID`.

---

## 11. Node.js Reference Implementations

### 11.1 DATERANGE Builder

```ts
export interface DaterangeOut {
  id: string; startIso: string; scte35OutHex: string; plannedSec?: number; extra?: Record<string,string|number>;
}

export interface DaterangeIn {
  id: string; endIso: string; durationSec: number; scte35InHex?: string; extra?: Record<string,string|number>;
}

export const renderDaterangeOut = (d: DaterangeOut) => (
  `#EXT-X-DATERANGE:ID="${d.id}",`+
  `\n  START-DATE="${d.startIso}",`+
  `\n  SCTE35-OUT=${d.scte35OutHex}`+
  (d.plannedSec ? `,\n  PLANNED-DURATION=${d.plannedSec.toFixed(1)}` : "")+
  Object.entries(d.extra ?? {}).map(([k,v]) => `,\n  ${k}=${JSON.stringify(v)}`).join("")
);

export const renderDaterangeIn = (d: DaterangeIn) => (
  `#EXT-X-DATERANGE:ID="${d.id}",`+
  `\n  END-DATE="${d.endIso}",`+
  `\n  DURATION=${d.durationSec.toFixed(1)}`+
  (d.scte35InHex ? `,\n  SCTE35-IN=${d.scte35InHex}` : "")+
  Object.entries(d.extra ?? {}).map(([k,v]) => `,\n  ${k}=${JSON.stringify(v)}`).join("")
);
```

### 11.2 Cue→Boundary Quantization

```ts
export function snapToNextIdr(targetPts90k: number, idrPts90kAsc: number[]): number {
  const i = idrPts90kAsc.findIndex(v => v >= targetPts90k);
  return i >= 0 ? idrPts90kAsc[i] : idrPts90kAsc[idrPts90kAsc.length - 1];
}
```

### 11.3 Playlist Mutator (Sketch)

```ts
interface Segment { uri: string; duration: number; pdtIso?: string; seq: number; discontinuity?: boolean; }
interface VariantPlaylist { targetDuration: number; mediaSequence: number; segments: Segment[]; }

export function spliceAdSegments(vod: VariantPlaylist, outIdx: number, inIdx: number, adSegs: Segment[]): VariantPlaylist {
  const pre = vod.segments.slice(0, out
```
