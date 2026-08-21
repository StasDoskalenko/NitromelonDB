<img src="https://github.com/Nozbe/WatermelonDB/raw/master/assets/needyou.jpg" alt="We need you" width="220" />

**NitromelonDB is an open-source fork of WatermelonDB, and it needs your help to thrive!**

If there's a missing feature, a bug, or other improvement you'd like, we encourage you to contribute! Feel free to open an issue to get some guidance and see [Contributing guide](./CONTRIBUTING.md) for details about project setup, testing, etc.

If you're just getting started, see [good first issues](https://github.com/StasDoskalenko/NitromelonDB/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) that are easy to contribute to.

If you make or are considering making an app using NitromelonDB, please let us know!

<br />


## Before you send a pull request

1. Did you add or changed some functionality?

   Add (or modify) tests!
2. Check if the automated tests pass
   ```bash
   yarn ci:check
   ```
3. Format the files you changed
   ```bash
   yarn prettier
   ```
4. Mark your changes in `CHANGELOG-Unreleased.md`

   Put a one-line description under the matching section (New features, Fixes, Changes, …). Those notes are copied into `CHANGELOG.md` automatically when a release is prepared. See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Running Watermelon in development

### Download source and dependencies

This repo is pinned to **Yarn 4.18** (`packageManager` in `package.json`, binary in `.yarn/releases`). A `yarn` on your PATH is enough; the project's `yarnPath` boots the pinned version.

```bash
git clone https://github.com/StasDoskalenko/NitromelonDB.git
cd NitromelonDB
yarn
```

### Developing Watermelon alongside your app

To work on Watermelon code in the sandbox of your app:

```bash
yarn dev
```

This will create a `dev/` folder in Watermelon and observe changes to source files (only JavaScript files) and recompile them as needed.

Then in your app:

```bash
cd node_modules
rm -fr nitromelondb
ln -s path-to-nitromelondb/dev nitromelondb
```

**This will work in Webpack but not in Metro** (React Native). Metro doesn't follow symlinks. Instead, you can compile WatermelonDB directly to your project:

```bash
DEV_PATH="/path/to/your/app/node_modules/nitromelondb" yarn dev
```

### Running tests

This runs Jest, ESLint, and TypeScript:

```bash
yarn ci:check
```

You can also run them separately:

```bash
yarn test
yarn eslint
yarn typecheck
yarn test:typescript
```

Pull requests must pass the **ESLint** and **TypeScript** CI jobs.

### Editing files

We recommend VS Code with ESLint, TypeScript, and Prettier plugins for best development experience. (To see lint/type issues inline + have automatic reformatting of code)

## Editing native code

In `native/ios` and `native/android` you'll find the native bridge code for React Native.

It's recommended to use the latest stable version of Xcode / Android Studio to work on that code.

### Integration tests

If you change native bridge code or `adapter/sqlite` code, it's recommended to run integration tests that run the entire Watermelon code with SQLite and React Native in the loop:

```bash
yarn test:ios
yarn test:android
```

### Maestro e2e (NotesApp)

The Expo example app under `examples/NotesApp` includes [Maestro](https://docs.maestro.dev) UI flows that exercise Nitro SQLite on a simulator (cold start / seed, create-pin-delete, kill-and-relaunch, interaction burst, sticky `Q.skip` + `Q.take` pagination).

Do not run these from the library root. Install the Maestro CLI, boot a simulator, install a development build, then:

```bash
cd examples/NotesApp
yarn start:e2e   # expo start --dev-client --no-dev
maestro test maestro/
```

Reuse Metro on port **8081** if it is already running. Prefer `yarn start:e2e` over plain `yarn start` for e2e (dev mode off). Details: [`examples/NotesApp/README.md`](https://github.com/StasDoskalenko/NitromelonDB/blob/master/examples/NotesApp/README.md).

### Running tests manualy

- For iOS open the `native/iosTest/WatermelonTester.xcworkspace` project and hit Cmd+U.
- For Android open `native/androidTest` in AndroidStudio navigate to `app/src/androidTest/java/com.nozbe.watermelonTest/BridgeTest` and click green arrow near `class BridgeTest`

### Native linting

Make sure the native code you're editing conforms to Watermelon standards:

```bash
yarn ktlint
```

### Native code troubleshooting

1. If `test:ios` fails in terminal:
- Run tests in Xcode first before running from terminal
- Make sure you have the right version of Xcode CLI tools set in Preferences -> Locations
1. Make sure you're on the most recent stable version of Xcode / Android Studio
1. Remove native caches:
- Xcode: `~/Library/Developer/Xcode/DerivedData`:
- Android: `.gradle` and `build` folders in `native/android` and `native/androidTest`
- `node_modules` (because of React Native precompiled third party libraries)


