#include "Database.h"

#include <cassert>

namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

Database::Database(jsi::Runtime *runtime, std::string path, bool usesExclusiveLocking) : runtime_(runtime), mutex_() {
    db_ = std::make_unique<SqliteDb>(path);

    std::string initSql = "";

    // NOTE: Android used to force `pragma temp_store = memory` here to work around large
    // batches erroring out with an IO error (no temp store configured). That forced all
    // sort/index-rebuild/migration scratch space onto the heap instead of disk -- exactly the
    // wrong tradeoff under memory pressure. Fixed at the root instead: Android's
    // `platform::initializeSqlite()` (DatabasePlatformAndroid.cpp) now sets
    // `sqlite3_temp_directory` to a real, app-sandboxed cache directory obtained via JNI, once,
    // before any connection is opened -- see plans/native-statement-cache-and-temp-store.md.

    // Packaged WinAppSDK apps often cannot create WAL/SHM next to a URI memory
    // DB (cwd is not writable). Keep WAL for on-disk databases.
    #if defined(_WIN32)
    const bool isMemoryDb = path == ":memory:" || path.find("mode=memory") != std::string::npos;
    initSql += isMemoryDb ? "pragma journal_mode = MEMORY;" : "pragma journal_mode = WAL;";
    #else
    initSql += "pragma journal_mode = WAL;";
    #endif

    // set timeout before SQLITE_BUSY error is returned
    initSql += "pragma busy_timeout = 5000;";

    #ifdef ANDROID
    // NOTE: This was added in an attempt to fix mysterious `database disk image is malformed` issue when using
    // headless JS services
    // NOTE: This slows things down
    initSql += "pragma synchronous = FULL;";
    #endif
    if (usesExclusiveLocking) {
        // this seems to fix the headless JS service issue but breaks if you have multiple readers
        initSql += "pragma locking_mode = EXCLUSIVE;";
    }

    executeMultiple(initSql);
}

void Database::destroy() {
    const std::lock_guard<std::mutex> lock(mutex_);

    if (isDestroyed_) {
        return;
    }
    isDestroyed_ = true;
    cachedStatements_.clear();
    db_->destroy();
}

Database::~Database() {
    destroy();
}

bool Database::isCached(std::string cacheKey) {
    return cachedRecords_.find(cacheKey) != cachedRecords_.end();
}
void Database::markAsCached(std::string cacheKey) {
    cachedRecords_.insert(cacheKey);
}
void Database::removeFromCache(std::string cacheKey) {
    cachedRecords_.erase(cacheKey);
}

void Database::unsafeResetDatabase(const std::string &schema, int schemaVersion) {
    const std::lock_guard<std::mutex> lock(mutex_);

    // TODO: in non-memory mode, just delete the DB files
    // NOTE: As of iOS 14, selecting tables from sqlite_master and deleting them does not work
    // They seem to be enabling "defensive" config. So we use another obscure method to clear the database
    // https://www.sqlite.org/c3ref/c_dbconfig_defensive.html#sqlitedbconfigresetdatabase

    if (sqlite3_db_config(db_->sqlite, SQLITE_DBCONFIG_RESET_DATABASE, 1, 0) != SQLITE_OK) {
        throwSqliteError("Failed to enable reset database mode");
    }
    // NOTE: We can't VACUUM in a transaction
    executeMultiple("vacuum");

    if (sqlite3_db_config(db_->sqlite, SQLITE_DBCONFIG_RESET_DATABASE, 0, 0) != SQLITE_OK) {
        throwSqliteError("Failed to disable reset database mode");
    }

    beginTransaction();
    try {
        cachedRecords_ = {};

        // Reinitialize schema
        executeMultiple(schema);
        setUserVersion(schemaVersion);

        commit();
    } catch (const std::exception &ex) {
        rollback();
        throw;
    }
}

void Database::unsafeResetDatabase(jsi::String &schema, int schemaVersion) {
    unsafeResetDatabase(schema.utf8(getRt()), schemaVersion);
}

void Database::migrate(const std::string &migrationSql, int fromVersion, int toVersion) {
    const std::lock_guard<std::mutex> lock(mutex_);

    beginTransaction();
    try {
        assert(getUserVersion() == fromVersion && "Incompatible migration set");

        executeMultiple(migrationSql);
        setUserVersion(toVersion);

        commit();
    } catch (const std::exception &ex) {
        rollback();
        throw;
    }
}

void Database::migrate(jsi::String &migrationSql, int fromVersion, int toVersion) {
    migrate(migrationSql.utf8(getRt()), fromVersion, toVersion);
}

} // namespace watermelondb
