// What encryption costs: the same workload on the plain build, on the encryption build without a key
// (an app that turned the switch on but hasn't encrypted yet), and with a key. `yarn
// benchmark:encryption` builds and runs it (scripts/benchmark-encryption); the results are in
// docs/Encryption/HowItWorks ("What it costs").
//
// The connection is set up like the app's on iOS (native/shared/Database.cpp: WAL, synchronous
// NORMAL) and opened through native/shared/SqliteEncryption.cpp like SqliteDb does. The table is shaped like a NitromelonDB table, and holds more than SQLite's page
// cache (2 MB by default), so reads go to the file and pay for decryption, as they do on a device.

#include "SqliteEncryption.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <unistd.h>
#include <vector>

using namespace watermelondb::encryption;
using Clock = std::chrono::steady_clock;

namespace {

const int kRows = 20000;
const int kRuns = 5;

std::string tempPath(const char *name) {
    const char *dir = std::getenv("TMPDIR");
    return std::string(dir && *dir ? dir : "/tmp") + "/nitromelon-benchmark-" + std::to_string(getpid()) + "-" + name +
           ".db";
}

void removeDatabase(const std::string &path) {
    for (const char *suffix : {"", "-wal", "-shm", "-journal", "-nitromelon-decrypted", "-nitromelon-salt"}) {
        std::remove((path + suffix).c_str());
    }
}

void check(bool condition, const char *what) {
    if (!condition) {
        std::fprintf(stderr, "benchmark failed: %s\n", what);
        std::exit(1);
    }
}

void exec(sqlite3 *db, const char *sql) {
    char *error = nullptr;
    if (sqlite3_exec(db, sql, nullptr, nullptr, &error) != SQLITE_OK) {
        std::fprintf(stderr, "%s: %s\n", sql, error ? error : "?");
        std::exit(1);
    }
}

sqlite3 *open(const std::string &path, const std::string &key) {
    recoverInterruptedRekey(path, key);
    FileState state = probeFile(path);
    sqlite3 *db = nullptr;
    check(sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr) == SQLITE_OK, "open");
    openWithKey(db, state, key, true);
    // synchronous = NORMAL on every build, as on iOS (Apple's SQLite, and the encryption build, which
    // copies its options). Built here, the plain build would default to FULL and fsync every commit.
    // Android sets FULL itself in both builds (Database.cpp): writes wait for the disk there, so the
    // cipher's share of their time is smaller than below
    exec(db, "pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = 5000;");
#if defined(__APPLE__)
    // And F_FULLFSYNC at checkpoints, which Apple's SQLite and the encryption build do (and the plain
    // build, built here, doesn't)
    exec(db, "pragma checkpoint_fullfsync = 1;");
#endif
    return db;
}

