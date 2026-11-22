// Checks the bundled SQLite builds themselves (native/shared/NitromelonSqlite.c, options in
// NitromelonSqliteConfig.h). `yarn test:native-unit` runs it against both:
//
// - plain (default): no encryption code at all.
// - encryption (NITROMELON_ENCRYPTION=1): sqlite3mc with only the SQLCipher scheme, a database
//   without a key is still a plain SQLite file, and the codec really encrypts.

#include "NitromelonSqlite.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>

static int failures = 0;

#define CHECK(condition)                                                                       \
    do {                                                                                       \
        if (!(condition)) {                                                                    \
            std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #condition); \
            failures += 1;                                                                     \
        }                                                                                      \
    } while (0)

static const char kPlainHeader[16] = "SQLite format 3"; // includes the trailing NUL, like the file

static std::string tempPath(const char *name) {
    const char *dir = std::getenv("TMPDIR");
    std::string path = std::string(dir && *dir ? dir : "/tmp") + "/nitromelon-engine-" + std::to_string(getpid()) + "-" + name + ".db";
    std::remove(path.c_str());
    return path;
}

static sqlite3 *open(const std::string &path, const char *key = nullptr) {
    sqlite3 *db = nullptr;
    if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr) != SQLITE_OK) {
        std::fprintf(stderr, "can't open %s\n", path.c_str());
        std::exit(1);
    }
    if (key) {
#if NITROMELON_ENCRYPTION
        CHECK(sqlite3_key_v2(db, "main", key, (int)std::strlen(key)) == SQLITE_OK);
#else
        CHECK(!"keys need the encryption build");
#endif
    }
    return db;
}

static int exec(sqlite3 *db, const char *sql) {
    return sqlite3_exec(db, sql, nullptr, nullptr, nullptr);
}

// First column of the first row as text, or "" (also on error)
static std::string scalar(sqlite3 *db, const char *sql) {
    sqlite3_stmt *statement = nullptr;
    std::string result;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) {
        const unsigned char *text = sqlite3_column_text(statement, 0);
        result = text ? reinterpret_cast<const char *>(text) : "";
    }
    sqlite3_finalize(statement);
    return result;
}

static bool hasPlainHeader(const std::string &path) {
    char header[16] = {0};
    FILE *file = std::fopen(path.c_str(), "rb");
    if (!file) {
        return false;
    }
    size_t read = std::fread(header, 1, sizeof(header), file);
    std::fclose(file);
    return read == sizeof(header) && std::memcmp(header, kPlainHeader, sizeof(header)) == 0;
}

static bool compileOption(sqlite3 *db, const std::string &option) {
    sqlite3_stmt *statement = nullptr;
    bool found = false;
    sqlite3_prepare_v2(db, "pragma compile_options", -1, &statement, nullptr);
    while (sqlite3_step(statement) == SQLITE_ROW) {
        if (option == reinterpret_cast<const char *>(sqlite3_column_text(statement, 0))) {
            found = true;
        }
    }
    sqlite3_finalize(statement);
    return found;
}

static void plainDatabaseHasNoCodec() {
    std::string path = tempPath("plain");
    sqlite3 *db = open(path);
    CHECK(exec(db, "create table t (v text); insert into t values ('hello');") == SQLITE_OK);
    CHECK(sqlite3_close(db) == SQLITE_OK);
    CHECK(hasPlainHeader(path));

    db = open(path);
    CHECK(scalar(db, "select v from t") == "hello");
    CHECK(sqlite3_close(db) == SQLITE_OK);
    std::remove(path.c_str());
}

