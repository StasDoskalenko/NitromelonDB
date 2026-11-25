// Tests native/shared/SqliteEncryption.cpp, the open and re-key paths behind SQLiteAdapter's
// `encryption` option. `yarn test:native-unit` runs it against both builds:
//
// - plain (default): a passphrase must fail loudly (encryption_unavailable), never open a plaintext
//   database as if it were encrypted.
// - encryption: wrong/missing keys are errors that leave the file alone, re-keying works in every
//   direction from WAL mode, and a re-key cut off at any point (killed at random times, and crashed
//   exactly at its commit) leaves a database that opens, complete, with the old or the new key.

#include "SqliteEncryption.h"

#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

using namespace watermelondb::encryption;

static int failures = 0;

#define CHECK(condition)                                                                       \
    do {                                                                                       \
        if (!(condition)) {                                                                    \
            std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #condition); \
            failures += 1;                                                                     \
        }                                                                                      \
    } while (0)

static void removeDatabase(const std::string &path) {
    for (const char *suffix : {"", "-wal", "-shm", "-journal"}) {
        std::remove((path + suffix).c_str());
    }
    for (const char *suffix : {"", "-journal"}) {
        std::remove((path + "-nitromelon-decrypted" + suffix).c_str());
    }
}

static std::string tempPath(const char *name) {
    const char *dir = std::getenv("TMPDIR");
    std::string path = std::string(dir && *dir ? dir : "/tmp") + "/nitromelon-encryption-" + std::to_string(getpid()) + "-" + name + ".db";
    removeDatabase(path);
    return path;
}

[[maybe_unused]] static bool fileExists(const std::string &path) {
    struct stat st;
    return stat(path.c_str(), &st) == 0;
}

static sqlite3 *rawOpen(const std::string &path) {
    sqlite3 *db = nullptr;
    if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI, nullptr) != SQLITE_OK) {
        std::fprintf(stderr, "can't open %s\n", path.c_str());
        std::exit(1);
    }
    return db;
}

// What SqliteDb does: recover, probe, open, key. Returns the error code, or "" if it opened
static std::string tryOpen(const std::string &path, const std::string &key, bool allowUnencrypted, sqlite3 **out,
                           bool *encrypted = nullptr) {
    recoverInterruptedRekey(path, key);
    FileState state = probeFile(path);
    sqlite3 *db = rawOpen(path);
    try {
        bool isEncrypted = openWithKey(db, state, key, allowUnencrypted);
        if (encrypted) {
            *encrypted = isEncrypted;
        }
        *out = db;
        return "";
    } catch (const EncryptionError &error) {
        CHECK(std::string(error.what()).rfind("[" + error.code + "] ", 0) == 0);
        sqlite3_close(db);
        *out = nullptr;
        return error.code;
    }
}

// encryption::rekey, returning whether it reopened the connection
static bool rekey(sqlite3 *&db, const std::string &path, const std::string &current, const std::string &next) {
    bool reopened = false;
    watermelondb::encryption::rekey(db, path, current, next, reopened);
    return reopened;
}

static int exec(sqlite3 *db, const char *sql) {
    return sqlite3_exec(db, sql, nullptr, nullptr, nullptr);
}

[[maybe_unused]] static std::string scalar(sqlite3 *db, const char *sql) {
    sqlite3_stmt *statement = nullptr;
    std::string result;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) {
        const unsigned char *text = sqlite3_column_text(statement, 0);
        result = text ? reinterpret_cast<const char *>(text) : "";
    }
    sqlite3_finalize(statement);
    return result;
}

static void writeFile(const std::string &path, const char *bytes, size_t size) {
    FILE *file = std::fopen(path.c_str(), "wb");
    std::fwrite(bytes, 1, size, file);
    std::fclose(file);
}

