#include "Database.h"

#include <stdexcept>
#include <type_traits>

// TODO: The split between Database-sqlite.cpp and Sqlite.cpp is confusing…
// Maybe we should either just merge them?
// Or create another layer of abstraction for JSI-capable SQlite, but without Watermelon-specific logic?
namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

sqlite3_stmt* Database::prepareQuery(std::string sql) {
    sqlite3_stmt *statement = cachedStatements_[sql];

    if (statement == nullptr) {
        int resultPrepare = sqlite3_prepare_v2(db_->sqlite, sql.c_str(), -1, &statement, nullptr);

        if (resultPrepare != SQLITE_OK) {
            sqlite3_finalize(statement);
            throwSqliteError("Failed to prepare query statement");
        }

        cachedStatements_[sql] = statement;
    } else {
        // in theory, this shouldn't be necessary, since statements ought to be reset *after* use, not before use
        // but still this might prevent some crashes if this is not done right
        // TODO: Remove this later - should not be necessary, and it wastes time
        sqlite3_reset(statement);
    }
    assert(statement != nullptr);
    return statement;
}

void Database::bindArgs(sqlite3_stmt *statement, jsi::Array &arguments) {
    auto &rt = getRt();
    int argsCount = sqlite3_bind_parameter_count(statement);

    if (argsCount != arguments.length(rt)) {
        sqlite3_reset(statement);
        throw jsi::JSError(rt, "Number of args passed to query doesn't match number of arg placeholders");
    }

    for (int i = 0; i < argsCount; i++) {
        jsi::Value value = arguments.getValueAtIndex(rt, i);

        int bindResult;
        if (value.isNull() || value.isUndefined()) {
            bindResult = sqlite3_bind_null(statement, i + 1);
        } else if (value.isString()) {
            bindResult = sqlite3_bind_text(statement, i + 1, value.getString(rt).utf8(rt).c_str(), -1, SQLITE_TRANSIENT);
        } else if (value.isNumber()) {
            bindResult = sqlite3_bind_double(statement, i + 1, value.getNumber());
        } else if (value.isBool()) {
            bindResult = sqlite3_bind_int(statement, i + 1, value.getBool());
        } else if (value.isObject()) {
            sqlite3_reset(statement);
            throw jsi::JSError(rt, "Invalid argument type (object) for query");
        } else {
            sqlite3_reset(statement);
            throw jsi::JSError(rt, "Invalid argument type (unknown) for query");
        }

        if (bindResult != SQLITE_OK) {
            sqlite3_reset(statement);
            throwSqliteError("Failed to bind an argument for query");
        }
    }
}

void Database::bindArgs(sqlite3_stmt *statement, const std::vector<SqliteValue> &arguments) {
    int argsCount = sqlite3_bind_parameter_count(statement);

    if (argsCount != static_cast<int>(arguments.size())) {
        sqlite3_reset(statement);
        throw std::runtime_error("Number of args passed to query doesn't match number of arg placeholders");
    }

    for (int i = 0; i < argsCount; i++) {
        int bindResult = std::visit(
            [&](auto &&value) -> int {
                using T = std::decay_t<decltype(value)>;
                if constexpr (std::is_same_v<T, std::nullptr_t>) {
                    return sqlite3_bind_null(statement, i + 1);
                } else if constexpr (std::is_same_v<T, bool>) {
                    return sqlite3_bind_int(statement, i + 1, value);
                } else if constexpr (std::is_same_v<T, double>) {
                    return sqlite3_bind_double(statement, i + 1, value);
                } else {
                    return sqlite3_bind_text(statement, i + 1, value.c_str(), -1, SQLITE_TRANSIENT);
                }
            },
            arguments[static_cast<size_t>(i)]);

        if (bindResult != SQLITE_OK) {
            sqlite3_reset(statement);
            throwSqliteError("Failed to bind an argument for query");
        }
    }
}

