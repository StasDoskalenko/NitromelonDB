// Unit tests for StatementCache (native/shared/StatementCache.h), against real prepared statements
// on an in-memory SQLite database. Run with `yarn test:native-unit`.
//
// Leaks are checked through SQLite itself: sqlite3_next_stmt() lists every statement that hasn't
// been finalized, so after each step the connection must have exactly as many live statements as
// the cache holds.

#include "../shared/StatementCache.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using watermelondb::StatementCache;

static int failures = 0;

#define CHECK(condition)                                                          \
    do {                                                                          \
        if (!(condition)) {                                                       \
            std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #condition); \
            failures += 1;                                                        \
        }                                                                         \
    } while (0)

static sqlite3 *openDb() {
    sqlite3 *db = nullptr;
    if (sqlite3_open(":memory:", &db) != SQLITE_OK) {
        std::fprintf(stderr, "can't open an in-memory database\n");
        std::exit(1);
    }
    return db;
}

static sqlite3_stmt *prepare(sqlite3 *db, const std::string &sql) {
    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
        std::fprintf(stderr, "can't prepare %s: %s\n", sql.c_str(), sqlite3_errmsg(db));
        std::exit(1);
    }
    return statement;
}

static size_t liveStatements(sqlite3 *db) {
    size_t count = 0;
    for (sqlite3_stmt *s = sqlite3_next_stmt(db, nullptr); s; s = sqlite3_next_stmt(db, s)) {
        count += 1;
    }
    return count;
}

static std::string sqlFor(int i) {
    return "select " + std::to_string(i);
}

// Looks `sql` up like Database::prepareQuery() does: prepare and insert on a miss
static bool use(StatementCache &cache, sqlite3 *db, const std::string &sql) {
    if (cache.get(sql)) {
        return true;
    }
    cache.insert(sql, prepare(db, sql));
    return false;
}

static void capacityScalesWithTables() {
    CHECK(StatementCache::capacityForTables(0) == StatementCache::kBaseCapacity);
    CHECK(StatementCache::capacityForTables(80) ==
          StatementCache::kBaseCapacity + 80 * StatementCache::kPerTableCapacity);
    CHECK(StatementCache::capacityForTables(100000) == StatementCache::kMaxCapacity);
    CHECK(StatementCache().capacity() == StatementCache::kBaseCapacity);
}

static void countsTables() {
    sqlite3 *db = openDb();
    CHECK(StatementCache::countTables(db) == 0);
    sqlite3_exec(db, "create table a (id text); create table b (id text); create index b_id on b (id);", nullptr,
                 nullptr, nullptr);
    CHECK(StatementCache::countTables(db) == 2); // indices don't count
    CHECK(liveStatements(db) == 0);
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

static void evictsLeastRecentlyUsed() {
    sqlite3 *db = openDb();
    {
        StatementCache cache;
        cache.setCapacity(3);
        use(cache, db, sqlFor(1));
        use(cache, db, sqlFor(2));
        use(cache, db, sqlFor(3));
        CHECK(cache.get(sqlFor(1)) != nullptr); // 1 is now the most recently used
        use(cache, db, sqlFor(4));              // evicts 2
        CHECK(cache.size() == 3);
        CHECK(cache.get(sqlFor(2)) == nullptr);
        CHECK(cache.get(sqlFor(1)) != nullptr);
        CHECK(cache.get(sqlFor(3)) != nullptr);
        CHECK(cache.get(sqlFor(4)) != nullptr);
        CHECK(liveStatements(db) == 3); // the evicted statement was finalized
    }
    CHECK(liveStatements(db) == 0); // the destructor finalizes the rest
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

static void shrinkingEvictsImmediately() {
    sqlite3 *db = openDb();
    StatementCache cache;
    for (int i = 0; i < 5; i += 1) {
        use(cache, db, sqlFor(i));
    }
    cache.setCapacity(2);
    CHECK(cache.size() == 2);
    CHECK(cache.get(sqlFor(4)) != nullptr);
    CHECK(cache.get(sqlFor(3)) != nullptr);
    CHECK(cache.get(sqlFor(0)) == nullptr);
    CHECK(liveStatements(db) == 2);

    cache.setCapacity(10); // growing keeps what's there
    CHECK(cache.size() == 2);
    cache.clear();
    CHECK(cache.size() == 0);
    CHECK(cache.capacity() == 10); // clear() keeps the capacity
    CHECK(liveStatements(db) == 0);
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

// The regression from discussion #109: a sync goes through the same statements for every table,
// in the same order, every time. An LRU smaller than that working set misses on every lookup;
// one at least as big hits on every lookup after the first round.
static void cyclicWorkingSet() {
    sqlite3 *db = openDb();
    const int workingSet = 400;
    auto hitsInSecondRound = [&](size_t capacity) {
        StatementCache cache;
        cache.setCapacity(capacity);
        for (int i = 0; i < workingSet; i += 1) {
            use(cache, db, sqlFor(i));
        }
        int hits = 0;
        for (int i = 0; i < workingSet; i += 1) {
            hits += use(cache, db, sqlFor(i)) ? 1 : 0;
        }
        return hits;
    };
    CHECK(hitsInSecondRound(50) == 0);
    CHECK(hitsInSecondRound(StatementCache::capacityForTables(40)) == workingSet);
    CHECK(liveStatements(db) == 0);
    CHECK(sqlite3_close(db) == SQLITE_OK);
}

int main() {
    capacityScalesWithTables();
    countsTables();
    evictsLeastRecentlyUsed();
    shrinkingEvictsImmediately();
    cyclicWorkingSet();
    if (failures) {
        std::fprintf(stderr, "StatementCache: %d check(s) failed\n", failures);
        return 1;
    }
    std::printf("StatementCache: all checks passed\n");
    return 0;
}
