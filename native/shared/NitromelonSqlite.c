// Compiles the SQLite that NitromelonSqliteConfig.h selects. Build files compile this file, never an
// amalgamation directly, so the options cannot drift between platforms:
//
//   encryption build   native/vendor/sqlite3mc/sqlite3mc_amalgamation.c
//   default, bundled   native/vendor/sqlite/sqlite3.c (Android, Windows)
//   default, system    nothing to compile (iOS links libsqlite3)

#include "NitromelonSqliteConfig.h"

#if NITROMELON_ENCRYPTION

// The dispatch tables hide SQLite's own symbols, but sqlite3mc also bundles parts of libsodium
// (ChaCha20, Poly1305) that stay global under libsodium's public names. Rename them so an app that
// also links libsodium gets neither duplicate symbols nor the other copy's code.
// `yarn test:native-unit` fails on any unprefixed export, so a new one shows up in CI.
#define crypto_onetimeauth_poly1305_donna_implementation nitromelon_crypto_onetimeauth_poly1305_donna_implementation
#define crypto_onetimeauth_poly1305_sse2_implementation nitromelon_crypto_onetimeauth_poly1305_sse2_implementation
#define crypto_stream_chacha20_dolbeau_avx2_implementation nitromelon_crypto_stream_chacha20_dolbeau_avx2_implementation
#define crypto_stream_chacha20_dolbeau_avx512_implementation nitromelon_crypto_stream_chacha20_dolbeau_avx512_implementation
#define crypto_stream_chacha20_dolbeau_neon_implementation nitromelon_crypto_stream_chacha20_dolbeau_neon_implementation
#define crypto_stream_chacha20_dolbeau_ssse3_implementation nitromelon_crypto_stream_chacha20_dolbeau_ssse3_implementation
#define crypto_stream_chacha20_ietf_ext_xor_ic nitromelon_crypto_stream_chacha20_ietf_ext_xor_ic
#define crypto_stream_chacha20_ietf_xor_ic nitromelon_crypto_stream_chacha20_ietf_xor_ic
#define crypto_stream_chacha20_pick_best_implementation nitromelon_crypto_stream_chacha20_pick_best_implementation
#define crypto_stream_chacha20_ref_implementation nitromelon_crypto_stream_chacha20_ref_implementation
#define crypto_stream_chacha20_xor_ic nitromelon_crypto_stream_chacha20_xor_ic
#define sqlite3mcChaCha20HwAccelerated nitromelon_sqlite3mcChaCha20HwAccelerated
#define sqlite3mcChaCha20HwConfig nitromelon_sqlite3mcChaCha20HwConfig

// Third-party code: its warnings (about 50 under Xcode's defaults) would show up in every app that
// builds NitromelonDB. The Windows project turns warnings off for this file the same way.
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Weverything"
#endif
#include "sqlite3mc_amalgamation.c"
#if defined(__clang__)
#pragma clang diagnostic pop
#endif

#elif !NITROMELON_SYSTEM_SQLITE

#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Weverything"
#endif
#include "sqlite3.c"
#if defined(__clang__)
#pragma clang diagnostic pop
#endif

#else

#include <sqlite3.h>

#endif

void nitromelon_sqlite3_set_temp_directory(char *path) {
    sqlite3_temp_directory = path;
}