static void sharedCompileOptions() {
    CHECK(std::strcmp(sqlite3_libversion(), SQLITE_VERSION) == 0);
    CHECK(sqlite3_threadsafe() == 1);
    sqlite3 *db = open(":memory:");
    CHECK(compileOption(db, "THREADSAFE=1"));
    CHECK(compileOption(db, "TEMP_STORE=1"));
    CHECK(compileOption(db, "USE_URI"));
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

#if NITROMELON_ENCRYPTION

static void isSqlite3mc() {
    CHECK(sqlite3mc_version() != nullptr);
    CHECK(std::strstr(sqlite3mc_version(), "Multiple Ciphers") != nullptr);
    // What the docs tell apps to run to confirm the encryption build is in
    sqlite3 *db = open(":memory:");
    CHECK(scalar(db, "select sqlite3mc_version()").find("Multiple Ciphers") != std::string::npos);
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

static void encryptionCompileOptions() {
    sqlite3 *db = open(":memory:");
    // Only the SQLCipher scheme is compiled in, and it is the default
    CHECK(scalar(db, "pragma cipher") == "sqlcipher");
    CHECK(exec(db, "pragma cipher = 'chacha20'") != SQLITE_OK || scalar(db, "pragma cipher") == "sqlcipher");
#if defined(__APPLE__)
    // Parity with the system libsqlite3 that the default iOS build links
    CHECK(compileOption(db, "DEFAULT_WAL_SYNCHRONOUS=1"));
    CHECK(compileOption(db, "MAX_VARIABLE_NUMBER=500000"));
    CHECK(exec(db, "create virtual table f5 using fts5(body)") == SQLITE_OK);
    CHECK(exec(db, "create virtual table f4 using fts4(body)") == SQLITE_OK);
    CHECK(exec(db, "create virtual table rt using rtree(id, minX, maxX)") == SQLITE_OK);
    CHECK(scalar(db, "select cast(sqrt(16) as int)") == "4");
#endif
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

static void keyedDatabaseIsEncrypted() {
    std::string path = tempPath("keyed");
    sqlite3 *db = open(path, "correct horse");
    CHECK(exec(db, "create table t (v text); insert into t values ('secret');") == SQLITE_OK);
    // SQLCipher v4 defaults
    CHECK(scalar(db, "pragma kdf_iter") == "256000");
    CHECK(sqlite3_close(db) == SQLITE_OK);
    CHECK(!hasPlainHeader(path));

    // no key, wrong key: not a database. Never a fresh empty one.
    db = open(path);
    CHECK(exec(db, "select count(*) from sqlite_master") == SQLITE_NOTADB);
    CHECK(sqlite3_close(db) == SQLITE_OK);
    db = open(path, "wrong horse");
    CHECK(exec(db, "select count(*) from sqlite_master") == SQLITE_NOTADB);
    CHECK(sqlite3_close(db) == SQLITE_OK);

    db = open(path, "correct horse");
    CHECK(scalar(db, "select v from t") == "secret");
    CHECK(sqlite3_close(db) == SQLITE_OK);
    std::remove(path.c_str());
}

// What unsafe_EncryptDB / unsafe_DecryptDB will build on: sqlite3mc rekeys in place, in every
// direction, without a second file.
static void rekeysInPlace() {
    std::string path = tempPath("rekey");
    sqlite3 *db = open(path);
    CHECK(exec(db, "create table t (v text); insert into t values ('kept');") == SQLITE_OK);
    CHECK(hasPlainHeader(path));

    // encrypt (from plaintext, outside WAL, which is a sqlite3mc requirement)
    CHECK(sqlite3_rekey_v2(db, "main", "k1", 2) == SQLITE_OK);
    CHECK(sqlite3_close(db) == SQLITE_OK);
    CHECK(!hasPlainHeader(path));

    // change the key
    db = open(path, "k1");
    CHECK(scalar(db, "select v from t") == "kept");
    CHECK(sqlite3_rekey_v2(db, "main", "k2", 2) == SQLITE_OK);
    CHECK(sqlite3_close(db) == SQLITE_OK);
    db = open(path, "k1");
    CHECK(exec(db, "select count(*) from sqlite_master") == SQLITE_NOTADB);
    CHECK(sqlite3_close(db) == SQLITE_OK);

    // decrypt
    db = open(path, "k2");
    CHECK(scalar(db, "select v from t") == "kept");
    CHECK(sqlite3_rekey_v2(db, "main", nullptr, 0) == SQLITE_OK);
    CHECK(sqlite3_close(db) == SQLITE_OK);
    CHECK(hasPlainHeader(path));
    db = open(path);
    CHECK(scalar(db, "select v from t") == "kept");
    CHECK(sqlite3_close(db) == SQLITE_OK);
    std::remove(path.c_str());
}

#else // plain build

// The default build must not contain any encryption: that is the point of making it opt-in.
static void hasNoEncryption() {
    sqlite3 *db = open(":memory:");
    CHECK(scalar(db, "pragma cipher").empty()); // unknown pragmas return nothing
    CHECK(exec(db, "select sqlite3mc_version()") == SQLITE_ERROR); // no such function
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

#endif

int main() {
    // Same call DatabasePlatformAndroid/Windows make. Must link: in the encryption build the
    // global is not in the dispatch tables. nullptr is SQLite's default.
    nitromelon_sqlite3_set_temp_directory(nullptr);

    sharedCompileOptions();
    plainDatabaseHasNoCodec();
#if NITROMELON_ENCRYPTION
    isSqlite3mc();
    encryptionCompileOptions();
    keyedDatabaseIsEncrypted();
    rekeysInPlace();
    const char *build = sqlite3mc_version();
#else
    hasNoEncryption();
    const char *build = "plain SQLite, no encryption";
#endif
    if (failures) {
        std::fprintf(stderr, "SqliteEngine: %d check(s) failed\n", failures);
        return 1;
    }
    std::printf("SqliteEngine: all checks passed (%s, SQLite %s)\n", build, sqlite3_libversion());
    return 0;
}
