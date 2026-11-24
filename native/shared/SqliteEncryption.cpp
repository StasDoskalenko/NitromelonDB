#include "SqliteEncryption.h"

#include <cstdio>
#include <cstring>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace watermelondb {
namespace encryption {

namespace {

const char kPlainHeader[16] = "SQLite format 3"; // with the trailing NUL, like the file

// The first bytes of a rollback journal with a transaction in it (SQLite's aJournalMagic)
const unsigned char kJournalMagic[8] = {0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7};

const char *kSwitchHint =
    "Turn on the encryption build with \"nitromelondb\": { \"encryption\": true } in the app's package.json "
    "(or NITROMELONDB_ENCRYPTION=1), then rebuild the native app: run pod install again on iOS. If it's "
    "already on, check the build log for \"SQLite encryption build\": the switch may be in a package.json "
    "that isn't the app's, or NITROMELONDB_ENCRYPTION=0 may be set. "
    "See https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Encryption";

bool isMemoryName(const std::string &path) {
    return path.empty() || path == ":memory:" || path.find("mode=memory") != std::string::npos;
}

// `file:` URI -> filesystem path (no percent-decoding: NitromelonDB's own names never need it)
std::string fileUriToPath(const std::string &uri) {
    std::string path = uri.substr(5);
    size_t query = path.find('?');
    if (query != std::string::npos) {
        path = path.substr(0, query);
    }
    if (path.rfind("//", 0) == 0) {
        // file://host/path: SQLite accepts only an empty host or "localhost"
        size_t slash = path.find('/', 2);
        path = slash == std::string::npos ? "" : path.substr(slash);
    }
    return path;
}

// The file behind a database name, or "" for an in-memory one
std::string filePath(const std::string &resolvedPath) {
    if (isMemoryName(resolvedPath)) {
        return "";
    }
    std::string path = resolvedPath.rfind("file:", 0) == 0 ? fileUriToPath(resolvedPath) : resolvedPath;
    return path == ":memory:" ? "" : path;
}

// Database paths are UTF-8, like SQLite's. On Windows, the narrow C functions would read them in
// the ANSI code page (and /sdl rejects fopen as deprecated).
#if defined(_WIN32)
std::wstring widePath(const std::string &path) {
    int size = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, nullptr, 0);
    if (size <= 0) {
        return L"";
    }
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &result[0], size);
    result.resize(static_cast<size_t>(size - 1));
    return result;
}
#endif

FILE *openForReading(const std::string &path) {
#if defined(_WIN32)
    FILE *file = nullptr;
    return _wfopen_s(&file, widePath(path).c_str(), L"rb") == 0 ? file : nullptr;
#else
    return std::fopen(path.c_str(), "rb");
#endif
}

// Reads up to `size` bytes from the start of the file. Returns how many were read (0: none, or no file)
size_t readStart(const std::string &path, void *buffer, size_t size) {
    FILE *file = openForReading(path);
    if (!file) {
        return 0;
    }
    size_t read = std::fread(buffer, 1, size, file);
    std::fclose(file);
    return read;
}

void removeFile(const std::string &path) {
#if defined(_WIN32)
    DeleteFileW(widePath(path).c_str());
#else
    unlink(path.c_str());
#endif
}

void removeDatabaseFiles(const std::string &path) {
    for (const char *suffix : {"", "-journal", "-wal", "-shm"}) {
        removeFile(path + suffix);
    }
}

#if NITROMELON_ENCRYPTION

const int kOpenFlags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI;

// Every keyed connection, as SQLCipher sets up its own: temp files (big sorts, index builds, vacuum)
// aren't encrypted, so they stay in memory; and deleted content is zeroed rather than left in free
// pages (secure_delete, on by default in SQLCipher since 2.0.5)
const char *const kKeyedConnectionSql = "pragma temp_store = memory; pragma secure_delete = on;";

// Without a trailing period, so it can go in the middle of a sentence
std::string errorMessage(sqlite3 *db) {
    const char *message = db ? sqlite3_errmsg(db) : nullptr;
    std::string result = message ? message : "unknown error";
    while (!result.empty() && result.back() == '.') {
        result.pop_back();
    }
    return result;
}

int exec(sqlite3 *db, const char *sql) {
    return sqlite3_exec(db, sql, nullptr, nullptr, nullptr);
}

