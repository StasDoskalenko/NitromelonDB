#include "Database.h"

#include <cassert>
#include <stdexcept>

namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

namespace {

std::vector<SqliteValue> jsiArrayToSqliteArgs(jsi::Runtime &rt, jsi::Array &arguments) {
    std::vector<SqliteValue> args;
    size_t length = arguments.length(rt);
    args.reserve(length);
    for (size_t i = 0; i < length; i++) {
        jsi::Value value = arguments.getValueAtIndex(rt, i);
        if (value.isNull() || value.isUndefined()) {
            args.emplace_back(nullptr);
        } else if (value.isString()) {
            args.emplace_back(value.getString(rt).utf8(rt));
        } else if (value.isNumber()) {
            args.emplace_back(value.getNumber());
        } else if (value.isBool()) {
            args.emplace_back(value.getBool());
        } else {
            throw jsi::JSError(rt, "Invalid argument type for query");
        }
    }
    return args;
}

} // namespace

SqliteFindResult Database::find(const std::string &tableName, const std::string &id) {
    const std::lock_guard<std::mutex> lock(mutex_);

    if (isCached(cacheKey(tableName, id))) {
        return id;
    }

    auto statement = executeQuery("select * from `" + tableName + "` where id == ? limit 1", std::vector<SqliteValue>{id});

    if (getNextRowOrTrue(statement.stmt)) {
        return nullptr;
    }

    auto record = resultRow(statement.stmt);
    markAsCached(cacheKey(tableName, id));
    return record;
}

std::vector<SqliteQueryRecord> Database::query(const std::string &tableName, const std::string &sql,
                                               const std::vector<SqliteValue> &arguments) {
    const std::lock_guard<std::mutex> lock(mutex_);

    auto statement = executeQuery(sql, arguments);
    std::vector<SqliteQueryRecord> records;

    while (true) {
        if (getNextRowOrTrue(statement.stmt)) {
            break;
        }

        assert(std::string(sqlite3_column_name(statement.stmt, 0)) == "id");

        const char *id = reinterpret_cast<const char *>(sqlite3_column_text(statement.stmt, 0));
        if (!id) {
            throw std::runtime_error("Failed to get ID of a record");
        }

        if (isCached(cacheKey(tableName, std::string(id)))) {
            records.emplace_back(std::string(id));
        } else {
            markAsCached(cacheKey(tableName, std::string(id)));
            records.emplace_back(resultRow(statement.stmt));
        }
    }

    return records;
}

std::vector<SqliteQueryAsArrayItem> Database::queryAsArray(const std::string &tableName, const std::string &sql,
                                                           const std::vector<SqliteValue> &arguments) {
    const std::lock_guard<std::mutex> lock(mutex_);

    auto statement = executeQuery(sql, arguments);
    std::vector<SqliteQueryAsArrayItem> results;

    while (true) {
        if (getNextRowOrTrue(statement.stmt)) {
            break;
        }

        assert(std::string(sqlite3_column_name(statement.stmt, 0)) == "id");

        const char *id = reinterpret_cast<const char *>(sqlite3_column_text(statement.stmt, 0));
        if (!id) {
            throw std::runtime_error("Failed to get ID of a record");
        }

        if (results.empty()) {
            auto columns = resultColumnNames(statement.stmt);
            std::vector<SqliteValue> columnValues;
            columnValues.reserve(columns.size());
            for (const auto &column : columns) {
                columnValues.emplace_back(column);
            }
            results.emplace_back(std::move(columnValues));
        }

        if (isCached(cacheKey(tableName, std::string(id)))) {
            results.emplace_back(std::string(id));
        } else {
            markAsCached(cacheKey(tableName, std::string(id)));
            results.emplace_back(resultValues(statement.stmt));
        }
    }

    return results;
}

std::vector<std::string> Database::queryIds(const std::string &sql, const std::vector<SqliteValue> &arguments) {
    const std::lock_guard<std::mutex> lock(mutex_);

    auto statement = executeQuery(sql, arguments);
    std::vector<std::string> ids;

    while (true) {
        if (getNextRowOrTrue(statement.stmt)) {
            break;
        }

        assert(std::string(sqlite3_column_name(statement.stmt, 0)) == "id");

        const char *idText = reinterpret_cast<const char *>(sqlite3_column_text(statement.stmt, 0));
        if (!idText) {
            throw std::runtime_error("Failed to get ID of a record");
        }
        ids.emplace_back(idText);
    }

    return ids;
}

std::vector<SqliteRow> Database::unsafeQueryRaw(const std::string &sql, const std::vector<SqliteValue> &arguments) {
    const std::lock_guard<std::mutex> lock(mutex_);

    auto statement = executeQuery(sql, arguments);
    std::vector<SqliteRow> raws;

    while (true) {
        if (getNextRowOrTrue(statement.stmt)) {
            break;
        }
        raws.push_back(resultRow(statement.stmt));
    }

    return raws;
}