double ms(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

double median(std::vector<double> values) {
    std::sort(values.begin(), values.end());
    return values[values.size() / 2];
}

std::string randomText(int length, unsigned &seed) {
    static const char letters[] = "abcdefghijklmnopqrstuvwxyz     ";
    std::string text;
    for (int i = 0; i < length; i++) {
        seed = seed * 1103515245 + 12345;
        text += letters[(seed >> 16) % (sizeof(letters) - 1)];
    }
    return text;
}

void createTable(sqlite3 *db) {
    exec(db, "create table notes (id text primary key, _changed text, _status text, title text, body text, "
             "created_at real, updated_at real); create index notes_created_at on notes (created_at);");
}

void insertRows(sqlite3 *db, int rows) {
    unsigned seed = 42;
    sqlite3_stmt *insert = nullptr;
    sqlite3_prepare_v2(db, "insert into notes values (?, '', 'created', ?, ?, ?, ?)", -1, &insert, nullptr);
    exec(db, "begin");
    for (int i = 0; i < rows; i++) {
        std::string id = "id" + std::to_string(i);
        std::string title = randomText(40, seed);
        std::string body = randomText(500, seed);
        sqlite3_bind_text(insert, 1, id.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 2, title.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert, 3, body.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_double(insert, 4, 1.7e12 + i);
        sqlite3_bind_double(insert, 5, 1.7e12 + i);
        check(sqlite3_step(insert) == SQLITE_DONE, "insert");
        sqlite3_reset(insert);
    }
    exec(db, "commit");
    sqlite3_finalize(insert);
}

// Steps through every row of `sql`, `times` times, binding `bind(i)`
void query(sqlite3 *db, const char *sql, int times, const std::function<void(sqlite3_stmt *, int)> &bind) {
    sqlite3_stmt *statement = nullptr;
    check(sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK, sql);
    for (int i = 0; i < times; i++) {
        bind(statement, i);
        while (sqlite3_step(statement) == SQLITE_ROW) {
        }
        sqlite3_reset(statement);
    }
    sqlite3_finalize(statement);
}

struct Result {
    const char *name;
    double value;
};

std::vector<Result> runWorkload(const std::string &key) {
    std::string path = tempPath("workload");
    std::vector<double> openTimes, insertTimes, lookupTimes, rangeTimes, scanTimes, updateTimes;
    for (int run = 0; run < kRuns; run++) {
        removeDatabase(path);
        sqlite3 *db = open(path, key);
        createTable(db);
        auto start = Clock::now();
        insertRows(db, kRows);
        insertTimes.push_back(ms(start));
        exec(db, "pragma wal_checkpoint(truncate)");
        sqlite3_close(db);

        // Opening derives the key (PBKDF2-HMAC-SHA512, 256,000 iterations) on the first read
        start = Clock::now();
        db = open(path, key);
        exec(db, "select count(*) from sqlite_master");
        openTimes.push_back(ms(start));

        start = Clock::now();
        query(db, "select * from notes where id = ?", 2000, [](sqlite3_stmt *s, int i) {
            std::string id = "id" + std::to_string((i * 7919) % kRows);
            sqlite3_bind_text(s, 1, id.c_str(), -1, SQLITE_TRANSIENT);
        });
        lookupTimes.push_back(ms(start));

        start = Clock::now();
        query(db, "select * from notes where created_at > ? order by created_at limit 50", 500,
              [](sqlite3_stmt *s, int i) { sqlite3_bind_double(s, 1, 1.7e12 + (i * 37) % kRows); });
        rangeTimes.push_back(ms(start));

        start = Clock::now();
        query(db, "select count(*) from notes where body like '%zebra%'", 10, [](sqlite3_stmt *, int) {});
        scanTimes.push_back(ms(start));

        sqlite3_stmt *update = nullptr;
        sqlite3_prepare_v2(db, "update notes set title = ?, _status = 'updated' where id = ?", -1, &update, nullptr);
        start = Clock::now();
        for (int i = 0; i < 1000; i++) {
            std::string id = "id" + std::to_string((i * 104729) % kRows);
            sqlite3_bind_text(update, 1, "changed", -1, SQLITE_STATIC);
            sqlite3_bind_text(update, 2, id.c_str(), -1, SQLITE_TRANSIENT);
            check(sqlite3_step(update) == SQLITE_DONE, "update");
            sqlite3_reset(update);
        }
        updateTimes.push_back(ms(start));
        sqlite3_finalize(update);
        sqlite3_close(db);
    }
    // A database that fits in the page cache (2,000 rows, about 1.3 MB): after the first read, pages
    // are kept decrypted in memory, like the indexes and recent records a screen queries again
    std::vector<double> cachedTimes;
    for (int run = 0; run < kRuns; run++) {
        removeDatabase(path);
        sqlite3 *db = open(path, key);
        createTable(db);
        insertRows(db, 2000);
        auto lookups = [&]() {
            query(db, "select * from notes where id = ?", 2000, [](sqlite3_stmt *s, int i) {
                std::string id = "id" + std::to_string((i * 7919) % 2000);
                sqlite3_bind_text(s, 1, id.c_str(), -1, SQLITE_TRANSIENT);
            });
        };
        lookups(); // warm
        auto start = Clock::now();
        lookups();
        cachedTimes.push_back(ms(start));
        sqlite3_close(db);
    }
    removeDatabase(path);
    return {
        {"Open (first read)", median(openTimes)},
        {"Insert 20,000 rows, one transaction", median(insertTimes)},
        {"2,000 lookups by id", median(lookupTimes)},
        {"2,000 lookups by id, all in the page cache", median(cachedTimes)},
        {"500 indexed range queries (50 rows)", median(rangeTimes)},
        {"10 full scans (LIKE on 20,000 rows)", median(scanTimes)},
        {"1,000 updates, one transaction each", median(updateTimes)},
    };
}

// unsafe_EncryptDB / unsafe_DecryptDB on a database of `rows`: how long a user waits
std::vector<Result> runRekeys(int rows, const char *label) {
    std::string path = tempPath("rekey");
    std::vector<double> encryptTimes, changeTimes, decryptTimes;
    double megabytes = 0;
    for (int run = 0; run < 3; run++) {
        removeDatabase(path);
        sqlite3 *db = open(path, "");
        createTable(db);
        insertRows(db, rows);
        exec(db, "pragma wal_checkpoint(truncate)");
        sqlite3_stmt *size = nullptr;
        sqlite3_prepare_v2(db, "select page_count * page_size from pragma_page_count(), pragma_page_size()", -1, &size,
                           nullptr);
        sqlite3_step(size);
        megabytes = sqlite3_column_int64(size, 0) / 1e6;
        sqlite3_finalize(size);

        bool reopened = false;
        auto start = Clock::now();
        rekey(db, path, "", "k1", reopened);
        encryptTimes.push_back(ms(start));
        start = Clock::now();
        rekey(db, path, "k1", "k2", reopened);
        changeTimes.push_back(ms(start));
        start = Clock::now();
        rekey(db, path, "k2", "", reopened);
        decryptTimes.push_back(ms(start));
        sqlite3_close(db);
    }
    removeDatabase(path);
    static std::vector<std::string> names;
    char buffer[128];
    std::vector<Result> results;
    for (const char *operation : {"Encrypt", "Change passphrase", "Decrypt"}) {
        std::snprintf(buffer, sizeof(buffer), "%s, %s (%.0f MB)", operation, label, megabytes);
        names.push_back(buffer);
    }
    size_t base = names.size() - 3;
    results.push_back({names[base].c_str(), median(encryptTimes)});
    results.push_back({names[base + 1].c_str(), median(changeTimes)});
    results.push_back({names[base + 2].c_str(), median(decryptTimes)});
    return results;
}

void print(const char *build, const std::vector<Result> &results) {
    for (const Result &result : results) {
        std::printf("%s\t%s\t%.1f\n", build, result.name, result.value);
    }
}

} // namespace

int main(int argc, char **argv) {
    (void)argc;
    (void)argv;
#if NITROMELON_ENCRYPTION
    print("encryption, no key", runWorkload(""));
    print("encryption, with a key", runWorkload("benchmark passphrase"));
    print("encryption", runRekeys(kRows, "20,000 rows"));
    print("encryption", runRekeys(kRows * 5, "100,000 rows"));
#else
    print("plain", runWorkload(""));
#endif
    return 0;
}