static void probes() {
    std::string path = tempPath("probe");
    CHECK(probeFile(path) == FileState::Missing);
    CHECK(probeFile(":memory:") == FileState::Missing);
    CHECK(probeFile("") == FileState::Missing);
    CHECK(probeFile("file:testdb1?mode=memory&cache=shared") == FileState::Missing);
    CHECK(!hasHotJournal(path));
    CHECK(!hasHotJournal(":memory:"));

    writeFile(path, "", 0);
    CHECK(probeFile(path) == FileState::Missing); // SQLite creates it empty

    writeFile(path, "garbage that is not sqlite", 26);
    CHECK(probeFile(path) == FileState::Encrypted); // can't tell from a damaged file
    writeFile(path, "SQLite", 6);
    CHECK(probeFile(path) == FileState::Encrypted); // truncated header

    removeDatabase(path);
    sqlite3 *db = rawOpen(path);
    CHECK(exec(db, "create table t (v)") == SQLITE_OK);
    sqlite3_close(db);
    CHECK(probeFile(path) == FileState::Unencrypted);
    CHECK(probeFile("file:" + path) == FileState::Unencrypted);
    CHECK(probeFile("file://" + path + "?cache=shared") == FileState::Unencrypted);
    CHECK(probeFile("file://localhost" + path) == FileState::Unencrypted);
    CHECK(std::strcmp(fileStateName(FileState::Encrypted), "encrypted") == 0);
    CHECK(decryptedCopyPath("file:" + path + "?cache=shared") == path + "-nitromelon-decrypted");

    // A journal counts only with a transaction in it
    writeFile(path + "-journal", "\0\0\0\0\0\0\0\0\0\0", 10);
    CHECK(!hasHotJournal(path));
    writeFile(path + "-journal", "\xd9\xd5\x05\xf9\x20\xa1\x63\xd7", 8);
    CHECK(hasHotJournal(path));
    removeDatabase(path);
}

#if NITROMELON_ENCRYPTION

static void opensNewEncryptedDatabase() {
    std::string path = tempPath("new");
    sqlite3 *db = nullptr;
    bool encrypted = false;
    CHECK(tryOpen(path, "correct horse", false, &db, &encrypted) == "");
    CHECK(encrypted);
    CHECK(scalar(db, "pragma temp_store") == "2"); // memory
    CHECK(exec(db, "pragma journal_mode = wal; create table t (v); insert into t values ('secret');") == SQLITE_OK);
    sqlite3_close(db);
    CHECK(probeFile(path) == FileState::Encrypted);

    CHECK(tryOpen(path, "correct horse", false, &db, &encrypted) == "");
    CHECK(encrypted);
    CHECK(scalar(db, "select v from t") == "secret");
    sqlite3_close(db);

    // Errors never touch the file
    CHECK(tryOpen(path, "wrong horse", false, &db) == "encryption_key_invalid");
    CHECK(tryOpen(path, "wrong horse", true, &db) == "encryption_key_invalid");
    CHECK(tryOpen(path, "", false, &db) == "encryption_key_required");
    CHECK(tryOpen(path, "", true, &db) == "encryption_key_required");
    CHECK(tryOpen(path, "correct horse", false, &db) == "");
    CHECK(scalar(db, "select v from t") == "secret");
    sqlite3_close(db);
    removeDatabase(path);
}

static void inMemoryDatabasesCantBeEncrypted() {
    for (const char *name : {":memory:", "file:nitromelon-encryption-test?mode=memory&cache=shared"}) {
        sqlite3 *db = nullptr;
        CHECK(tryOpen(name, "key", false, &db) == "encryption_unavailable");
        CHECK(tryOpen(name, "", false, &db) == ""); // without a key, as always
        bool threw = false;
        try {
            rekey(db, name, "", "key");
        } catch (const EncryptionError &error) {
            threw = error.code == "encryption_unavailable";
        }
        CHECK(threw);
        sqlite3_close(db);
    }
}

static void plaintextDatabaseNeedsOptIn() {
    std::string path = tempPath("plaintext");
    sqlite3 *db = rawOpen(path);
    CHECK(exec(db, "pragma journal_mode = wal; create table t (v); insert into t values ('kept');") == SQLITE_OK);
    sqlite3_close(db);

    CHECK(tryOpen(path, "key", false, &db) == "database_not_encrypted");
    CHECK(probeFile(path) == FileState::Unencrypted);

    bool encrypted = true;
    CHECK(tryOpen(path, "key", true, &db, &encrypted) == "");
    CHECK(!encrypted);
    CHECK(scalar(db, "select v from t") == "kept");
    sqlite3_close(db);

    // Without a passphrase it's just a database
    CHECK(tryOpen(path, "", false, &db, &encrypted) == "");
    CHECK(!encrypted);
    sqlite3_close(db);
    removeDatabase(path);
}

