#pragma once

#include <string>
#include "NitromelonSqlite.h"
#include "SqliteEncryption.h"

namespace watermelondb {

// A database name ("watermelon") -> the platform's path for it. Paths, `file:` URIs and ":memory:"
// are returned as they are.
std::string resolveDatabasePath(std::string path);

// Lightweight wrapper for handling sqlite3 lifetime
class SqliteDb {
public:
    // `passphrase` empty: no encryption. See encryption::openWithKey for what's thrown (always before
    // anything is written).
    // `plaintextHeader`: create a new database with a plaintext header, and write that layout when
    // re-keying (encryption::openWithKey, encryption::rekey)
    SqliteDb(std::string path, const std::string &passphrase = "", bool allowUnencrypted = false,
             bool plaintextHeader = false);
    ~SqliteDb();
    void destroy();

    sqlite3 *sqlite = nullptr;
    // Whether the connection is keyed
    bool isEncrypted = false;
    // Whether the database has a plaintext header now (an existing one keeps its layout until it's
    // re-keyed)
    bool hasPlaintextHeader = false;

    // Encrypts, re-keys or (empty) decrypts, see encryption::rekey. Sets `reopened` when `sqlite` is a
    // new connection afterwards (also when it throws), which then needs the connection's settings.
    void changeEncryptionKey(const std::string &newPassphrase, bool &reopened,
                             encryption::RekeyProgress *progress = nullptr);

    SqliteDb &operator=(const SqliteDb &) = delete;
    SqliteDb(const SqliteDb &) = delete;

private:
    bool isDestroyed_ = false;
    std::string resolvedPath_;
    // The current key, while the connection is open: decrypting reopens the file, and if replacing
    // it fails, the encrypted original must be opened again. (SQLite holds the derived key in
    // memory while the database is open anyway.)
    std::string passphrase_;
    bool plaintextHeader_ = false;
};

class SqliteStatement {
public:
    SqliteStatement(sqlite3_stmt *statement);
    ~SqliteStatement();

    sqlite3_stmt *stmt;

    void reset();
};

} // namespace watermelondb

