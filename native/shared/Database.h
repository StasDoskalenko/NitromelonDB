#pragma once

#include <jsi/jsi.h>
#include <list>
#include <unordered_map>
#include <unordered_set>
#include <mutex>
#include <optional>
#include <string>
#include <variant>
#include <vector>
#include <sqlite3.h>

// FIXME: Make these paths consistent across platforms
#if __ANDROID__
#import <simdjson.h>
#elif defined(WIN32) || defined(_WIN32) || defined(__WIN32__) || defined(__NT__)
#include <simdjson.h>
#else
#include <simdjson/simdjson.h>
#endif

#include "Sqlite.h"
#include "DatabasePlatform.h"

using namespace facebook;

namespace watermelondb {

using SqliteValue = std::variant<std::nullptr_t, bool, double, std::string>;
using SqliteRow = std::unordered_map<std::string, SqliteValue>;
using SqliteFindResult = std::variant<std::nullptr_t, std::string, SqliteRow>;
using SqliteQueryRecord = std::variant<std::string, SqliteRow>;
using SqliteQueryAsArrayItem = std::variant<std::string, std::vector<SqliteValue>>;

enum class SyncColumnType { String, Number, Boolean };
struct SyncColumn {
    int index;
    std::string name;
    SyncColumnType type;
    bool isOptional;
};
using SyncSchema = std::unordered_map<std::string, std::vector<SyncColumn>>;

struct SqliteBatchOperation {
    double cacheBehavior;
    std::optional<std::string> table;
    std::string sql;
    std::vector<std::vector<SqliteValue>> argBatches;
};

// Bounds the number of cached prepared statements. `Collection#query()`'s
// dynamic `where()` conditions embed values directly as SQL literals rather
// than `?` placeholders (see plans/native-statement-cache-and-temp-store.md),
// so every distinct filter value combination a query has ever been run with
// produces a distinct SQL string, and caching one sqlite3_stmt* per string
// forever grows this unbounded over an app's lifetime. An LRU cap keeps the
// common case (a small, stable set of hot queries reused often) fast without
// leaking, evicting only the least-recently-used entry, one at a time, when
// insertion would exceed capacity.
class StatementCache {
public:
    // Anchored to classic Android SQLiteDatabase's `maxSqlCacheSize` default,
    // cited in https://github.com/StasDoskalenko/NitromelonDB/issues/111.
    static constexpr size_t kCapacity = 50;

    // Returns the cached statement for `sql`, or nullptr if not cached.
    // Marks the entry most-recently-used on a hit.
    sqlite3_stmt *get(const std::string &sql);
    // Inserts `sql` -> `statement`. Caller must have already checked get()
    // returned nullptr for `sql`. Evicts (and sqlite3_finalize's) the
    // least-recently-used entry if this would exceed kCapacity -- the
    // just-inserted entry is always most-recently-used, so it's never the
    // one evicted by its own insertion.
    void insert(const std::string &sql, sqlite3_stmt *statement);
    // Finalizes every cached statement and empties the cache. Used by
    // Database::destroy() -- reuses the same finalize-then-clear idiom that
    // used to be inlined there.
    void clear();

private:
    std::unordered_map<std::string, sqlite3_stmt *> map_;
    std::list<std::string> lru_; // front = most recently used
    std::unordered_map<std::string, std::list<std::string>::iterator> lruPos_;
};

class Database : public jsi::HostObject {
public:
#if defined(WIN32) || defined(_WIN32) || defined(__WIN32__) || defined(__NT__)
    static void install(jsi::Runtime *runtime);
#endif
    Database(jsi::Runtime *runtime, std::string path, bool usesExclusiveLocking);
    ~Database();
    void destroy();
    // Releases as much of SQLite's own internal heap memory as possible for this
    // connection (page cache, unused lookaside, etc.) via sqlite3_db_release_memory --
    // the per-connection API, always effective regardless of compile-time memory-
    // management flags (unlike the deprecated global sqlite3_release_memory(), which is
    // a no-op unless SQLITE_ENABLE_MEMORY_MANAGEMENT was set, which it isn't here).
    // Safe to call from any thread: this vendored SQLite is built SQLITE_THREADSAFE=1
    // (serialized -- see the sqlite3_threadsafe() assert in Sqlite.cpp), so this
    // serializes against the JS thread's normal query calls via SQLite's own internal
    // mutex, not just ours. Called from the native memory-alert path (see
    // HybridNitromelonDatabase::database()) in addition to (not instead of) the
    // JS-side WeakValueCache pruning that alert already triggers.
    void releaseMemory();