// What unsafe_EncryptDB / unsafe_DecryptDB do, on a connection set up like Database's (WAL)
static void rekeysFromWal() {
    std::string path = tempPath("rekey");
    sqlite3 *db = rawOpen(path);
    CHECK(exec(db, "pragma journal_mode = wal; pragma user_version = 7; create table t (v); insert into t values ('kept');") == SQLITE_OK);

    // encrypt
    CHECK(!rekey(db, path, "", "k1"));
    CHECK(scalar(db, "pragma journal_mode") == "wal");
    CHECK(scalar(db, "pragma temp_store") == "2");
    CHECK(scalar(db, "select v from t") == "kept");
    CHECK(exec(db, "insert into t values ('after')") == SQLITE_OK);
    sqlite3_close(db);
    CHECK(probeFile(path) == FileState::Encrypted);

    // change the key
    CHECK(tryOpen(path, "k1", false, &db) == "");
    CHECK(!rekey(db, path, "k1", "k2"));
    CHECK(scalar(db, "pragma journal_mode") == "wal");
    sqlite3_close(db);
    CHECK(tryOpen(path, "k1", false, &db) == "encryption_key_invalid");

    // not inside a transaction
    CHECK(tryOpen(path, "k2", false, &db) == "");
    CHECK(exec(db, "begin") == SQLITE_OK);
    bool threw = false;
    try {
        rekey(db, path, "k2", "k3");
    } catch (const EncryptionError &error) {
        threw = error.code == "rekey_failed";
    }
    CHECK(threw);
    CHECK(exec(db, "rollback") == SQLITE_OK);

    // decrypt: by copy, so the connection is a new one, in the default journal mode
    CHECK(rekey(db, path, "k2", ""));
    CHECK(db != nullptr);
    CHECK(scalar(db, "select count(*) from t") == "2");
    CHECK(scalar(db, "pragma user_version") == "7");
    CHECK(scalar(db, "pragma integrity_check") == "ok");
    CHECK(exec(db, "pragma journal_mode = wal; insert into t values ('plain again')") == SQLITE_OK);
    sqlite3_close(db);
    CHECK(probeFile(path) == FileState::Unencrypted);
    CHECK(!fileExists(decryptedCopyPath(path)));
    CHECK(tryOpen(path, "", false, &db) == "");
    CHECK(scalar(db, "select count(*) from t") == "3");
    // decrypting a plain database does nothing
    CHECK(!rekey(db, path, "", ""));
    sqlite3_close(db);
    removeDatabase(path);
}

// What Database::unsafeResetDatabase does (apps call it on logout): reset in place on the open,
// keyed connection, then recreate the schema. The file must stay encrypted with the same key: a
// reset that came back as plain SQLite while the app still thinks it's encrypted would be silent
// non-encryption. From WAL (how Database runs) and from the default rollback journal.
static void resetKeepsEncryption() {
    for (const char *journalMode : {"wal", "delete"}) {
        std::string path = tempPath((std::string("reset-") + journalMode).c_str());
        sqlite3 *db = nullptr;
        CHECK(tryOpen(path, "k1", false, &db) == "");
        CHECK(exec(db, (std::string("pragma journal_mode = ") + journalMode).c_str()) == SQLITE_OK);
        CHECK(exec(db, "pragma user_version = 3; create table t (v); insert into t values ('before reset');") == SQLITE_OK);
        CHECK(exec(db, "create table old_only (v); insert into old_only values ('gone');") == SQLITE_OK);

        CHECK(sqlite3_db_config(db, SQLITE_DBCONFIG_RESET_DATABASE, 1, 0) == SQLITE_OK);
        CHECK(exec(db, "vacuum") == SQLITE_OK);
        CHECK(sqlite3_db_config(db, SQLITE_DBCONFIG_RESET_DATABASE, 0, 0) == SQLITE_OK);
        CHECK(exec(db, "begin; create table t (v); insert into t values ('after reset'); pragma user_version = 4; commit;") == SQLITE_OK);

        // Same connection, as the app goes on using it
        CHECK(scalar(db, "select count(*) from sqlite_master where name = 'old_only'") == "0");
        CHECK(scalar(db, "select group_concat(v) from t") == "after reset");
        CHECK(scalar(db, "pragma journal_mode") == journalMode);
        CHECK(exec(db, "insert into t values ('later')") == SQLITE_OK);
        sqlite3_close(db);

        CHECK(probeFile(path) == FileState::Encrypted);
        CHECK(tryOpen(path, "", false, &db) == "encryption_key_required");
        CHECK(tryOpen(path, "", true, &db) == "encryption_key_required");
        CHECK(tryOpen(path, "k2", false, &db) == "encryption_key_invalid");
        bool encrypted = false;
        CHECK(tryOpen(path, "k1", false, &db, &encrypted) == "");
        CHECK(encrypted);
        CHECK(scalar(db, "select group_concat(v) from t") == "after reset,later");
        CHECK(scalar(db, "pragma user_version") == "4");
        CHECK(scalar(db, "pragma integrity_check") == "ok");
        sqlite3_close(db);
        removeDatabase(path);
    }
}