std::string scalarText(sqlite3 *db, const char *sql) {
    sqlite3_stmt *statement = nullptr;
    std::string result;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) {
        const unsigned char *text = sqlite3_column_text(statement, 0);
        result = text ? reinterpret_cast<const char *>(text) : "";
    }
    sqlite3_finalize(statement);
    return result;
}

// A filesystem path as a `file:` URI, for SQL (VACUUM INTO): everything but unreserved characters,
// '/' and ':' percent-encoded, so it can't break out of the SQL string either
std::string fileUri(const std::string &path) {
    static const char *hex = "0123456789ABCDEF";
    std::string normalized = path;
    for (char &c : normalized) {
        if (c == '\\') {
            c = '/';
        }
    }
    std::string uri = normalized.rfind("/", 0) == 0 ? "file://" : "file:///"; // C:/... on Windows
    for (unsigned char c : normalized) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '.' ||
            c == '_' || c == '~' || c == '/' || c == ':') {
            uri += static_cast<char>(c);
        } else {
            uri += '%';
            uri += hex[c >> 4];
            uri += hex[c & 15];
        }
    }
    return uri;
}

// sqlite3mc can't key in-memory or temporary databases (and there's nothing on disk to protect)
void requireFile(sqlite3 *db) {
    const char *filename = sqlite3_db_filename(db, "main");
    if (!filename || !*filename) {
        throw EncryptionError("encryption_unavailable",
                              "In-memory databases can't be encrypted: nothing is written to disk. Give SQLiteAdapter "
                              "a dbName that names a file.");
    }
}

// Flushes a file to the disk, so a power loss can't leave the copy half-written once it replaced
// the database. (A killed app doesn't need it: the OS writes its cache out anyway.)
bool syncFile(const std::string &path) {
#if defined(_WIN32)
    HANDLE handle = CreateFileW(widePath(path).c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        return false;
    }
    bool synced = FlushFileBuffers(handle) != 0;
    CloseHandle(handle);
    return synced;
#else
    int fd = open(path.c_str(), O_RDONLY);
    if (fd < 0) {
        return false;
    }
#if defined(__APPLE__)
    // fsync only reaches the drive's cache on Apple platforms
    bool synced = fcntl(fd, F_FULLFSYNC) == 0 || fsync(fd) == 0;
#else
    bool synced = fsync(fd) == 0;
#endif
    close(fd);
    return synced;
#endif
}

// Atomically replaces `to` with `from`
bool replaceFile(const std::string &from, const std::string &to) {
#if defined(_WIN32)
    return MoveFileExW(widePath(from).c_str(), widePath(to).c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) !=
           0;
#else
    if (std::rename(from.c_str(), to.c_str()) != 0) {
        return false;
    }
    // Make the rename itself durable
    size_t slash = to.rfind('/');
    std::string dirPath = slash == std::string::npos ? "." : (slash == 0 ? "/" : to.substr(0, slash));
    int dir = open(dirPath.c_str(), O_RDONLY);
    if (dir >= 0) {
        fsync(dir);
        close(dir);
    }
    return true;
#endif
}

// Rolls back a hot journal with a connection keyed with `passphrase` (or not). Returns whether it's
// gone. A connection with the wrong key fails to read and changes nothing.
bool rollBackJournal(const std::string &resolvedPath, const std::string &passphrase) {
    sqlite3 *db = nullptr;
    // No SQLITE_OPEN_CREATE: the database exists
    if (sqlite3_open_v2(resolvedPath.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_URI, nullptr) != SQLITE_OK) {
        sqlite3_close(db);
        return false;
    }
    if (!passphrase.empty()) {
        sqlite3_key_v2(db, "main", passphrase.data(), static_cast<int>(passphrase.size()));
    }
    // The first read rolls the journal back
    int result = exec(db, "select count(*) from sqlite_master");
    sqlite3_close(db);
    return result == SQLITE_OK && !hasHotJournal(resolvedPath);
}

bool leaveWal(sqlite3 *db) {
    if (scalarText(db, "pragma journal_mode") != "wal") {
        return false;
    }
    exec(db, "pragma journal_mode = delete");
    if (scalarText(db, "pragma journal_mode") == "wal") {
        throw EncryptionError("rekey_failed",
                              "Couldn't leave WAL mode to change the encryption key (is another connection open?): " +
                                  errorMessage(db));
    }
    return true;
}