    jsi::Value find(jsi::String &tableName, jsi::String &id);
    jsi::Value query(jsi::String &tableName, jsi::String &sql, jsi::Array &arguments);
    jsi::Value queryAsArray(jsi::String &tableName, jsi::String &sql, jsi::Array &arguments);
    jsi::Array queryIds(jsi::String &sql, jsi::Array &arguments);
    jsi::Array unsafeQueryRaw(jsi::String &sql, jsi::Array &arguments);
    jsi::Value count(jsi::String &sql, jsi::Array &arguments);
    void batch(jsi::Array &operations);
    void batchJSON(jsi::String &&operationsJson);
    jsi::Value unsafeLoadFromSync(int jsonId, jsi::Object &schema, std::string preamble, std::string postamble);
    void unsafeResetDatabase(jsi::String &schema, int schemaVersion);
    jsi::Value getLocal(jsi::String &key);
    void executeMultiple(std::string sql);

    SqliteFindResult find(const std::string &tableName, const std::string &id);
    std::vector<SqliteQueryRecord> query(const std::string &tableName, const std::string &sql, const std::vector<SqliteValue> &arguments);
    std::vector<SqliteQueryAsArrayItem> queryAsArray(const std::string &tableName, const std::string &sql, const std::vector<SqliteValue> &arguments);
    std::vector<std::string> queryIds(const std::string &sql, const std::vector<SqliteValue> &arguments);
    std::vector<SqliteRow> unsafeQueryRaw(const std::string &sql, const std::vector<SqliteValue> &arguments);
    double count(const std::string &sql, const std::vector<SqliteValue> &arguments);
    void batch(const std::vector<SqliteBatchOperation> &operations);
    void batchJSON(const std::string &operationsJson);
    std::unordered_map<std::string, std::string> loadFromSync(int jsonId, const SyncSchema &schema, std::string preamble, std::string postamble);
    void unsafeResetDatabase(const std::string &schema, int schemaVersion);
    std::optional<std::string> getLocal(const std::string &key);
    void migrate(const std::string &migrationSql, int fromVersion, int toVersion);

    int getUserVersion();
    void migrate(jsi::String &migrationSql, int fromVersion, int toVersion);

private:
    bool initialized_;
    bool isDestroyed_;
    std::mutex mutex_;
    jsi::Runtime *runtime_; // TODO: std::shared_ptr would be better than a raw pointer from the JS runtime
    std::unique_ptr<SqliteDb> db_;
    StatementCache cachedStatements_; // bounded, LRU-evicting -- see StatementCache above
    std::unordered_set<std::string> cachedRecords_;

    jsi::Runtime &getRt();
    jsi::JSError dbError(std::string description);
    std::string sqliteErrorMessage(std::string description);
    [[noreturn]] void throwSqliteError(std::string description);

    sqlite3_stmt* prepareQuery(std::string sql);
    void bindArgs(sqlite3_stmt *statement, jsi::Array &arguments);
    void bindArgs(sqlite3_stmt *statement, const std::vector<SqliteValue> &arguments);
    std::string bindArgsAndReturnId(sqlite3_stmt *statement, simdjson::ondemand::array &args);
    SqliteStatement executeQuery(std::string sql, jsi::Array &arguments);
    SqliteStatement executeQuery(std::string sql, const std::vector<SqliteValue> &arguments);
    void executeUpdate(sqlite3_stmt *statement);
    void executeUpdate(std::string sql, jsi::Array &arguments);
    void executeUpdate(std::string sql, const std::vector<SqliteValue> &args);
    void executeUpdate(std::string sql);
    void getRow(sqlite3_stmt *stmt);
    bool getNextRowOrTrue(sqlite3_stmt *stmt);
    SqliteValue columnValue(sqlite3_stmt *statement, int i);
    SqliteRow resultRow(sqlite3_stmt *statement);
    std::vector<SqliteValue> resultValues(sqlite3_stmt *statement);
    std::vector<std::string> resultColumnNames(sqlite3_stmt *statement);
    jsi::Object resultDictionary(sqlite3_stmt *statement);
    jsi::Array resultArray(sqlite3_stmt *statement);
    jsi::Array resultColumns(sqlite3_stmt *statement);
    jsi::Array arrayFromStd(std::vector<jsi::Value> &vector);
    jsi::Value sqliteValueToJsi(const SqliteValue &value);
    jsi::Object sqliteRowToJsi(const SqliteRow &row);

    void beginTransaction();
    void commit();
    void rollback();

    void setUserVersion(int newVersion);

    bool isCached(std::string cacheKey);
    void markAsCached(std::string cacheKey);
    void removeFromCache(std::string cacheKey);
};

inline std::string cacheKey(std::string tableName, std::string recordId) {
    return tableName + "$" + recordId; // NOTE: safe as long as table names cannot contain $ sign
}

} // namespace watermelondb