// Enough rows that a re-key takes a while, so a kill can land in the middle of it
static void fillDatabase(const std::string &path, const std::string &key, int rows) {
    sqlite3 *db = nullptr;
    removeDatabase(path);
    CHECK(tryOpen(path, key, false, &db) == "");
    exec(db, "pragma journal_mode = wal; create table t (id integer primary key, v text);");
    exec(db, "begin");
    sqlite3_stmt *insert = nullptr;
    sqlite3_prepare_v2(db, "insert into t (v) values (?)", -1, &insert, nullptr);
    std::string value(200, 'x');
    for (int i = 0; i < rows; i++) {
        sqlite3_bind_text(insert, 1, value.c_str(), (int)value.size(), SQLITE_STATIC);
        sqlite3_step(insert);
        sqlite3_reset(insert);
    }
    sqlite3_finalize(insert);
    exec(db, "commit");
    sqlite3_close(db);
}

struct Direction {
    const char *name;
    std::string from, to;
};

static const Direction kDirections[] = {{"encrypt", "", "k1"}, {"change key", "k1", "k2"}, {"decrypt", "k1", ""}};

// Another connection to the same file (an app extension, a widget, a second adapter): encrypting,
// changing the key and decrypting all leave WAL first, which SQLite refuses while another
// connection has the database open. So each fails with rekey_failed and changes nothing, instead
// of leaving the other connection reading a file whose key changed under it (or, for decrypt, an
// unlinked file). Once the other connection is closed, it works.
static void rekeyRefusedWhileAnotherConnectionIsOpen() {
    for (const Direction &direction : kDirections) {
        std::string path = tempPath("other-connection");
        sqlite3 *db = nullptr, *other = nullptr;
        CHECK(tryOpen(path, direction.from, false, &db) == "");
        CHECK(exec(db, "pragma journal_mode = wal; create table t (v); insert into t values ('kept');") == SQLITE_OK);
        CHECK(tryOpen(path, direction.from, false, &other) == "");
        CHECK(scalar(other, "select v from t") == "kept");

        bool threw = false;
        try {
            rekey(db, path, direction.from, direction.to);
        } catch (const EncryptionError &error) {
            threw = error.code == "rekey_failed";
        }
        CHECK(threw);
        // Both connections go on as before, on the same file with the same key
        CHECK(db != nullptr);
        CHECK(scalar(db, "pragma journal_mode") == "wal");
        CHECK(exec(db, "insert into t values ('after')") == SQLITE_OK);
        CHECK(scalar(other, "select count(*) from t") == "2");
        CHECK(probeFile(path) == (direction.from.empty() ? FileState::Unencrypted : FileState::Encrypted));
        CHECK(!fileExists(decryptedCopyPath(path)));

        sqlite3_close(other);
        rekey(db, path, direction.from, direction.to);
        CHECK(scalar(db, "select count(*) from t") == "2");
        sqlite3_close(db);
        CHECK(tryOpen(path, direction.to, false, &db) == "");
        CHECK(scalar(db, "select count(*) from t") == "2");
        sqlite3_close(db);
        removeDatabase(path);
    }
}

// Opens the database like an app would after the re-key was cut off: with a passphrase it has
// (either one, for a key change), and ifUnencrypted: 'open'. Checks every row is there. Returns
// "old" or "new" for the key it ended up with, or "" (and reports) if it doesn't open complete.
static std::string openAfterInterruption(const std::string &path, const Direction &direction, int rows,
                                         const std::string &when) {
    std::vector<std::string> keys;
    for (const std::string &key : {direction.from, direction.to}) {
        if (!key.empty()) {
            keys.push_back(key);
        }
    }
    for (const std::string &key : keys) {
        sqlite3 *db = nullptr;
        bool encrypted = false;
        std::string error = tryOpen(path, key, true, &db, &encrypted);
        if (!error.empty()) {
            continue;
        }
        std::string count = scalar(db, "select count(*) from t");
        std::string integrity = scalar(db, "pragma integrity_check");
        sqlite3_close(db);
        std::string resultingKey = encrypted ? key : "";
        if (count != std::to_string(rows) || integrity != "ok") {
            std::fprintf(stderr, "  %s: opened with \"%s\" but count=%s integrity=%s\n", when.c_str(), key.c_str(),
                         count.c_str(), integrity.c_str());
            return "";
        }
        return resultingKey == direction.from ? "old" : "new";
    }
    std::fprintf(stderr, "  %s: opens with no key the app has\n", when.c_str());
    return "";
}

