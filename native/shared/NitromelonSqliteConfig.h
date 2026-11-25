#pragma once

// Which SQLite NitromelonDB is built with, and its compile-time options.
//
// Included by NitromelonSqlite.h (for our C++ code) and by NitromelonSqlite.c (the one translation
// unit that compiles SQLite), so both sides always agree. Every option is guarded so a build can
// still override one with -D.
//
// The engine is picked at build time, by the app:
//
//   default                    iOS links the system libsqlite3 (NITROMELON_SYSTEM_SQLITE=1, set by
//                              the podspec). Android and Windows compile native/vendor/sqlite.
//   NITROMELON_ENCRYPTION=1    Every platform compiles SQLite3 Multiple Ciphers
//                              (native/vendor/sqlite3mc), which can encrypt databases.
//
// Apps opt in with `"nitromelondb": { "encryption": true }` in their package.json, or with the
// NITROMELONDB_ENCRYPTION=1 environment variable. The podspec, native/android/build.gradle and
// NitromelonDB.vcxproj read those and pass the define. Encryption is opt-in because the cipher code
// changes how an app answers App Store / export-compliance questions about encryption, and adds to
// the binary. See docs-website/docs/docs/Encryption/.

#ifndef NITROMELON_ENCRYPTION
#define NITROMELON_ENCRYPTION 0
#endif

#ifndef NITROMELON_SYSTEM_SQLITE
#define NITROMELON_SYSTEM_SQLITE 0
#endif

#if NITROMELON_ENCRYPTION && NITROMELON_SYSTEM_SQLITE
#error "NITROMELON_ENCRYPTION needs the bundled sqlite3mc, not the system SQLite"
#endif

// ---- Options shared by both bundled builds ----

// Serialized: Database.h relies on it (see the sqlite3_threadsafe() assert in Sqlite.cpp).
#ifndef SQLITE_THREADSAFE
#define SQLITE_THREADSAFE 1
#endif

// file: URIs (`?mode=memory&cache=shared`). Android and Windows also turn this on at runtime with
// sqlite3_config(SQLITE_CONFIG_URI); iOS has no such call and gets it from the system build, or
// from this define in the encryption build.
#ifndef SQLITE_USE_URI
#define SQLITE_USE_URI 1
#endif

#if NITROMELON_ENCRYPTION

// ---- Symbol isolation ----
//
// Compile every SQLite function as `static` and export only three dispatch-table pointers, named
// with this prefix. Our code calls sqlite3_* through macros in sqlite3mc_amalgamation.h that read
// from those tables.
//
// This is what lets an app also link the system libsqlite3, expo-sqlite, op-sqlite or the
// SQLCipher pod: none of them can collide with, or be silently replaced by, our copy. That
// collision ("redefinition of sqlite3_mem_methods", duplicate symbols) is the most reported
// failure in Nozbe/WatermelonDB#1635.
//
// sqlite3mc's one rule for this mode: another SQLite copy in the same process must not open the
// same database file, since the two copies do not share POSIX lock state.
#ifndef SQLITE3MC_USE_DISPATCH_TABLE
#define SQLITE3MC_USE_DISPATCH_TABLE 1
#endif
#ifndef SQLITE3MC_API_TABLE_PREFIX
#define SQLITE3MC_API_TABLE_PREFIX nitromelon_sqlite3mc
#endif

