#include "Database.h"

#include <stdexcept>

namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

void Database::batch(const std::vector<SqliteBatchOperation> &operations) {
    const std::lock_guard<std::mutex> lock(mutex_);
    beginTransaction();

    std::vector<std::string> addedIds = {};
    std::vector<std::string> removedIds = {};

    try {
        for (const auto &operation : operations) {
            auto cacheBehavior = operation.cacheBehavior;
            auto table = operation.table.value_or("");
            for (const auto &args : operation.argBatches) {
                executeUpdate(operation.sql, args);
                if (cacheBehavior != 0 && !args.empty()) {
                    if (!std::holds_alternative<std::string>(args[0])) {
                        throw std::runtime_error("Expected record id string as first batch argument");
                    }
                    auto id = std::get<std::string>(args[0]);
                    if (cacheBehavior == 1) {
                        addedIds.push_back(cacheKey(table, id));
                    } else if (cacheBehavior == -1) {
                        removedIds.push_back(cacheKey(table, id));
                    }
                }
            }
        }
        commit();
    } catch (const std::exception &ex) {
        rollback();
        throw;
    }

    for (auto const &key : addedIds) {
        markAsCached(key);
    }

    for (auto const &key : removedIds) {
        removeFromCache(key);
    }
}

void Database::batch(jsi::Array &operations) {
    auto &rt = getRt();
    std::vector<SqliteBatchOperation> cppOps;
    size_t operationsCount = operations.length(rt);
    cppOps.reserve(operationsCount);
    for (size_t i = 0; i < operationsCount; i++) {
        jsi::Array operation = operations.getValueAtIndex(rt, i).getObject(rt).getArray(rt);
        SqliteBatchOperation cppOp;
        cppOp.cacheBehavior = operation.getValueAtIndex(rt, 0).getNumber();
        if (cppOp.cacheBehavior != 0) {
            cppOp.table = operation.getValueAtIndex(rt, 1).getString(rt).utf8(rt);
        }
        cppOp.sql = operation.getValueAtIndex(rt, 2).getString(rt).utf8(rt);

        jsi::Array argsBatches = operation.getValueAtIndex(rt, 3).getObject(rt).getArray(rt);
        size_t argsBatchesCount = argsBatches.length(rt);
        for (size_t j = 0; j < argsBatchesCount; j++) {
            jsi::Array args = argsBatches.getValueAtIndex(rt, j).getObject(rt).getArray(rt);
            std::vector<SqliteValue> cppArgs;
            size_t argsCount = args.length(rt);
            cppArgs.reserve(argsCount);
            for (size_t k = 0; k < argsCount; k++) {
                jsi::Value value = args.getValueAtIndex(rt, k);
                if (value.isNull() || value.isUndefined()) {
                    cppArgs.emplace_back(nullptr);
                } else if (value.isString()) {
                    cppArgs.emplace_back(value.getString(rt).utf8(rt));
                } else if (value.isNumber()) {
                    cppArgs.emplace_back(value.getNumber());
                } else if (value.isBool()) {
                    cppArgs.emplace_back(value.getBool());
                } else {
                    throw jsi::JSError(rt, "Invalid argument type for query");
                }
            }
            cppOp.argBatches.push_back(std::move(cppArgs));
        }
        cppOps.push_back(std::move(cppOp));
    }
    batch(cppOps);
}

void Database::batchJSON(const std::string &operationsJson) {
    using namespace simdjson;

    const std::lock_guard<std::mutex> lock(mutex_);
    beginTransaction();

    std::vector<std::string> addedIds = {};
    std::vector<std::string> removedIds = {};

    try {
        ondemand::parser parser;
        auto json = padded_string(operationsJson);
        ondemand::document doc = parser.iterate(json);

        for (ondemand::array operation : doc) {
            int64_t cacheBehavior = 0;
            std::string table;
            std::string sql;
            size_t fieldIdx = 0;
            for (auto field : operation) {
                if (fieldIdx == 0) {
                    cacheBehavior = field;
                } else if (fieldIdx == 1) {
                    if (cacheBehavior != 0) {
                        table = (std::string_view) field;
                    }
                } else if (fieldIdx == 2) {
                    sql = (std::string_view) field;
                } else if (fieldIdx == 3) {
                    ondemand::array argsBatches = field;
                    auto stmt = prepareQuery(sql);
                    SqliteStatement statement(stmt);

                    for (ondemand::array args : argsBatches) {
                        auto id = bindArgsAndReturnId(stmt, args);
                        executeUpdate(stmt);
                        sqlite3_reset(stmt);
                        if (cacheBehavior == 1) {
                            addedIds.push_back(cacheKey(table, id));
                        } else if (cacheBehavior == -1) {
                            removedIds.push_back(cacheKey(table, id));
                        }
                    }
                }
                fieldIdx++;
            }
        }

        commit();
    } catch (const std::exception &ex) {
        rollback();
        throw;
    }

    for (auto const &key : addedIds) {
        markAsCached(key);
    }

    for (auto const &key : removedIds) {
        removeFromCache(key);
    }
}

void Database::batchJSON(jsi::String &&jsiJson) {
    batchJSON(jsiJson.utf8(getRt()));
}

} // namespace watermelondb
