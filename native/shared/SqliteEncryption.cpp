#include "SqliteEncryption.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>

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

// A plain database's header is plain all the way; one with a plaintext header (32 bytes) is
// encrypted from byte 32 on. Bytes 56-59 are the text encoding: 1, 2 or 3 in a plain database (0
// in a new one whose schema is still in the WAL), and random in an encrypted one (the chance it
// looks valid is 1 in a billion). (Not the reserved bytes,
// header byte 20: a database decrypted with VACUUM INTO keeps SQLCipher's 80.)
const size_t kTextEncodingOffset = 56;
const size_t kHeaderBytesToProbe = kTextEncodingOffset + 4;

// The first bytes of a rollback journal with a transaction in it (SQLite's aJournalMagic)
const unsigned char kJournalMagic[8] = {0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7};

const char *kSwitchHint =
    "Turn on the encryption build with \"nitromelondb\": { \"encryption\": true } in the app's package.json "
    "(or NITROMELONDB_ENCRYPTION=1), then rebuild the native app: run pod install again on iOS. If it's "
    "already on, check the build log for \"SQLite encryption build\": the switch may be in a package.json "
    "that isn't the app's, or NITROMELONDB_ENCRYPTION=0 may be set. "
    "See https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Setup";

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

// 0 when there's no file
int64_t fileSize(const std::string &path) {
#if defined(_WIN32)
    struct _stat64 info;
    return _wstat64(widePath(path).c_str(), &info) == 0 ? static_cast<int64_t>(info.st_size) : 0;
#else
    struct stat info;
    return stat(path.c_str(), &info) == 0 ? static_cast<int64_t>(info.st_size) : 0;
#endif
}

#if NITROMELON_ENCRYPTION

const int kOpenFlags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI;

const size_t kSaltHexLength = 32;

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

int64_t scalarInt(sqlite3 *db, const char *sql) {
    sqlite3_stmt *statement = nullptr;
    int64_t result = 0;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK && sqlite3_step(statement) == SQLITE_ROW) {
        result = sqlite3_column_int64(statement, 0);
    }
    sqlite3_finalize(statement);
    return result;
}

// Keeps a RekeyProgress up to date for the duration of a rekey(), and marks it done however rekey()
// ends
class ProgressScope {
public:
    ProgressScope(RekeyProgress *progress, sqlite3 *db, const std::string &resolvedPath,
                  RekeyProgress::Operation operation)
        : progress_(progress) {
        if (!progress_) {
            return;
        }
        int64_t pageSize = scalarInt(db, "pragma page_size");
        int64_t pageCount = scalarInt(db, "pragma page_count");
        // A decrypted copy (VACUUM INTO) leaves out the free pages
        int64_t pages = operation == RekeyProgress::Operation::Decrypt
                            ? pageCount - scalarInt(db, "pragma freelist_count")
                            : pageCount;
        progress_->begin(operation, filePath(resolvedPath), pages * pageSize, pages);
        if (operation == RekeyProgress::Operation::Encrypt) {
            db_ = db;
            // Every 1000 virtual machine instructions of the VACUUM's statements: often enough for a
            // smooth bar, and a cheap call. The copy over the file that follows runs no statements;
            // the journal shows that half
            sqlite3_progress_handler(db, 1000, &ProgressScope::onProgress, this);
        }
    }

    ~ProgressScope() {
        if (db_) {
            sqlite3_progress_handler(db_, 0, nullptr, nullptr);
        }
        if (progress_) {
            progress_->end();
        }
    }

    ProgressScope(const ProgressScope &) = delete;
    ProgressScope &operator=(const ProgressScope &) = delete;

private:
    // On the re-key's thread, inside the VACUUM's statements
    static int onProgress(void *context) {
        auto *scope = static_cast<ProgressScope *>(context);
        int pages = nitromelon_sqlite3_vacuum_page_count(scope->db_);
        if (pages > 0) {
            scope->progress_->setBuiltPages(pages);
        }
        return 0; // (non-zero would interrupt it)
    }

    RekeyProgress *progress_;
    sqlite3 *db_ = nullptr;
};

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

bool isHexSalt(const std::string &salt) {
    if (salt.size() != kSaltHexLength) {
        return false;
    }
    for (char c : salt) {
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
            return false;
        }
    }
    return true;
}

// The salt in a database's salt file, or "" when there's none (or it isn't 32 hex digits)
std::string readSalt(const std::string &resolvedPath) {
    char buffer[kSaltHexLength] = {0};
    if (readStart(saltFilePath(resolvedPath), buffer, sizeof(buffer)) != sizeof(buffer)) {
        return "";
    }
    std::string salt(buffer, sizeof(buffer));
    return isHexSalt(salt) ? salt : "";
}

