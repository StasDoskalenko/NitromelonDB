#pragma once

// Opening and re-keying encrypted databases (SQLiteAdapter's `encryption` option). Needs only
// SQLite, not JSI or the platform layer, so `yarn test:native-unit` tests it directly
// (native/tests/SqliteEncryptionTest.cpp). docs/plans/sqlcipher-encryption.md has the design.

#include <atomic>
#include <cstdint>
#include <mutex>
#include <stdexcept>
#include <string>
#include "NitromelonSqlite.h"

namespace watermelondb {
namespace encryption {

// What the first bytes of a database file say, before anything opens it
enum class FileState {
    // No file, an empty one, or an in-memory database: a new database
    Missing,
    // Starts with "SQLite format 3\0"
    Unencrypted,
    // Anything else. Usually encrypted, but a damaged or non-SQLite file looks the same: only
    // opening it with the right key proves it's encrypted.
    Encrypted,
    // Encrypted with a plaintext header (`encryption.plaintextHeader`, for iOS App Groups): starts
    // with "SQLite format 3\0" like a plain database, but reserves SQLCipher's 80 bytes per page
    // (header byte 20), which a plain database never does. Its salt is in the salt file
    // (saltFilePath), not in the database.
    EncryptedPlaintextHeader,
};

// SQLCipher's plaintext header: the first 32 bytes of the file stay readable, so iOS can tell it's
// a SQLite database (and doesn't kill an app that holds a lock on it in a shared App Group
// container while suspended). 32 is the size SQLCipher documents for iOS.
const int kPlaintextHeaderSize = 32;

// Where an encrypted database with a plaintext header keeps its key's salt: 32 hex digits. The
// salt isn't secret (without a plaintext header SQLCipher stores it at the start of the file), but
// without it the database can't be opened. It's written before the database depends on it.
std::string saltFilePath(const std::string &resolvedPath);

// Thrown when a database can't be opened or re-keyed as asked. what() starts with the code in
// brackets (`[encryption_key_invalid] ...`), which is how JS gets it as `error.code` (Nitro passes
// only the message).
class EncryptionError : public std::runtime_error {
public:
    EncryptionError(const std::string &code, const std::string &message);
    const std::string code;
};

// Whether this build has the codec ("nitromelondb": { "encryption": true }, see
// NitromelonSqliteConfig.h)
bool isAvailable();

// Reads the first 16 bytes of `resolvedPath`. Never opens SQLite, so it can't fail on a wrong key.
// Understands `file:` URIs and in-memory names. Call recoverInterruptedRekey() first: until a
// killed re-key is rolled back, the header can already be in the new format.
FileState probeFile(const std::string &resolvedPath);

const char *fileStateName(FileState state);

// Whether a rollback journal is waiting next to the database: a transaction in rollback-journal
// mode was cut off. NitromelonDB's databases are in WAL mode, so that's a killed re-key.
bool hasHotJournal(const std::string &resolvedPath);

// Call before opening a database (and before probeFile). Finishes what a killed re-key left:
// - a hot journal is rolled back by a connection set up like the one that wrote it, i.e. as the
//   database was before the re-key: with `passphrase` (and if there's a salt file, also with its
//   salt, with and without a plaintext header: adding one overwrites the salt in page 1 at the
//   commit), else without a key. A wrong attempt changes nothing (SqliteEncryptionTest checks), so
//   all are tried. If none works (a passphrase change was cut off, and the app has only the new
//   passphrase), the journal stays for the right key.
// - a leftover decrypted copy (see rekey) is deleted. The database itself was never touched then.
void recoverInterruptedRekey(const std::string &resolvedPath, const std::string &passphrase);

// Called right after sqlite3_open_v2, before anything else touches the database. Applies
// `passphrase` (empty: none) and checks it works. Returns whether the connection is encrypted.
// A new database is created with a plaintext header if `plaintextHeader` (writing its salt file
// first); an existing one opens in the layout it has, whatever `plaintextHeader` says.
//
// Throws EncryptionError, and never changes the file:
// - encryption_unavailable: a passphrase, but this build has no codec, or an in-memory database
// - encryption_key_invalid: wrong passphrase, or the file isn't a database
// - encryption_key_required: no passphrase, but the file isn't plain SQLite
// - database_not_encrypted: a passphrase, but the file is plain SQLite and !allowUnencrypted
// - encryption_salt_missing: the database has a plaintext header, and its salt file is gone
bool openWithKey(sqlite3 *db, FileState state, const std::string &passphrase, bool allowUnencrypted,
                 bool plaintextHeader = false);

// How far a rekey() has come, for SQLiteAdapter's `encryption.events.onProgress`. rekey() updates
// it on its own thread, and fraction() can be called from any other one meanwhile: JS polls it while
// every other database call waits for the re-key.
//
// SQLite reports no progress for a re-key, so it's estimated from what has been written so far:
// - decrypting: the size of the decrypted copy, against the pages in use
// - changing the key: the size of the rollback journal, which gets every page before it's rewritten
// - encrypting: sqlite3mc first builds the encrypted database in a temporary one (a VACUUM, to make
//   room for SQLCipher's per-page HMAC), then copies it over the file, journaling every page. The
//   first half is the temporary database's pages, the second the journal.
// Good enough for a progress bar: it only moves forward, and ends near 1.
class RekeyProgress {
public:
    // 0 to 1 while a rekey() runs, -1 otherwise
    double fraction() const;