static double timeRekey(const std::string &path, const Direction &direction) {
    sqlite3 *db = nullptr;
    CHECK(tryOpen(path, direction.from, true, &db) == "");
    auto start = std::chrono::steady_clock::now();
    rekey(db, path, direction.from, direction.to);
    double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    sqlite3_close(db);
    return ms;
}

// Kills a child process `delayMs` after it starts a re-key
static void killDuringRekey(const std::string &path, const Direction &direction, double delayMs) {
    std::fflush(nullptr);
    // Opening derives the key (PBKDF2), so the delay counts from when the child signals that the
    // re-key itself starts, not from the fork
    int started[2];
    if (pipe(started) != 0) {
        std::perror("pipe");
        std::exit(1);
    }
    pid_t child = fork();
    if (child == 0) {
        close(started[0]);
        sqlite3 *db = nullptr;
        if (tryOpen(path, direction.from, true, &db) != "") {
            _exit(2);
        }
        char byte = 1;
        if (write(started[1], &byte, 1) != 1) {
            _exit(3);
        }
        rekey(db, path, direction.from, direction.to);
        // Finished before the kill: wait for it, like an app that's still running
        pause();
        _exit(0);
    }
    close(started[1]);
    char byte = 0;
    CHECK(read(started[0], &byte, 1) == 1);
    close(started[0]);
    std::this_thread::sleep_for(std::chrono::microseconds((long)(delayMs * 1000)));
    kill(child, SIGKILL);
    int status = 0;
    waitpid(child, &status, 0);
}

static void survivesKillDuringRekey() {
    const int rows = 40000; // ~10 MB
    std::string path = tempPath("kill");
    for (const Direction &direction : kDirections) {
        fillDatabase(path, direction.from, rows);
        double duration = timeRekey(path, direction);
        int oldKey = 0, newKey = 0;
        for (double fraction : {0.0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0, 1.2}) {
            fillDatabase(path, direction.from, rows);
            killDuringRekey(path, direction, duration * fraction);
            std::string when = std::string(direction.name) + " killed at " + std::to_string((int)(duration * fraction)) + " ms";
            std::string opened = openAfterInterruption(path, direction, rows, when);
            CHECK(!opened.empty());
            if (opened == "old") {
                oldKey += 1;
            } else if (opened == "new") {
                newKey += 1;
            }
        }
        std::printf("  killed during %s (%.0f ms): %d times it opened with the old key, %d with the new one\n",
                    direction.name, duration, oldKey, newKey);
    }
    removeDatabase(path);
}

// Crashes exactly at a point SQLite reaches once per re-key, by replacing a system call of the unix
// VFS in the child (sqlite3mc's VFS sits on top of it): random kill times rarely land there.
static std::string gCrashPath;
static ino_t gCrashInode = 0;
static sqlite3_syscall_ptr gRealUnlink = nullptr, gRealPwrite = nullptr;

// The commit point of a rollback journal: every page is written, the journal is about to go
static int crashAtJournalDelete(const char *path) {
    // By name: SQLite normalizes the directory part (e.g. a doubled slash from TMPDIR)
    std::string name = gCrashPath.substr(gCrashPath.rfind('/') + 1) + "-journal";
    std::string deleted = path;
    if (deleted.size() >= name.size() && deleted.compare(deleted.size() - name.size(), name.size(), name) == 0) {
        _exit(9);
    }
    return ((int (*)(const char *))gRealUnlink)(path);
}

// Page 1 of the main file was just written: its header is in the new format already
static ssize_t crashAfterPage1Write(int fd, const void *buffer, size_t size, off_t offset) {
    ssize_t written = ((ssize_t(*)(int, const void *, size_t, off_t))gRealPwrite)(fd, buffer, size, offset);
    struct stat st;
    if (offset == 0 && fstat(fd, &st) == 0 && st.st_ino == gCrashInode) {
        _exit(9);
    }
    return written;
}

