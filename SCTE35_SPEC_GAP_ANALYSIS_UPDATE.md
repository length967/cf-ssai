# SSAI Timing & Manifest Conditioning Audit (Post-Refactor)

This follow-up review inspects the latest `cf-ssai` implementation against the **HLS SSAI Timing & Manifest Conditioning Specification**. Each section maps spec expectations to the current code paths to highlight the remaining work.

## 1. Transport-level SCTE-35 ingest & normalized events (Spec MUST §4.1, §6)

* **Expectation:** Discover the SCTE-35 PID from the PMT, track continuity/CRC, and expose cues as `{ id, type, pts_90k, break_90k?, rawHex }`.
* **Reality:** Cue discovery still reads `#EXT-X-DATERANGE` tags via `parseSCTE35FromManifest`, never touching TS packets or the PMT, while `stripOriginSCTE35Markers` removes upstream SCTE-35 markers before we can reuse them (`src/channel-do.ts`). The in-memory `SCTE35Signal` shape omits `rawHex` and continuity metadata, so downstream logic cannot satisfy the spec’s unified event model (`src/types.ts`).

## 2. PTS↔PDT mapping & drift (Spec MUST §4.2, §7)

* **Expectation:** Maintain an affine transform between 90 kHz PTS and wall clock, reset on discontinuities, and surface drift metrics.
* **Reality:** `replaceSegmentsWithAds` hunts for a literal `PROGRAM-DATE-TIME` match, then skips EXTINF durations with no stored PTS↔UTC mapping or drift telemetry. DISCONTINUITY tags are emitted, but the code never re-initializes a transform because none exists (`src/utils/hls.ts`).

## 3. IDR snapping & boundary control (Spec MUST §4.3, §8)

* **Expectation:** Snap each OUT/IN to the first IDR ≥ cue time, record the snapped point, and instruct the segmenter accordingly.
* **Reality:** The segment replacer derives `segmentsToReplace` by dividing break duration by an averaged EXTINF duration, with no GOP or IDR awareness. There is no interface for requesting a boundary cut or for measuring ≤250 ms error (`src/utils/hls.ts`).

## 4. Manifest conditioning (Spec MUST §4.4, §9; SHOULD §4.1)

* **Expectation:** Emit a paired `#EXT-X-DATERANGE` announce/finalize sequence with the same ID, keep SCTE-35 payloads in hex, and add compatibility `#EXT-X-CUE-OUT/IN` tags while preserving PROGRAM-DATE-TIME monotonicity.
* **Reality:** `addDaterangeInterstitial` injects a single Apple interstitial record and `stripOriginSCTE35Markers` deletes the origin’s SCTE attributes. No code renders the finalize record, the SCTE-35 payloads stay base64, and compatibility cue tags are absent (`src/utils/hls.ts`, `src/channel-do.ts`).

## 5. Variant ladder consistency (Spec MUST §4.5, §9.4)

* **Expectation:** Apply the same splice boundaries, DATERANGE/CUE decorations, and MEDIA-SEQUENCE math to every rendition, keeping ≥3 target durations in the sliding window.
* **Reality:** Each playlist request mutates only the requested variant within `channel-do.ts`; skip counts are recomputed per-request unless cached in DO state. There is no loop broadcasting boundaries to the rest of the ladder or guardrails to keep ≥3 segments during breaks (`src/channel-do.ts`).

## 6. Ad pod duration truth & slate (Spec SHOULD §4.3, §10)

* **Expectation:** Reconcile final DURATION/END-DATE with stitched media, pad/trim to the snapped IN boundary, and update manifests accordingly.
* **Reality:** The ad pod builder sums actual EXTINF durations for insertion but never updates a closing DATERANGE, pads to the next IDR, or trims overruns. Slate logic remains implicit in decision responses, and there is no validation that `|sum(ad) − break| ≤ 250 ms` (`src/utils/hls.ts`, `src/channel-do.ts`).

## 7. Observability & health metrics (Spec SHOULD §4.5, §12)

* **Expectation:** Surface PID continuity, CRC, cue decode status, boundary error, and drift metrics for operators.
* **Reality:** Aside from console logs noting CRC validity, there is no metric emission for PID continuity, drift, or boundary snapping outcomes. Durable Object state tracks skip counts but not health telemetry (`src/utils/scte35.ts`, `src/channel-do.ts`).

## Summary

Despite recent refactors, the system remains manifest-driven and lacks the transport-level ingest, timebase control, IDR alignment, and manifest conditioning required by the spec. The gaps now span every MUST item plus most SHOULD guidance, so closing them will demand new ingest plumbing, shared timing state, GOP-aware boundary orchestration, manifest writers that emit paired DATERANGE/CUE tags across all variants, and a telemetry surface for PID/PTS health.