    // (rekey() only)
    enum class Operation { Encrypt, Rekey, Decrypt };
    void begin(Operation operation, const std::string &filePath, int64_t expectedBytes, int64_t expectedPages);
    void setBuiltPages(int64_t pages);
    void end();

private:
    mutable std::mutex mutex_;
    bool running_ = false;
    Operation operation_ = Operation::Encrypt;
    std::string filePath_;
    int64_t expectedBytes_ = 0;
    int64_t expectedPages_ = 0;
    std::atomic<int64_t> builtPages_{0};
    // The last answer, so a file that shrinks for a moment (the journal is deleted at the commit)
    // can't move it back
    mutable double last_ = 0;
};

// Changes the key of the database `db` has open at `resolvedPath`, which is keyed with
// `currentPassphrase` (empty: none):
// - encrypt or change the key: in place (sqlite3_rekey_v2), in one transaction. Killed in the
//   middle, the database opens with the old key (after recoverInterruptedRekey) or the new one.
// - decrypt (empty `newPassphrase`): writes a decrypted copy next to it (VACUUM INTO), syncs it,
//   closes `db`, and replaces the database file with the copy, then opens it. In place, a kill at
//   the commit would leave a database neither key opens: SQLCipher keeps the key's salt in page 1,
//   which the commit overwrites first. Needs free space for the copy.
//
// Encrypting and changing the key write the database with a plaintext header if `plaintextHeader`,
// and without one otherwise, whatever it had: that's also how a database changes layout. The salt
// file is written before the re-key commits, with the salt the database already has (so a killed
// re-key rolls back with it), or a new one when a plain database is encrypted. It's deleted once a
// database no longer needs it.
//
// Leaves WAL for the duration (sqlite3mc can't encrypt in WAL mode). The caller must hold the only
// use of `db`, with no transaction open, and finalize its statements first (decrypting closes it).
// Sets `reopened` when `db` was replaced by a new connection, which then needs the connection's
// settings again (journal mode, ...); also when it throws. (Don't compare pointers: the new
// connection can get the old one's address.) Throws EncryptionError (encryption_unavailable,
// rekey_failed); the database keeps its previous key then, and `db` is a working connection.
// `progress` (optional) is kept up to date meanwhile, see RekeyProgress.
void rekey(sqlite3 *&db, const std::string &resolvedPath, const std::string &currentPassphrase,
           const std::string &newPassphrase, bool &reopened, RekeyProgress *progress = nullptr,
           bool plaintextHeader = false);

// Where rekey() writes the decrypted copy
std::string decryptedCopyPath(const std::string &resolvedPath);

} // namespace encryption
} // namespace watermelondb
