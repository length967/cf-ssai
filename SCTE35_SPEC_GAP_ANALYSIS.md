# SSAI Timing & Manifest Conditioning Gap Review

This note compares the current `cf-ssai` implementation with the **HLS SSAI Timing & Manifest Conditioning Specification**.

## 1. SCTE-35 ingestion & PID handling

* **Spec intent:** Discover the SCTE-35 PID via PMT parsing and normalize cues into an `{id,type,pts_90k,break_90k?,rawHex}` model for downstream consumers.
* **Current state:** Cues are inferred from `#EXT-X-DATERANGE` tags in the origin manifest via `parseSCTE35FromManifest`, so the transport stream is never inspected and no PID/PMT logic exists (`src/utils/scte35.ts`).
* **Observations:** Binary parsing captures CRC validity, but continuity counters and PID drift metrics are absent; the in-memory cue shape (`SCTE35Signal`) does not preserve the raw hex blob or enforce the spec’s normalized structure (`src/channel-do.ts`, `src/utils/scte35.ts`).

## 2. Timebase mapping (PTS ↔ PROGRAM-DATE-TIME)

* **Spec intent:** Maintain a continuous affine transform between 90 kHz PTS and UTC, reset on discontinuities, and expose drift metrics.
* **Current state:** Ad splicing searches for a literal `PROGRAM-DATE-TIME` string match and replaces segments relative to that line; there is no persisted PTS↔PDT mapping or drift measurement (`src/utils/hls.ts`).
* **Observations:** DISCONTINUITY tags bracket the ad pod, but the downstream PDT timeline depends entirely on manifest text search, so any jitter between PTS and PDT cannot be tracked.

## 3. Boundary quantization (IDR snapping)

* **Spec intent:** Snap each OUT/IN to the first IDR ≥ cue time and let the segmenter cut on that boundary so pods never land mid-GOP.
* **Current state:** `replaceSegmentsWithAds` counts content segments to skip based on EXTINF durations instead of aligning to IDR timestamps, and there is no interface with encoder GOP metadata (`src/utils/hls.ts`).
* **Observations:** Without GOP awareness, boundary error accumulates whenever the cue falls inside a segment, and the system cannot guarantee the ≤250 ms bound from the spec.

## 4. Manifest conditioning (DATERANGE + compatibility CUE tags)

* **Spec intent:** Emit paired `#EXT-X-DATERANGE` lines (announce vs finalize) with the same ID, preserve original attributes, and add `#EXT-X-CUE-OUT/IN` for compatibility while keeping SCTE-35 payloads in hex.
* **Current state:** The helper `addDaterangeInterstitial` writes a single Apple interstitial DATERANGE with class `com.apple.hls.interstitial`, removes upstream SCTE markers, and does not emit complementary CUE tags (`src/utils/hls.ts`, `src/channel-do.ts`).
* **Observations:** Because the announce/finalize pair is collapsed into one record, breaks never self-heal if later metadata arrives, and players expecting `CUE-OUT/IN` tags or SCTE-35 hex attributes do not receive them.

## 5. Variant consistency & live window hygiene

* **Spec intent:** Apply identical splice boundaries, DATERANGE/CUE decoration, and media sequence math across every rendition while keeping ≥3 target durations in the live window.
* **Current state:** Each playlist request is mutated independently inside `channel-do.ts`; there is no loop that stamps all variants or synchronizes skip counts between renditions, so alignment depends on which variant the viewer requests first (`src/channel-do.ts`).
* **Observations:** The worker relies on the origin live window for pruning and only checks the active manifest for stale PDTs, leaving clients vulnerable to missing freshly announced OUT/IN markers when the window advances.

## 6. Ad pod duration truth & observability

* **Spec intent:** Declare final DURATION/END-DATE from measured media, pad/trim against IDR boundaries, and expose telemetry for PID continuity, cue decode, boundary alignment, and drift.
* **Current state:** Ad segment insertion uses actual durations when building EXTINF entries but does not reconcile them with a finalized DATERANGE or publish drift/continuity metrics (`src/utils/hls.ts`, `src/channel-do.ts`).
* **Observations:** CRC validity is logged for decoded cues, yet there is no continuity counter tracking and no metric output describing pod duration error versus SCTE-35 PLANNED/DURATION attributes.

## Summary

The implementation fulfills basic cue detection and ad splicing for manifest-based workflows, but it diverges from the spec on every MUST item except DISCONTINUITY injection. Bringing the system into compliance requires transport-level PID discovery, a persistent PTS↔PDT mapper with drift telemetry, IDR-aware boundary control, spec-compliant DATERANGE/CUE emission across all variants, and stronger window management plus duration reconciliation.