FILE *openForWriting(const std::string &path) {
#if defined(_WIN32)
    FILE *file = nullptr;
    return _wfopen_s(&file, widePath(path).c_str(), L"wb") == 0 ? file : nullptr;
#else
    return std::fopen(path.c_str(), "wb");
#endif
}

bool syncFile(const std::string &path);
bool replaceFile(const std::string &from, const std::string &to);

// Writes the salt file, durably and atomically (a new file, flushed, renamed over the old one), so
// that it's complete on disk before the database depends on it
bool writeSalt(const std::string &resolvedPath, const std::string &salt) {
    std::string path = saltFilePath(resolvedPath);
    std::string temporary = path + "-new";
    FILE *file = openForWriting(temporary);
    if (!file) {
        return false;
    }
    bool written = std::fwrite(salt.data(), 1, salt.size(), file) == salt.size();
    written = std::fclose(file) == 0 && written;
    if (!written || !syncFile(temporary) || !replaceFile(temporary, path)) {
        removeFile(temporary);
        return false;
    }
    return true;
}

// Sets up an unkeyed connection to read (and create) a database with a plaintext header and this
// salt, or without a plaintext header. Before sqlite3_key_v2: sqlite3mc reads both when keying.
// (Salts aren't secret, so they can go in SQL; passphrases never do.)
void configureLayout(sqlite3 *db, bool plaintextHeader, const std::string &salt) {
    sqlite3mc_config_cipher(db, "sqlcipher", "plaintext_header_size", plaintextHeader ? kPlaintextHeaderSize : 0);
    if (plaintextHeader) {
        std::string sql = "pragma cipher_salt = '" + salt + "'"; // isHexSalt: nothing to escape
        exec(db, sql.c_str());
    }
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
bool rollBackJournal(const std::string &resolvedPath, const std::string &passphrase,
                     const std::string &plaintextHeaderSalt = "") {
    sqlite3 *db = nullptr;
    // No SQLITE_OPEN_CREATE: the database exists
    if (sqlite3_open_v2(resolvedPath.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_URI, nullptr) != SQLITE_OK) {
        sqlite3_close(db);
        return false;
    }
    if (!passphrase.empty()) {
        configureLayout(db, !plaintextHeaderSalt.empty(), plaintextHeaderSalt);
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

sqlite3 *openKeyed(const std::string &resolvedPath, const std::string &passphrase,
                   const std::string &plaintextHeaderSalt = "") {
    sqlite3 *db = nullptr;
    if (sqlite3_open_v2(resolvedPath.c_str(), &db, kOpenFlags, nullptr) != SQLITE_OK) {
        std::string error = errorMessage(db);
        sqlite3_close(db);
        throw std::runtime_error("Couldn't open the database again after changing its encryption key: " + error);
    }
    if (!passphrase.empty()) {
        configureLayout(db, !plaintextHeaderSalt.empty(), plaintextHeaderSalt);
        sqlite3_key_v2(db, "main", passphrase.data(), static_cast<int>(passphrase.size()));
        exec(db, kKeyedConnectionSql);
    }
    return db;
}

void decryptByCopy(sqlite3 *&db, const std::string &resolvedPath, const std::string &currentPassphrase,
                   const std::string &plaintextHeaderSalt, bool &reopened) {
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
        db = openKeyed(resolvedPath, currentPassphrase, plaintextHeaderSalt);
        throw EncryptionError("rekey_failed", "Couldn't replace the database with its decrypted copy. The database is "
                                              "still encrypted, with the same passphrase.");
    }
    db = openKeyed(resolvedPath, "");
    removeFile(saltFilePath(resolvedPath)); // (if it had a plaintext header)
}

#endif

} // namespace

EncryptionError::EncryptionError(const std::string &code, const std::string &message)
    : std::runtime_error("[" + code + "] " + message), code(code) {}

void RekeyProgress::begin(Operation operation, const std::string &filePath, int64_t expectedBytes,
                          int64_t expectedPages) {
    const std::lock_guard<std::mutex> lock(mutex_);
    running_ = true;
    operation_ = operation;
    filePath_ = filePath;
    expectedBytes_ = expectedBytes;
    expectedPages_ = expectedPages;
    builtPages_ = 0;
    last_ = 0;
}

void RekeyProgress::setBuiltPages(int64_t pages) {
    builtPages_ = pages;
}

void RekeyProgress::end() {
    const std::lock_guard<std::mutex> lock(mutex_);
    running_ = false;
}

double RekeyProgress::fraction() const {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (!running_) {
        return -1;
    }
    auto ratio = [](int64_t done, int64_t total) {
        return total > 0 ? std::min(1.0, static_cast<double>(done) / static_cast<double>(total)) : 0.0;
    };
    double current = 0;
    switch (operation_) {
    case Operation::Decrypt:
        current = ratio(fileSize(filePath_ + "-nitromelon-decrypted"), expectedBytes_);
        break;
    case Operation::Rekey:
        current = ratio(fileSize(filePath_ + "-journal"), expectedBytes_);
        break;
    case Operation::Encrypt: {
        double journaled = ratio(fileSize(filePath_ + "-journal"), expectedBytes_);
        int64_t built = builtPages_;
        if (built == 0) {
            // No VACUUM (yet, or at all: a plain database that already had room for the HMAC is
            // rewritten in place like a key change)
            current = journaled;
        } else {
            // Once the copy has started, the temporary database is complete
            current = journaled > 0 ? 0.5 + 0.5 * journaled : 0.5 * ratio(built, expectedPages_);
        }
        break;
    }
    }
    last_ = std::max(last_, current);
    return last_;
}

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

std::string saltFilePath(const std::string &resolvedPath) {
    return filePath(resolvedPath) + "-nitromelon-salt";
}

FileState probeFile(const std::string &resolvedPath) {
    std::string path = filePath(resolvedPath);
    if (path.empty()) {
        return FileState::Missing;
    }
    unsigned char header[kHeaderBytesToProbe] = {0};
    size_t read = readStart(path, header, sizeof(header));
    if (read == 0) {
        // No file, or SQLite created it empty (it writes the header with the first transaction)
        return FileState::Missing;
    }
    if (read < sizeof(kPlainHeader) || std::memcmp(header, kPlainHeader, sizeof(kPlainHeader)) != 0) {
        return FileState::Encrypted;
    }
    const unsigned char *encoding = header + kTextEncodingOffset;
    bool plainEncoding = read == sizeof(header) && encoding[0] == 0 && encoding[1] == 0 && encoding[2] == 0 &&
                         encoding[3] <= 3;
    return plainEncoding || read < sizeof(header) ? FileState::Unencrypted : FileState::EncryptedPlaintextHeader;
}

const char *fileStateName(FileState state) {
    switch (state) {
    case FileState::Missing:
        return "missing";
    case FileState::Unencrypted:
        return "unencrypted";
    case FileState::Encrypted:
    case FileState::EncryptedPlaintextHeader:
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
    // may still pass while it saves the new one), with or without a plaintext header. A change of
    // layout keeps the salt, and writes the salt file first, so it's there to roll back with
    if (!passphrase.empty()) {
        if (rollBackJournal(resolvedPath, passphrase)) {
            return;
        }
        std::string salt = readSalt(resolvedPath);
        if (!salt.empty() && rollBackJournal(resolvedPath, passphrase, salt)) {
            return;
        }
    }
    rollBackJournal(resolvedPath, "");
#else
    // Without the codec, SQLite rolls a journal back itself on the first read, as always
    (void)passphrase;
#endif
}

bool openWithKey(sqlite3 *db, FileState state, const std::string &passphrase, bool allowUnencrypted,
                 bool plaintextHeader) {
    if (passphrase.empty()) {
        if (state == FileState::Encrypted || state == FileState::EncryptedPlaintextHeader) {
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
    const char *filename = sqlite3_db_filename(db, "main");
    std::string resolvedPath = filename ? filename : "";
    if (state == FileState::EncryptedPlaintextHeader) {
        std::string salt = readSalt(resolvedPath);
        if (salt.empty()) {
            throw EncryptionError(
                "encryption_salt_missing",
                "The database is encrypted with a plaintext header (encryption.plaintextHeader), and its salt file (" +
                    saltFilePath(resolvedPath) +
                    ") is missing or damaged, so it can't be opened. The salt file must stay next to the database: "
                    "copy, back up and delete them together. NitromelonDB didn't change the file.");
        }
        configureLayout(db, true, salt);
    } else if (state == FileState::Missing && plaintextHeader) {
        // A new database: its salt is saved before anything is written with it
        unsigned char raw[kSaltHexLength / 2];
        sqlite3_randomness(sizeof(raw), raw);
        static const char *hex = "0123456789abcdef";
        std::string salt;
        for (unsigned char byte : raw) {
            salt += hex[byte >> 4];
            salt += hex[byte & 15];
        }
        if (!writeSalt(resolvedPath, salt)) {
            throw std::runtime_error("Couldn't write the database's salt file (" + saltFilePath(resolvedPath) +
                                     "). Is there enough free space?");
        }
        configureLayout(db, true, salt);
    }
    // sqlite3_key_v2, never PRAGMA key: SQL text can end up in error messages and traces
    if (sqlite3_key_v2(db, "main", passphrase.data(), static_cast<int>(passphrase.size())) != SQLITE_OK) {
        throw EncryptionError("encryption_key_invalid", "Couldn't apply the passphrase: " + errorMessage(db));
    }
    // The key is only checked when the first page is read
    int result = exec(db, "select count(*) from sqlite_master");
    if (result == SQLITE_NOTADB) {
        bool interrupted = hasHotJournal(resolvedPath);
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
    (void)plaintextHeader;
    return false;
#endif
}

void rekey(sqlite3 *&db, const std::string &resolvedPath, const std::string &currentPassphrase,
           const std::string &newPassphrase, bool &reopened, RekeyProgress *progress, bool plaintextHeader) {
    reopened = false;
#if NITROMELON_ENCRYPTION
    requireFile(db);
    if (!sqlite3_get_autocommit(db)) {
        throw EncryptionError("rekey_failed", "Can't change the encryption key while a transaction is open.");
    }
    // The database's salt, if it has a plaintext header now (the file's header says so; it's on disk
    // even in WAL mode)
    std::string currentSalt =
        !currentPassphrase.empty() && probeFile(resolvedPath) == FileState::EncryptedPlaintextHeader
            ? readSalt(resolvedPath)
            : "";
    if (newPassphrase.empty()) {
        if (!currentPassphrase.empty()) {
            ProgressScope scope(progress, db, resolvedPath, RekeyProgress::Operation::Decrypt);
            decryptByCopy(db, resolvedPath, currentPassphrase, currentSalt, reopened);
        }
        return; // (not encrypted: nothing to do)
    }

    ProgressScope scope(progress, db, resolvedPath,
                        currentPassphrase.empty() ? RekeyProgress::Operation::Encrypt
                                                  : RekeyProgress::Operation::Rekey);
    bool wasWal = leaveWal(db);
    auto restoreWal = [&]() {
        if (wasWal) {
            exec(db, "pragma journal_mode = wal");
        }
    };
    // The layout to write. sqlite3mc resets this after every key change, so it's set every time
    sqlite3mc_config_cipher(db, "sqlcipher", "plaintext_header_size", plaintextHeader ? kPlaintextHeaderSize : 0);
    bool newSalt = false;
    if (plaintextHeader) {
        // Keep the key's salt (a killed re-key then rolls back with the same salt file); a plain
        // database has none yet, so it gets a new one, which sqlite3mc uses for the re-key
        newSalt = currentPassphrase.empty();
        std::string salt = newSalt ? scalarText(db, "pragma rekey_salt = on") : scalarText(db, "pragma cipher_salt");
        if (!isHexSalt(salt) || !writeSalt(resolvedPath, salt)) {
            if (newSalt) {
                exec(db, "pragma rekey_salt = off");
            }
            restoreWal();
            throw EncryptionError("rekey_failed", "Couldn't write the database's salt file (" +
                                                      saltFilePath(resolvedPath) +
                                                      "). The database keeps its previous key.");
        }
    }
    int result = sqlite3_rekey_v2(db, "main", newPassphrase.data(), static_cast<int>(newPassphrase.size()));
    std::string error = result == SQLITE_OK ? "" : errorMessage(db);
    if (newSalt) {
        exec(db, "pragma rekey_salt = off");
    }
    restoreWal();
    if (result != SQLITE_OK) {
        throw EncryptionError("rekey_failed",
                              "Couldn't change the encryption key: " + error + ". The database keeps its previous key.");
    }
    if (!plaintextHeader && !currentSalt.empty()) {
        // No plaintext header any more: the salt is back in the file
        removeFile(saltFilePath(resolvedPath));
    }
    exec(db, kKeyedConnectionSql);
#else
    (void)db;
    (void)resolvedPath;
    (void)currentPassphrase;
    (void)newPassphrase;
    (void)progress;
    (void)plaintextHeader;
    throw EncryptionError("encryption_unavailable",
                          std::string("This build of NitromelonDB has no encryption. ") + kSwitchHint);
#endif
}

} // namespace encryption
} // namespace watermelondb