double Database::count(const std::string &sql, const std::vector<SqliteValue> &arguments) {
    const std::lock_guard<std::mutex> lock(mutex_);

    auto statement = executeQuery(sql, arguments);
    getRow(statement.stmt);

    assert(sqlite3_data_count(statement.stmt) == 1);
    return sqlite3_column_int(statement.stmt, 0);
}

std::optional<std::string> Database::getLocal(const std::string &key) {
    const std::lock_guard<std::mutex> lock(mutex_);

    auto statement = executeQuery("select value from local_storage where key = ?", std::vector<SqliteValue>{key});

    if (getNextRowOrTrue(statement.stmt)) {
        return std::nullopt;
    }

    assert(sqlite3_data_count(statement.stmt) == 1);
    const char *text = reinterpret_cast<const char *>(sqlite3_column_text(statement.stmt, 0));
    if (!text) {
        return std::nullopt;
    }
    return std::string(text);
}

jsi::Value Database::find(jsi::String &tableName, jsi::String &id) {
    auto &rt = getRt();
    auto result = find(tableName.utf8(rt), id.utf8(rt));
    if (std::holds_alternative<std::nullptr_t>(result)) {
        return jsi::Value::null();
    }
    if (std::holds_alternative<std::string>(result)) {
        return jsi::String::createFromUtf8(rt, std::get<std::string>(result));
    }
    return sqliteRowToJsi(std::get<SqliteRow>(result));
}

jsi::Value Database::query(jsi::String &tableName, jsi::String &sql, jsi::Array &arguments) {
    auto &rt = getRt();
    auto records = query(tableName.utf8(rt), sql.utf8(rt), jsiArrayToSqliteArgs(rt, arguments));
    std::vector<jsi::Value> values;
    values.reserve(records.size());
    for (auto &record : records) {
        if (std::holds_alternative<std::string>(record)) {
            values.emplace_back(jsi::String::createFromUtf8(rt, std::get<std::string>(record)));
        } else {
            values.emplace_back(sqliteRowToJsi(std::get<SqliteRow>(record)));
        }
    }
    return arrayFromStd(values);
}

jsi::Value Database::queryAsArray(jsi::String &tableName, jsi::String &sql, jsi::Array &arguments) {
    auto &rt = getRt();
    auto results = queryAsArray(tableName.utf8(rt), sql.utf8(rt), jsiArrayToSqliteArgs(rt, arguments));
    std::vector<jsi::Value> values;
    values.reserve(results.size());
    for (auto &item : results) {
        if (std::holds_alternative<std::string>(item)) {
            values.emplace_back(jsi::String::createFromUtf8(rt, std::get<std::string>(item)));
        } else {
            auto &row = std::get<std::vector<SqliteValue>>(item);
            jsi::Array array(rt, row.size());
            for (size_t i = 0; i < row.size(); i++) {
                array.setValueAtIndex(rt, i, sqliteValueToJsi(row[i]));
            }
            values.emplace_back(std::move(array));
        }
    }
    return arrayFromStd(values);
}

jsi::Array Database::queryIds(jsi::String &sql, jsi::Array &arguments) {
    auto &rt = getRt();
    auto ids = queryIds(sql.utf8(rt), jsiArrayToSqliteArgs(rt, arguments));
    std::vector<jsi::Value> values;
    values.reserve(ids.size());
    for (const auto &id : ids) {
        values.emplace_back(jsi::String::createFromUtf8(rt, id));
    }
    return arrayFromStd(values);
}

jsi::Array Database::unsafeQueryRaw(jsi::String &sql, jsi::Array &arguments) {
    auto &rt = getRt();
    auto raws = unsafeQueryRaw(sql.utf8(rt), jsiArrayToSqliteArgs(rt, arguments));
    std::vector<jsi::Value> values;
    values.reserve(raws.size());
    for (const auto &raw : raws) {
        values.emplace_back(sqliteRowToJsi(raw));
    }
    return arrayFromStd(values);
}

jsi::Value Database::count(jsi::String &sql, jsi::Array &arguments) {
    auto &rt = getRt();
    return jsi::Value(count(sql.utf8(rt), jsiArrayToSqliteArgs(rt, arguments)));
}

jsi::Value Database::getLocal(jsi::String &key) {
    auto &rt = getRt();
    auto value = getLocal(key.utf8(rt));
    if (!value) {
        return jsi::Value::null();
    }
    return jsi::String::createFromUtf8(rt, *value);
}

} // namespace watermelondb