std::string Database::bindArgsAndReturnId(sqlite3_stmt *statement, simdjson::ondemand::array &args) {
    using namespace simdjson;
    std::string returnId = "";

    int argsCount = sqlite3_bind_parameter_count(statement);
    int i = 0;
    for (auto arg : args) {
        int bindResult;
        ondemand::json_type type = arg.type();

        if (type == ondemand::json_type::string) {
            std::string_view stringView = arg;
            bindResult = sqlite3_bind_text(statement, i + 1, stringView.data(), (int) stringView.length(), SQLITE_STATIC);
            if (i == 0) {
                returnId = std::string(stringView);
            }
        } else if (type == ondemand::json_type::number) {
            bindResult = sqlite3_bind_double(statement, i + 1, (double) arg);
        } else if (type == ondemand::json_type::boolean) {
            bindResult = sqlite3_bind_int(statement, i + 1, (bool) arg);
        } else if (type == ondemand::json_type::null) {
            bindResult = sqlite3_bind_null(statement, i + 1);
        } else {
            throw std::runtime_error("Invalid argument type for query - only strings, numbers, booleans and null are allowed");
        }

        i++;

        if (bindResult != SQLITE_OK) {
            sqlite3_reset(statement);
            throwSqliteError("Failed to bind an argument for query");
        }
    }

    if (argsCount != i) {
        sqlite3_reset(statement);
        throw std::runtime_error("Number of args passed to query doesn't match number of arg placeholders");
    }

    return returnId;
}

SqliteStatement Database::executeQuery(std::string sql, jsi::Array &arguments) {
    auto statement = prepareQuery(sql);
    bindArgs(statement, arguments);
    return SqliteStatement(statement);
}

SqliteStatement Database::executeQuery(std::string sql, const std::vector<SqliteValue> &arguments) {
    auto statement = prepareQuery(sql);
    bindArgs(statement, arguments);
    return SqliteStatement(statement);
}

void Database::executeUpdate(sqlite3_stmt *statement) {
    int stepResult = sqlite3_step(statement);

    if (stepResult != SQLITE_DONE) {
        throwSqliteError("Failed to execute db update");
    }
}

void Database::executeUpdate(std::string sql, jsi::Array &args) {
    auto stmt = prepareQuery(sql);
    bindArgs(stmt, args);
    SqliteStatement statement(stmt);
    executeUpdate(stmt);
}

void Database::executeUpdate(std::string sql, const std::vector<SqliteValue> &args) {
    auto stmt = prepareQuery(sql);
    bindArgs(stmt, args);
    SqliteStatement statement(stmt);
    executeUpdate(stmt);
}

void Database::executeUpdate(std::string sql) {
    auto stmt = prepareQuery(sql);
    SqliteStatement statement(stmt);
    executeUpdate(stmt);
}

void Database::getRow(sqlite3_stmt *stmt) {
    int result = sqlite3_step(stmt);

    if (result != SQLITE_ROW) {
        throwSqliteError("Failed to get a row for query");
    }
}

bool Database::getNextRowOrTrue(sqlite3_stmt *stmt) {
    int result = sqlite3_step(stmt);

    if (result == SQLITE_DONE) {
        return true;
    } else if (result != SQLITE_ROW) {
        throwSqliteError("Failed to get a row for query");
    }

    return false;
}

void Database::executeMultiple(std::string sql) {
    char *errmsg = nullptr;
    int resultExec = sqlite3_exec(db_->sqlite, sql.c_str(), nullptr, nullptr, &errmsg);

    if (errmsg) {
        std::string message(errmsg);
        sqlite3_free(errmsg);
        throw std::runtime_error(message);
    }

    if (resultExec != SQLITE_OK) {
        throwSqliteError("Failed to execute statements");
    }
}

SqliteValue Database::columnValue(sqlite3_stmt *statement, int i) {
    auto type = sqlite3_column_type(statement, i);
    if (type == SQLITE_INTEGER) {
        return static_cast<double>(sqlite3_column_int64(statement, i));
    }
    if (type == SQLITE_FLOAT) {
        return sqlite3_column_double(statement, i);
    }
    if (type == SQLITE_TEXT) {
        const char *text = reinterpret_cast<const char *>(sqlite3_column_text(statement, i));
        if (!text) {
            return nullptr;
        }
        return std::string(text);
    }
    if (type == SQLITE_NULL) {
        return nullptr;
    }
    throw std::runtime_error("Unable to fetch record from database - unknown column type (WatermelonDB does not support blobs or custom sqlite types");
}

SqliteRow Database::resultRow(sqlite3_stmt *statement) {
    SqliteRow row;
    for (int i = 0, len = sqlite3_column_count(statement); i < len; i++) {
        const char *column = sqlite3_column_name(statement, i);
        assert(column);
        row.emplace(column, columnValue(statement, i));
    }
    return row;
}