// ---- Ciphers ----
//
// Only the SQLCipher scheme is compiled in, and it is the default for new keys. All of it is
// standard, published cryptography: AES-256-CBC, HMAC-SHA512, PBKDF2-HMAC-SHA512. A database with
// no key is a plain SQLite file, byte for byte.
#ifndef CODEC_TYPE
#define CODEC_TYPE CODEC_TYPE_SQLCIPHER
#endif
// In SQLCipher 4's own file layout ("legacy" 4), so that SQLCipher itself, its tools (the sqlcipher
// shell, DB Browser for SQLite) and the libraries built on it (Room/SQLCipher for Android,
// expo-sqlite's useSQLCipher, op-sqlite's sqlcipher) read our databases, and we read theirs.
// sqlite3mc's default layout (legacy 0) keeps bytes 16-23 of page 1 unencrypted, which SQLCipher
// can't open. native/tests/SqliteEncryptionTest.cpp opens a database made by SQLCipher 4 (from
// its own test suite) to keep it that way. sqlite-node/encryption.ts sets the same on Node.
#ifndef SQLITE3MC_USE_SQLCIPHER_LEGACY
#define SQLITE3MC_USE_SQLCIPHER_LEGACY 1
#endif
#ifndef HAVE_CIPHER_SQLCIPHER
#define HAVE_CIPHER_SQLCIPHER 1
#endif
#ifndef HAVE_CIPHER_AES_128_CBC
#define HAVE_CIPHER_AES_128_CBC 0
#endif
#ifndef HAVE_CIPHER_AES_256_CBC
#define HAVE_CIPHER_AES_256_CBC 0
#endif
#ifndef HAVE_CIPHER_CHACHA20
#define HAVE_CIPHER_CHACHA20 0
#endif
#ifndef HAVE_CIPHER_RC4
#define HAVE_CIPHER_RC4 0
#endif
#ifndef HAVE_CIPHER_ASCON128
#define HAVE_CIPHER_ASCON128 0
#endif
#ifndef HAVE_CIPHER_AEGIS
#define HAVE_CIPHER_AEGIS 0
#endif

// sqlite3mc defaults to 2 (temp data in memory) because temp files are not encrypted. Keep
// SQLite's own default for now: Android deliberately spills large sorts to an app-private temp
// directory instead of the heap (DatabasePlatformAndroid.cpp). Keyed connections will set
// `pragma temp_store = memory` themselves once the passphrase API lands.
#ifndef SQLITE_TEMP_STORE
#define SQLITE_TEMP_STORE 1
#endif

// ---- Apple: match the system libsqlite3 the default build links ----
//
// The default iOS build uses Apple's SQLite. These are the options from its
// `pragma compile_options` that change behavior an app can observe, so turning encryption on does
// not slow writes down or drop SQL features someone uses through unsafeSqlQuery.
//
// Not copied: OMIT_LOAD_EXTENSION, because the dispatch tables are built from SQLite's extension
// API table, which that option removes. Extension loading is still off: it needs
// sqlite3_enable_load_extension() on the connection, which we never call.
#if defined(__APPLE__)
// WAL commits do not fsync (synchronous=NORMAL). Android sets synchronous=FULL itself
// (Database.cpp), so this only matters here.
#ifndef SQLITE_DEFAULT_WAL_SYNCHRONOUS
#define SQLITE_DEFAULT_WAL_SYNCHRONOUS 1
#endif
// F_FULLFSYNC on checkpoint, as Apple's build does.
#ifndef SQLITE_DEFAULT_CKPTFULLFSYNC
#define SQLITE_DEFAULT_CKPTFULLFSYNC 1
#endif
#ifndef SQLITE_MAX_VARIABLE_NUMBER
#define SQLITE_MAX_VARIABLE_NUMBER 500000
#endif
#ifndef SQLITE_DEFAULT_MEMSTATUS
#define SQLITE_DEFAULT_MEMSTATUS 0
#endif
#ifndef SQLITE_ENABLE_FTS3
#define SQLITE_ENABLE_FTS3 1
#endif
#ifndef SQLITE_ENABLE_FTS3_PARENTHESIS
#define SQLITE_ENABLE_FTS3_PARENTHESIS 1
#endif
#ifndef SQLITE_ENABLE_FTS4
#define SQLITE_ENABLE_FTS4 1
#endif
#ifndef SQLITE_ENABLE_FTS5
#define SQLITE_ENABLE_FTS5 1
#endif
#ifndef SQLITE_ENABLE_RTREE
#define SQLITE_ENABLE_RTREE 1
#endif
#ifndef SQLITE_ENABLE_MATH_FUNCTIONS
#define SQLITE_ENABLE_MATH_FUNCTIONS 1
#endif
#endif // __APPLE__

#endif // NITROMELON_ENCRYPTION
