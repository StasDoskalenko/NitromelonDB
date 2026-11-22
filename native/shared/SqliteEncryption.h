#pragma once

// Opening and re-keying encrypted databases (SQLiteAdapter's `encryption` option). Needs only
// SQLite, not JSI or the platform layer, so `yarn test:native-unit` tests it directly
// (native/tests/SqliteEncryptionTest.cpp). docs/plans/sqlcipher-encryption.md has the design.

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
};

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
//   database was before the re-key: with `passphrase`, else without a key. A wrong attempt changes
//   nothing (SqliteEncryptionTest checks), so both are tried. If neither works (a passphrase change
//   was cut off, and the app has only the new passphrase), the journal stays for the right key.
// - a leftover decrypted copy (see rekey) is deleted. The database itself was never touched then.
void recoverInterruptedRekey(const std::string &resolvedPath, const std::string &passphrase);

// Called right after sqlite3_open_v2, before anything else touches the database. Applies
// `passphrase` (empty: none) and checks it works. Returns whether the connection is encrypted.
//
// Throws EncryptionError, and never changes the file:
// - encryption_unavailable: a passphrase, but this build has no codec, or an in-memory database
// - encryption_key_invalid: wrong passphrase, or the file isn't a database
// - encryption_key_required: no passphrase, but the file isn't plain SQLite
// - database_not_encrypted: a passphrase, but the file is plain SQLite and !allowUnencrypted
bool openWithKey(sqlite3 *db, FileState state, const std::string &passphrase, bool allowUnencrypted);

// Changes the key of the database `db` has open at `resolvedPath`, which is keyed with
// `currentPassphrase` (empty: none):
// - encrypt or change the key: in place (sqlite3_rekey_v2), in one transaction. Killed in the
//   middle, the database opens with the old key (after recoverInterruptedRekey) or the new one.
// - decrypt (empty `newPassphrase`): writes a decrypted copy next to it (VACUUM INTO), syncs it,
//   closes `db`, and replaces the database file with the copy, then opens it. In place, a kill at
//   the commit would leave a database neither key opens: SQLCipher keeps the key's salt in page 1,
//   which the commit overwrites first. Needs free space for the copy.
//
// Leaves WAL for the duration (sqlite3mc can't encrypt in WAL mode). The caller must hold the only
// use of `db`, with no transaction open, and finalize its statements first (decrypting closes it).
// Sets `reopened` when `db` was replaced by a new connection, which then needs the connection's
// settings again (journal mode, ...); also when it throws. (Don't compare pointers: the new
// connection can get the old one's address.) Throws EncryptionError (encryption_unavailable,
// rekey_failed); the database keeps its previous key then, and `db` is a working connection.
void rekey(sqlite3 *&db, const std::string &resolvedPath, const std::string &currentPassphrase,
           const std::string &newPassphrase, bool &reopened);

// Where rekey() writes the decrypted copy
std::string decryptedCopyPath(const std::string &resolvedPath);

} // namespace encryption
} // namespace watermelondb
