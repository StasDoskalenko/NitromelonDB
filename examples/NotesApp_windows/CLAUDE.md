# examples/NotesApp_windows — React Native Windows (New Architecture) example

A separate package from `../NotesApp`. RNW tracks an older React Native than the Expo app, so the two cannot share one `package.json`. Setup and the full script table: `README.md` here. How Nitro gets onto Windows: `../../native/windows/CLAUDE.md`.

- **The UI is not here.** `src/App.tsx` renders `../NotesApp/src`. Edit there. Windows-only overrides are the `*.windows.tsx` files in that tree.
- The library is linked with `link:../..` (a symlink). Do not switch to `file:`, which copies the whole repo, including gigabytes of MSBuild output.
- Debug loads JS from Metro: `yarn metro` in one terminal, `yarn start:debug` in another. Ctrl+R is not bound, so restart the app process after JS changes. After native changes run `yarn build:debug` (or `build:release`), then `start:*`.
- Debug and Release share one AppX identity: deploying one replaces the other.
- `yarn metro:kill` kills whatever holds port 8081. Only use it on a Metro you started.
- `react-native init-windows` overwrites `metro.config.js`. Re-apply the Metro / `react-native.config.js` customizations after regenerating the project.

## e2e (`e2e/`, WinAppDriver) — `yarn test:windows:e2e`

- These mirror `../NotesApp/maestro/` (`helpers.js` mirrors the Maestro primitives). Keep the two in step.
- Needs the `NitromelonWindows` AppX installed and WinAppDriver on port 4723. `e2e/environment.js` wipes the app's LocalState and launches it before each file.
- Never close the app through the WebDriver session, because that breaks the HWND session. Use `killAndRelaunch()` / `app-process.js`.
- `notes-list` is a hidden, accessible `Text` holding every title (`NotesList.windows.tsx`), because the ScrollView itself is `accessible={false}`. Tests read titles from it, so do not remove it.
- Flaky typing is a WinAppDriver SendKeys bug. Type with `browser.keys()`, and retry the whole click → type → submit → verify cycle (see `addNote`). Never change the production component to work around it.
- CI (`windows` job, `windows-2025`) builds Release and runs e2e in the same job. Release embeds the bundle, so no Metro is needed.
