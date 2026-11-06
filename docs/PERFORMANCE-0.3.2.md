# Progress updates in Ravenshelf 0.3.2

Measured 6 November 2026 against 0.3.1, commit `f2596811f4004adfc13ecc1adfcc04691572eaf6`. Version 0.3.2 batches progress updates every 500 ms and sends only changing fields for active downloads. It keeps full snapshots for initial state and meaningful state changes, including completion and scan state.

**A controlled Electron comparison found substantially less renderer work and scheduling delay with a large download history.** Small queues were already responsive. This is a UI-overhead result, not a filehost download-speed improvement.

## Measurements

Every case had four active downloads. The small fixture had 20 completed downloads and 20 saved games. The large fixture had 500 completed downloads, 250 saved games and five collections, with 150 saved-game entries in each collection. The Downloads view displayed all 24 or 504 download cards.

Results are **0.3.1 → 0.3.2**. Each timing p95 is the median of three separate trial p95 values. Callback work is the total measured callback time divided by the total scheduled update duration across those trials.

| Scenario | Messages/second | Estimated payload bytes/second | Callback p95 | Callback work/second | 20 ms timer: p95 lateness |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small, keep open | 8 → 2 | 141,111 → 853 | 0.9 → 0.2 ms | 5.49 → 0.18 ms | 1.2 → 1.1 ms |
| Large, keep open | 8 → 2 | 3,937,647 → 853 | 11.6 → 0.2 ms | 83.12 → 0.19 ms | 21.5 → 1.4 ms |
| Large, completion armed | 17 → 3 | 8,369,461 → 493,174 | 11.5 → 12.5 ms | 165.84 → 12.67 ms | 29.6 → 2.5 ms |

In the large default case, the JSON-equivalent progress payload was about **99.98% smaller**. The lower callback work and timer lateness support less renderer blocking. In the small case, timer responsiveness was essentially unchanged; it should not be advertised as a dramatic visible improvement.

### Why armed completion still has a slow callback

An armed completion action retains its full once-per-second safety snapshot. The individual slow-callback p95 therefore did not improve in that case, even though total callback work fell substantially. The smaller progress messages do not replace or delay completion checks.

The 0.3.1 armed baseline sends 17 full snapshots each second during steady progress: eight file-timer events, eight additional publications caused by `completion.refresh()` and one independent completion tick. Version 0.3.2 sends two progress batches and retains the one full completion tick. This comparison models the actual event paths, rather than assuming only eight baseline messages when completion is armed.

### Offscreen rendering observations

At a 60 FPS offscreen target, animation-frame gaps greater than 25 ms across the three trials were 0 → 0 for the small case, 1 → 0 for the large default case, and 112 → 6 for the large armed case. The armed baseline had one gap above 50 ms; the other groups had none. No PerformanceObserver long task above 50 ms was recorded.

These are offscreen renderer observations, not a visible-window recording or a guarantee about every machine or interaction. Callback work and timer lateness are the main evidence.

## Method and reproduction parameters

The actual app HTML, CSS, renderer JavaScript and preload ran under Electron **45.2.3**, with its Node **24.22.2** runtime on Windows. The test used a separate profile and a hidden offscreen window; no normal user profile was accessed. The window retained sandboxing, context isolation and disabled Node integration. External requests and permissions were blocked; catalog/API replies were fixtures.

To reproduce the comparison, use these parameters:

1. Load the 0.3.1 renderer/preload and the 0.3.2 renderer/preload in separate fresh 1280 × 900 Electron windows. Set `show: false`, `offscreen: true`, `backgroundThrottling: false`, and target 60 FPS. Use identical settings for both versions.
2. Supply one initial full state with four active 1 GiB files, each starting at 100 MiB received, and the completed-history/saved-library sizes above. Completed records include a clean scan result. Use synthetic names, locations and URLs only.
3. Display the Downloads view with the **All** filter. For the armed fixture, use an armed close action with four targets; do not attach an actual close or shutdown handler.
4. For the baseline, stagger the four file-progress events 125 ms apart. Each file gains 64 KiB every 500 ms. Send full snapshots using the 8/17-message event patterns described above. For 0.3.2, send a batch for all four active files every 500 ms, with the shared update sequence and the allowed fields `id`, `received`, `total`, `speed` and `activeConnections`. Retain the full once-per-second snapshot in the armed case.
5. Run three repeats for each version/scenario pair, alternating which version runs first across repeats: **18 trials** total. Allow 1.5 seconds of warmup, eight seconds of updates, and 0.4 seconds to drain final work for each trial.
6. Time the real registered `onState`/`onProgress` callbacks at the preload boundary. Record a repeating 20 ms renderer timer's lateness, animation-frame gaps and PerformanceObserver long tasks separately. Compute payload estimates with JSON serialization.
7. Verify the final received-byte values, card count and active-file count. All 18 measured trials matched these checks, with no renderer errors.

The benchmark candidate's later version-label change did not affect the hot path; fixture state supplied its displayed version. Source changes to the progress handlers themselves require a fresh comparison.

## Scope and limits

- JSON payload sizes are comparable estimates, not the exact size of Electron's internal wire representation. Initial snapshots and non-progress state changes are excluded from the steady-state figures.
- Callback timing includes the context-bridge callback and synchronous renderer work. It excludes some main-process work, IPC decoding, GPU work and deferred paint. Submillisecond timings are limited by clock resolution.
- Timer lateness is a scheduling-delay proxy, not a direct human input-latency measurement. This small controlled sample is not a performance guarantee for all PCs or histories.
- No files were downloaded or scanned, no actual completion action executed, and no host bandwidth was measured. Host capacity, routing, storage and network conditions still determine download speed.
- The separate 254-test offline regression suite checks download behavior and security-sensitive paths. The performance fixture does not replace tests for pause/resume, range fallback, file integrity, scan results, completion guards, encrypted header persistence or packaged security settings.
