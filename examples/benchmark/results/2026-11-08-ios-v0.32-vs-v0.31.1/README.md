# v0.32.0-beta.0 against v0.31.1

The same benchmark app (this release's `examples/benchmark/nitromelondb_benchmark`), built twice as a
Release build: once with this release's library, once with v0.31.1's `src/` and `native/` under its
own bundle id. iPhone 18 Pro simulator (iOS 27.1, React Native 0.88), Apple M5 Pro, 2026-11-08.
Runs interleaved in random order with `run-sync-trials.mjs` (launch driver), every run on a fresh
database. Sync, Incremental and Realistic: 8 runs per version; Stress: 3.

    node ../../scripts/summarize-sync.mjs vs-v0.31.1-sync.jsonl --baseline v0.31.1
