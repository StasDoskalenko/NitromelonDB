# CI workflows

Release and publish process, and its troubleshooting: `README.md` here.

- After editing anything here, run `yarn lint:workflows` (actionlint + action-validator). `workflow-lint.yml` runs it as its own workflow so a broken `ci.yml` still fails checks. action-validator has no Windows binary.
- action-validator is stricter than GitHub. For example, `push.branches` must be an array even though GitHub accepts a string.
- `android-emulator-runner` runs each `script:` line as a separate `sh -c` (dash). Multi-line shell and `pipefail` do not work there. Put the logic in `scripts/ci-*.sh` and call it as one line.
- Perf noise is handled by measuring a fixed reference in the same job and comparing against its history median (iOS: the WatermelonDB benchmark; Android: the NotesApp reference build, `notesapp-android-reference`). Extend that mechanism rather than adding A/B reruns.
- Release lines (`release/X.Y.x`, cut by `cut-release-line.yml`) run their own copies of `prepare-release.yml` and `publish-release.yml`: a workflow runs from the file on its branch. Cutting a line opens a PR into it with master's release tooling when the tag's differs (the list is in `cut-release-line.yml`); the cut itself only creates the branch at the tag, since the ruleset requires PRs on `release/*.x`. A later fix to the tooling reaches an existing line the same way. Prepare Release's own PR branches are `release/vX.Y.Z`, so patterns for lines must be `release/*.x`.
