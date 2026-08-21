# Anti-loop (small models)

If you rewrite the **same approach** twice without new evidence (new error, new test failure, new file facts), **stop**.

Do this instead:

1. Ship the simplest version that matches the API and the test contract.
2. Ask the user, or run the app / Maestro once.
3. Do not invent refs / races / “maybe” rewrites in a loop.

Forbidden patterns:

- Pasting the same paragraph of reasoning again
- “Writing the X…” then undoing X for a third time
- Solving hypothetical races that the library already handles via observers

Observers (`experimentalSubscribe*`) will fire again after writes. A brief `0` notes before seed finishes is normal. Maestro should assert the final state (`100 notes`), not the first paint.
