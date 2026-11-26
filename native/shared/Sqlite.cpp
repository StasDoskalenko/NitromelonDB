#include "Sqlite.h"
#include "DatabasePlatform.h"
#include "SqliteEncryption.h"
#include <algorithm>
#include <cassert>

namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

std::string resolveDatabasePath(std::string path) {
    if (path == "" || path == ":memory:" || path.rfind("file:", 0) == 0 || path.rfind("/", 0) == 0) {
        // These seem like paths/sqlite path-like strings
        return path;
    } else {
        // path is a name to be resolved based on platform preferences
        return platform::resolveDatabasePath(path);
    }
}

SqliteDb::SqliteDb(std::string path, const std::string &passphrase, bool allowUnencrypted, bool plaintextHeader)
    : plaintextHeader_(plaintextHeader) {
    consoleLog("Will open database...");
    platform::initializeSqlite();
    #ifndef ANDROID
    assert(sqlite3_threadsafe());
    #endif

    auto resolvedPath = resolveDatabasePath(path);
    resolvedPath_ = resolvedPath;
    // A re-key killed in the middle left a journal to roll back (or a copy to delete), and until
    // then the header may already be in the new format
    encryption::recoverInterruptedRekey(resolvedPath, passphrase);
    // Before opening: sqlite3_open_v2 creates the file, and the header tells encrypted from plain
    auto fileState = encryption::probeFile(resolvedPath);
    // SQLITE_OPEN_URI so `file:name?mode=memory&cache=shared` works even if
    // sqlite3_config(SQLITE_CONFIG_URI) lost the race with another initializer.
    int openResult = sqlite3_open_v2(
        resolvedPath.c_str(),
        &sqlite,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI,
        nullptr);

    if (openResult != SQLITE_OK) {
        if (sqlite) {
            auto error = std::string(sqlite3_errmsg(sqlite));
            sqlite3_close(sqlite);
            sqlite = nullptr;
            throw std::runtime_error("Error while trying to open database - " + error);
        } else {
            // whoa, sqlite couldn't allocate memory
            throw std::runtime_error("Error while trying to open database, sqlite is null - " + std::to_string(openResult));
        }
    }
    assert(sqlite != nullptr);

    try {
        isEncrypted = encryption::openWithKey(sqlite, fileState, passphrase, allowUnencrypted, plaintextHeader);
        if (isEncrypted) {
            passphrase_ = passphrase;
            hasPlaintextHeader = fileState == encryption::FileState::EncryptedPlaintextHeader ||
                                 (fileState == encryption::FileState::Missing && plaintextHeader);
        }
    } catch (...) {
        // The destructor doesn't run when a constructor throws
        sqlite3_close(sqlite);
        sqlite = nullptr;
        isDestroyed_ = true;
        throw;
    }

    consoleLog(std::string(isEncrypted ? "Opened encrypted database at " : "Opened database at ") + resolvedPath);
}

void SqliteDb::changeEncryptionKey(const std::string &newPassphrase, bool &reopened,
                                   encryption::RekeyProgress *progress) {
    encryption::rekey(sqlite, resolvedPath_, passphrase_, newPassphrase, reopened, progress, plaintextHeader_);
    std::fill(passphrase_.begin(), passphrase_.end(), '\0');
    passphrase_ = newPassphrase;
    isEncrypted = !newPassphrase.empty();
    hasPlaintextHeader = isEncrypted && plaintextHeader_;
}

void SqliteDb::destroy() {
    if (isDestroyed_) {
        return;
    }
    std::fill(passphrase_.begin(), passphrase_.end(), '\0');
    passphrase_.clear();
    consoleLog("Closing database...");

    isDestroyed_ = true;
    assert(sqlite != nullptr);

    // Find and finalize all prepared statements
    sqlite3_stmt *stmt;
    while ((stmt = sqlite3_next_stmt(sqlite, nullptr))) {
        consoleError("Leak detected! Finalized a statement when closing database - this means that there were dangling "
                     "statements not held by cachedStatements, or handling of cachedStatements is broken. Please "
                     "collect as much information as possible and file an issue with WatermelonDB repository!");
        sqlite3_finalize(stmt);
    }

    // Close connection
    // NOTE: Applications should finalize all prepared statements, close all BLOB handles, and finish all sqlite3_backup objects
    int closeResult = sqlite3_close(sqlite);

    if (closeResult != SQLITE_OK) {
        // NOTE: We're just gonna log an error. We can't throw an exception here. We could crash, but most likely we're
        // only leaking memory/resources
        consoleError("Failed to close sqlite database - " + std::string(sqlite3_errmsg(sqlite)));
    }

    consoleLog("Database closed.");
}

SqliteDb::~SqliteDb() {
    destroy();
}

SqliteStatement::SqliteStatement(sqlite3_stmt *statement) : stmt(statement) {
}

SqliteStatement::~SqliteStatement() {
    reset();
}

void SqliteStatement::reset() {
    if (stmt) {
        // TODO: I'm confused by whether or not the return value of reset is relevant:
        // If the most recent call to sqlite3_step(S) for the prepared statement S indicated an error, then
        // sqlite3_reset(S) returns an appropriate error code. https://sqlite.org/c3ref/reset.html
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt); // might matter if storing a huge string/blob
                                      //        consoleLog("statement has been reset!");
    }
}

} // namespace watermelondb
