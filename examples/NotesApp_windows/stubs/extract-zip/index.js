// Stands in for extract-zip, which has two unfixed symlink path traversal advisories
// (GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv; every release, <= 2.0.1, is affected).
//
// Its only user here is puppeteer-core 5 (via @react-native-windows/automation -> webdriverio 6),
// which requires it when loading, but only calls it to unpack a Chromium it downloads
// (BrowserFetcher). Nothing in this app downloads a browser: the Windows e2e drives the app through
// WinAppDriver. So this keeps the require working, and fails loudly if anything ever does call it.
module.exports = async function extractZip() {
  throw new Error(
    'extract-zip is stubbed out in examples/NotesApp_windows (unfixed security advisories). ' +
      'Nothing here should unpack archives; see stubs/extract-zip/index.js.',
  )
}