std::vector<SqliteValue> Database::resultValues(sqlite3_stmt *statement) {
    int count = sqlite3_column_count(statement);
    std::vector<SqliteValue> values;
    values.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; i++) {
        values.push_back(columnValue(statement, i));
    }
    return values;
}

std::vector<std::string> Database::resultColumnNames(sqlite3_stmt *statement) {
    int count = sqlite3_column_count(statement);
    std::vector<std::string> columns;
    columns.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; i++) {
        const char *column = sqlite3_column_name(statement, i);
        assert(column);
        columns.emplace_back(column);
    }
    return columns;
}

jsi::Value Database::sqliteValueToJsi(const SqliteValue &value) {
    auto &rt = getRt();
    return std::visit(
        [&](auto &&v) -> jsi::Value {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, std::nullptr_t>) {
                return jsi::Value::null();
            } else if constexpr (std::is_same_v<T, bool>) {
                return jsi::Value(v);
            } else if constexpr (std::is_same_v<T, double>) {
                return jsi::Value(v);
            } else {
                return jsi::String::createFromUtf8(rt, v);
            }
        },
        value);
}

jsi::Object Database::sqliteRowToJsi(const SqliteRow &row) {
    auto &rt = getRt();
    jsi::Object dictionary(rt);
    for (const auto &entry : row) {
        dictionary.setProperty(rt, entry.first.c_str(), sqliteValueToJsi(entry.second));
    }
    return dictionary;
}

jsi::Object Database::resultDictionary(sqlite3_stmt *statement) {
    return sqliteRowToJsi(resultRow(statement));
}

jsi::Array Database::resultArray(sqlite3_stmt *statement) {
    auto &rt = getRt();
    auto values = resultValues(statement);
    jsi::Array result(rt, values.size());
    for (size_t i = 0; i < values.size(); i++) {
        result.setValueAtIndex(rt, i, sqliteValueToJsi(values[i]));
    }
    return result;
}

jsi::Array Database::resultColumns(sqlite3_stmt *statement) {
    auto &rt = getRt();
    auto columns = resultColumnNames(statement);
    jsi::Array result(rt, columns.size());
    for (size_t i = 0; i < columns.size(); i++) {
        result.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, columns[i]));
    }
    return result;
}

void Database::beginTransaction() {
    // Exclusive transaction: this connection is serialized with mutex_, not
    // shared across threads. `deferred` is less likely to hit SQLITE_BUSY, but
    // exclusive is fine when we do not have concurrent readers on this handle.
    executeUpdate("begin exclusive transaction");
}

void Database::commit() {
    executeUpdate("commit transaction");
}

void Database::rollback() {
    // TODO: Use RAII to rollback automatically!
    consoleError("WatermelonDB sqlite transaction is being rolled back! This is BAD - it means that there's either a "
                 "WatermelonDB bug or a user issue (e.g. no empty disk space) that Watermelon may be unable to recover "
                 "from safely... Do investigate!");
    // NOTE: On some errors (like IO, memory errors), the transaction may be rolled back automatically
    // Attempting to roll it back ourselves would result in another error, which would hide the original error
    // According to https://sqlite.org/c3ref/get_autocommit.html , checking autocommit status is the only
    // way to find out whether that's the case. This feels wrong...
    // https://sqlite.org/lang_transaction.html recommends that we roll back anyway, since an error is
    // harmless.
    try {
        executeUpdate("rollback transaction");
    } catch (const std::exception &ex) {
        std::string errorMessage = "Error while attempting to roll back transaction, probably harmless: ";
        errorMessage += ex.what();
        consoleError(errorMessage);
    }
}

int Database::getUserVersion() {
    auto statement = executeQuery("pragma user_version", std::vector<SqliteValue>{});
    getRow(statement.stmt);

    assert(sqlite3_data_count(statement.stmt) == 1);

    int version = sqlite3_column_int(statement.stmt, 0);
    return version;
}

void Database::setUserVersion(int newVersion) {
    // NOTE: placeholders don't work, and ints are safe
    std::string sql = "pragma user_version = " + std::to_string(newVersion);
    executeUpdate(sql);
}

}