sqlite3 *openKeyed(const std::string &resolvedPath, const std::string &passphrase) {
    sqlite3 *db = nullptr;
    if (sqlite3_open_v2(resolvedPath.c_str(), &db, kOpenFlags, nullptr) != SQLITE_OK) {
        std::string error = errorMessage(db);
        sqlite3_close(db);
        throw std::runtime_error("Couldn't open the database again after changing its encryption key: " + error);
    }
    if (!passphrase.empty()) {
        sqlite3_key_v2(db, "main", passphrase.data(), static_cast<int>(passphrase.size()));
        exec(db, kKeyedConnectionSql);
    }
    return db;
}

void decryptByCopy(sqlite3 *&db, const std::string &resolvedPath, const std::string &currentPassphrase,
                   bool &reopened) {
    std::string path = filePath(resolvedPath);
    std::string copy = decryptedCopyPath(resolvedPath);
    removeDatabaseFiles(copy);

    // No WAL from here on: the file gets replaced, and a WAL next to it would belong to the old one
    bool wasWal = leaveWal(db);
    auto fail = [&](const std::string &message) {
        removeDatabaseFiles(copy);
        if (wasWal && db) {
            exec(db, "pragma journal_mode = wal");
        }
        throw EncryptionError("rekey_failed", message + ". The database is still encrypted, with the same passphrase.");
    };

    // `?key=` with nothing: sqlite3mc writes the copy unencrypted
    std::string sql = "vacuum into '" + fileUri(copy) + "?key='";
    if (exec(db, sql.c_str()) != SQLITE_OK) {
        fail("Couldn't write a decrypted copy of the database (is there enough free space?): " + errorMessage(db));
    }
    if (!syncFile(copy)) {
        fail("Couldn't flush the decrypted copy of the database to disk");
    }

    // Statements left over would keep the connection (and on Windows the file) open
    sqlite3_stmt *statement;
    while ((statement = sqlite3_next_stmt(db, nullptr))) {
        sqlite3_finalize(statement);
    }
    if (sqlite3_close(db) != SQLITE_OK) {
        fail("Couldn't close the database to replace it: " + errorMessage(db));
    }
    db = nullptr;
    reopened = true;

    if (!replaceFile(copy, path)) {
        // Still the encrypted file: open it again as it was
        removeDatabaseFiles(copy);
        db = openKeyed(resolvedPath, currentPassphrase);
        throw EncryptionError("rekey_failed", "Couldn't replace the database with its decrypted copy. The database is "
                                              "still encrypted, with the same passphrase.");
    }
    db = openKeyed(resolvedPath, "");
}

#endif

} // namespace

EncryptionError::EncryptionError(const std::string &code, const std::string &message)
    : std::runtime_error("[" + code + "] " + message), code(code) {}

bool isAvailable() {
#if NITROMELON_ENCRYPTION
    return true;
#else
    return false;
#endif
}

std::string decryptedCopyPath(const std::string &resolvedPath) {
    return filePath(resolvedPath) + "-nitromelon-decrypted";
}

FileState probeFile(const std::string &resolvedPath) {
    std::string path = filePath(resolvedPath);
    if (path.empty()) {
        return FileState::Missing;
    }
    char header[sizeof(kPlainHeader)] = {0};
    size_t read = readStart(path, header, sizeof(header));
    if (read == 0) {
        // No file, or SQLite created it empty (it writes the header with the first transaction)
        return FileState::Missing;
    }
    if (read == sizeof(header) && std::memcmp(header, kPlainHeader, sizeof(header)) == 0) {
        return FileState::Unencrypted;
    }
    return FileState::Encrypted;
}

const char *fileStateName(FileState state) {
    switch (state) {
    case FileState::Missing:
        return "missing";
    case FileState::Unencrypted:
        return "unencrypted";
    case FileState::Encrypted:
        return "encrypted";
    }
    return "missing";
}

bool hasHotJournal(const std::string &resolvedPath) {
    std::string path = filePath(resolvedPath);
    if (path.empty()) {
        return false;
    }
    unsigned char magic[sizeof(kJournalMagic)] = {0};
    return readStart(path + "-journal", magic, sizeof(magic)) == sizeof(magic) &&
           std::memcmp(magic, kJournalMagic, sizeof(magic)) == 0;
}

void recoverInterruptedRekey(const std::string &resolvedPath, const std::string &passphrase) {
    std::string path = filePath(resolvedPath);
    if (path.empty()) {
        return;
    }
    // A decrypt killed before it replaced the database: the database is untouched
    removeDatabaseFiles(decryptedCopyPath(resolvedPath));

#if NITROMELON_ENCRYPTION
    if (!hasHotJournal(resolvedPath)) {
        return;
    }
    // Before an encrypt the database had no key; before a key change, the old one (which the app
    // may still pass while it saves the new one)
    if (!passphrase.empty() && rollBackJournal(resolvedPath, passphrase)) {
        return;
    }
    rollBackJournal(resolvedPath, "");
#else
    // Without the codec, SQLite rolls a journal back itself on the first read, as always
    (void)passphrase;
#endif
}