static void crashesAtCommit() {
    const int rows = 5000;
    std::string path = tempPath("commit");
    const char *points[] = {"its journal is deleted", "page 1 is written"};
    for (int point = 0; point < 2; point++) {
        for (const Direction &direction : kDirections) {
            fillDatabase(path, direction.from, rows);
            gCrashPath = path;
            std::fflush(nullptr);
            pid_t child = fork();
            if (child == 0) {
                sqlite3 *db = nullptr;
                if (tryOpen(path, direction.from, true, &db) != "") {
                    _exit(2);
                }
                struct stat st;
                stat(path.c_str(), &st);
                gCrashInode = st.st_ino;
                sqlite3_vfs *unixVfs = sqlite3_vfs_find("unix");
                gRealUnlink = unixVfs->xGetSystemCall(unixVfs, "unlink");
                gRealPwrite = unixVfs->xGetSystemCall(unixVfs, "pwrite");
                if (point == 0) {
                    unixVfs->xSetSystemCall(unixVfs, "unlink", (sqlite3_syscall_ptr)crashAtJournalDelete);
                } else {
                    unixVfs->xSetSystemCall(unixVfs, "pwrite", (sqlite3_syscall_ptr)crashAfterPage1Write);
                }
                rekey(db, path, direction.from, direction.to);
                _exit(0);
            }
            int status = 0;
            waitpid(child, &status, 0);
            bool crashed = WIFEXITED(status) && WEXITSTATUS(status) == 9;
            std::string when = std::string(direction.name) + ", crashed when " + points[point];
            // In place, both points are reached. Decrypting by copy never commits through the
            // original's journal (it writes page 1 only while leaving WAL, before the copy)
            if (!direction.to.empty()) {
                CHECK(crashed);
            }
            std::string opened = openAfterInterruption(path, direction, rows, when);
            CHECK(!opened.empty());
            if (crashed) {
                std::printf("  %s: opened with the %s key\n", when.c_str(), opened.c_str());
            }
        }
    }

    // A decrypt killed before replacing the database leaves a copy: deleted on the next open, and
    // the database still opens encrypted
    fillDatabase(path, "k1", rows);
    writeFile(decryptedCopyPath(path), "half a copy", 11);
    sqlite3 *db = nullptr;
    bool encrypted = false;
    CHECK(tryOpen(path, "k1", true, &db, &encrypted) == "");
    CHECK(encrypted);
    CHECK(scalar(db, "select count(*) from t") == std::to_string(rows));
    sqlite3_close(db);
    CHECK(!fileExists(decryptedCopyPath(path)));
    removeDatabase(path);
}

#else // plain build

// The upstream PR's bug: a passphrase on a build without the codec silently gave a plaintext file
static void passphraseFailsLoudly() {
    std::string path = tempPath("unavailable");
    sqlite3 *db = nullptr;
    CHECK(tryOpen(path, "key", false, &db) == "encryption_unavailable");
    CHECK(tryOpen(path, "key", true, &db) == "encryption_unavailable");
    CHECK(probeFile(path) == FileState::Missing);

    try {
        openWithKey(nullptr, FileState::Missing, "key", false);
    } catch (const EncryptionError &error) {
        CHECK(std::string(error.what()).find("\"encryption\": true") != std::string::npos);
    }

    // An encrypted file without a key: a clear error instead of "file is not a database" later
    writeFile(path, "0123456789abcdef0123456789abcdef", 32);
    CHECK(tryOpen(path, "", false, &db) == "encryption_key_required");

    db = rawOpen(":memory:");
    bool threw = false;
    try {
        rekey(db, ":memory:", "", "key");
    } catch (const EncryptionError &error) {
        threw = error.code == "encryption_unavailable";
    }
    CHECK(threw);
    sqlite3_close(db);
    removeDatabase(path);
}

#endif

int main() {
    std::printf("SqliteEncryption (%s build)\n", isAvailable() ? "encryption" : "plain");
    probes();
#if NITROMELON_ENCRYPTION
    CHECK(isAvailable());
    opensNewEncryptedDatabase();
    inMemoryDatabasesCantBeEncrypted();
    plaintextDatabaseNeedsOptIn();
    rekeysFromWal();
    resetKeepsEncryption();
    rekeyRefusedWhileAnotherConnectionIsOpen();
    crashesAtCommit();
    survivesKillDuringRekey();
#else
    CHECK(!isAvailable());
    passphraseFailsLoudly();
#endif
    if (failures) {
        std::fprintf(stderr, "SqliteEncryption: %d check(s) failed\n", failures);
        return 1;
    }
    std::printf("SqliteEncryption: all checks passed\n");
    return 0;
}
