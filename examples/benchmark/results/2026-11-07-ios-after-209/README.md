# NitromelonDB after #209 against WatermelonDB 0.28 JSI

NitromelonDB at #209's branch (batchJSI, conflict-time inference; what v0.32.0-beta.0 ships, before
#208's small sync fix) against WatermelonDB 0.28 with JSI, same setup as `../2026-11-07-ios`.
8 runs per app for Sync and Realistic sync, 10 for Incremental, 3 for Stress.

    node ../../scripts/summarize-sync.mjs vs-watermelondb-jsi-sync.jsonl --baseline 'WatermelonDB JSI'