bool openWithKey(sqlite3 *db, FileState state, const std::string &passphrase, bool allowUnencrypted) {
    if (passphrase.empty()) {
        if (state == FileState::Encrypted) {
            throw EncryptionError("encryption_key_required",
                                  "The database is encrypted (or isn't a SQLite database), and no passphrase was given. "
                                  "Pass the passphrase it was encrypted with as `encryption.passphrase`. NitromelonDB "
                                  "didn't change the file.");
        }
        return false;
    }

    if (!isAvailable()) {
        throw EncryptionError("encryption_unavailable",
                              std::string("A passphrase was given, but this build of NitromelonDB has no encryption, so "
                                          "the database would not be encrypted. ") +
                                  kSwitchHint);
    }

    if (state == FileState::Unencrypted) {
        if (!allowUnencrypted) {
            throw EncryptionError(
                "database_not_encrypted",
                "A passphrase was given, but the database on disk isn't encrypted. To open it and encrypt it, pass "
                "`encryption: { ifUnencrypted: 'open' }` and call database.unsafe_EncryptDB(passphrase) in a writer. "
                "NitromelonDB didn't change the file.");
        }
        return false;
    }

#if NITROMELON_ENCRYPTION
    requireFile(db);
    // sqlite3_key_v2, never PRAGMA key: SQL text can end up in error messages and traces
    if (sqlite3_key_v2(db, "main", passphrase.data(), static_cast<int>(passphrase.size())) != SQLITE_OK) {
        throw EncryptionError("encryption_key_invalid", "Couldn't apply the passphrase: " + errorMessage(db));
    }
    // The key is only checked when the first page is read
    int result = exec(db, "select count(*) from sqlite_master");
    if (result == SQLITE_NOTADB) {
        const char *filename = sqlite3_db_filename(db, "main");
        bool interrupted = filename && hasHotJournal(filename);
        throw EncryptionError(
            "encryption_key_invalid",
            interrupted
                ? "The passphrase is wrong. A change of the database's passphrase was interrupted (the app was "
                  "closed during database.unsafe_EncryptDB()), so the database still has its previous passphrase: "
                  "open it with that one. NitromelonDB didn't change the file."
                : "The passphrase is wrong, or the file isn't a database encrypted by NitromelonDB or SQLCipher 4. "
                  "NitromelonDB didn't change the file.");
    }
    if (result != SQLITE_OK) {
        throw std::runtime_error("Couldn't read the encrypted database: " + errorMessage(db));
    }
    exec(db, kKeyedConnectionSql);
    return true;
#else
    (void)db;
    return false;
#endif
}

void rekey(sqlite3 *&db, const std::string &resolvedPath, const std::string &currentPassphrase,
           const std::string &newPassphrase, bool &reopened) {
    reopened = false;
#if NITROMELON_ENCRYPTION
    requireFile(db);
    if (!sqlite3_get_autocommit(db)) {
        throw EncryptionError("rekey_failed", "Can't change the encryption key while a transaction is open.");
    }
    if (newPassphrase.empty()) {
        if (!currentPassphrase.empty()) {
            decryptByCopy(db, resolvedPath, currentPassphrase, reopened);
        }
        return; // (not encrypted: nothing to do)
    }

    bool wasWal = leaveWal(db);
    int result = sqlite3_rekey_v2(db, "main", newPassphrase.data(), static_cast<int>(newPassphrase.size()));
    std::string error = result == SQLITE_OK ? "" : errorMessage(db);
    if (wasWal) {
        exec(db, "pragma journal_mode = wal");
    }
    if (result != SQLITE_OK) {
        throw EncryptionError("rekey_failed",
                              "Couldn't change the encryption key: " + error + ". The database keeps its previous key.");
    }
    exec(db, kKeyedConnectionSql);
#else
    (void)db;
    (void)resolvedPath;
    (void)currentPassphrase;
    (void)newPassphrase;
    throw EncryptionError("encryption_unavailable",
                          std::string("This build of NitromelonDB has no encryption. ") + kSwitchHint);
#endif
}

} // namespace encryption
} // namespace watermelondb
