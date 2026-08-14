#include "Database.h"

#include <stdexcept>

namespace watermelondb {

using platform::consoleError;
using platform::consoleLog;

namespace {

std::string insertSqlFor(const std::string &tableName, const std::vector<SyncColumn> &columns) {
    std::string sql = "insert into `" + tableName + "` (`id`, `_status`, `_changed";
    for (auto const &column : columns) {
        sql += "`, `" + column.name;
    }
    sql += "`) values (?, 'synced', ''";
    for (size_t i = 0, len = columns.size(); i < len; i++) {
        sql += ", ?";
    }
    sql += ")";
    return sql;
}

SyncSchema decodeJsiSchema(jsi::Runtime &rt, jsi::Object &schema) {
    SyncSchema tables;
    auto tableSchemas = schema.getProperty(rt, "tables").getObject(rt);
    auto names = tableSchemas.getPropertyNames(rt);
    for (size_t i = 0, len = names.size(rt); i < len; i++) {
        auto nameVal = names.getValueAtIndex(rt, i);
        if (!nameVal.isString()) {
            continue;
        }
        auto tableName = nameVal.getString(rt).utf8(rt);
        auto tableSchemaJsi = tableSchemas.getProperty(rt, nameVal.getString(rt));
        if (!tableSchemaJsi.isObject()) {
            continue;
        }
        auto tableObj = tableSchemaJsi.getObject(rt);
        auto columnArr = tableObj.getProperty(rt, "columnArray").getObject(rt).getArray(rt);
        std::vector<SyncColumn> columns;
        for (size_t j = 0, colLen = columnArr.size(rt); j < colLen; j++) {
            auto columnObj = columnArr.getValueAtIndex(rt, j).getObject(rt);
            auto name = columnObj.getProperty(rt, "name").getString(rt).utf8(rt);
            auto typeStr = columnObj.getProperty(rt, "type").getString(rt).utf8(rt);
            SyncColumnType type = SyncColumnType::String;
            if (typeStr == "number") {
                type = SyncColumnType::Number;
            } else if (typeStr == "boolean") {
                type = SyncColumnType::Boolean;
            } else if (typeStr != "string") {
                throw std::invalid_argument("invalid column type in schema");
            }
            auto isOptionalProp = columnObj.getProperty(rt, "isOptional");
            bool isOptional = isOptionalProp.isBool() ? isOptionalProp.getBool() : false;
            columns.push_back(SyncColumn{static_cast<int>(j), name, type, isOptional});
        }
        tables[tableName] = std::move(columns);
    }
    return tables;
}

} // namespace

std::unordered_map<std::string, std::string> Database::loadFromSync(int jsonId, const SyncSchema &schema,
                                                                    std::string preamble, std::string postamble) {
    using namespace simdjson;
    const std::lock_guard<std::mutex> lock(mutex_);
    beginTransaction();

    try {
        executeMultiple(preamble);

        std::unordered_map<std::string, std::string> residualValues;
        ondemand::parser parser;
        auto json = padded_string(platform::getSyncJson(jsonId));
        ondemand::document doc = parser.iterate(json);

        for (auto docField : (ondemand::object) doc) {
            std::string_view fieldNameView = docField.unescaped_key();

            if (fieldNameView != "changes") {
                ondemand::value value = docField.value();
                std::string_view valueJson = simdjson::to_json_string(value);
                residualValues[(std::string) fieldNameView] = (std::string) valueJson;
            } else {
                ondemand::object changeSet = docField.value();
                for (auto changeSetField : changeSet) {
                    auto tableName = (std::string) (std::string_view) changeSetField.unescaped_key();
                    ondemand::object tableChangeSet = changeSetField.value();

                    for (auto tableChangeSetField : tableChangeSet) {
                        std::string_view tableChangeSetKey = tableChangeSetField.unescaped_key();
                        ondemand::array records = tableChangeSetField.value();

                        if (tableChangeSetKey == "deleted") {
                            if (records.begin() != records.end()) {
                                throw std::runtime_error("expected deleted field to be empty");
                            }
                            continue;
                        } else if (tableChangeSetKey != "updated" && tableChangeSetKey != "created") {
                            throw std::runtime_error("bad changeset field");
                        }

                        auto tableSchemaIt = schema.find(tableName);
                        if (tableSchemaIt == schema.end()) {
                            continue;
                        }
                        const auto &tableSchemaArray = tableSchemaIt->second;
                        std::unordered_map<std::string, SyncColumn> tableSchema;
                        for (const auto &column : tableSchemaArray) {
                            tableSchema[column.name] = column;
                        }

                        sqlite3_stmt *stmt = prepareQuery(insertSqlFor(tableName, tableSchemaArray));
                        SqliteStatement statement(stmt);

                        for (ondemand::object record : records) {
                            for (auto column : tableSchemaArray) {
                                auto argumentsIdx = column.index + 2;
                                if (column.isOptional) {
                                    sqlite3_bind_null(stmt, argumentsIdx);
                                } else {
                                    if (column.type == SyncColumnType::String) {
                                        sqlite3_bind_text(stmt, argumentsIdx, "", -1, SQLITE_STATIC);
                                    } else if (column.type == SyncColumnType::Boolean) {
                                        sqlite3_bind_int(stmt, argumentsIdx, 0);
                                    } else if (column.type == SyncColumnType::Number) {
                                        sqlite3_bind_double(stmt, argumentsIdx, 0);
                                    } else {
                                        throw std::runtime_error("Unknown schema type");
                                    }
                                }
                            }

                            for (auto valueField : record) {
                                auto key = (std::string) (std::string_view) valueField.unescaped_key();
                                auto value = valueField.value();

                                if (key == "id") {
                                    std::string_view idView = value;
                                    sqlite3_bind_text(stmt, 1, idView.data(), (int) idView.length(), SQLITE_STATIC);
                                    continue;
                                }

                                try {
                                    auto &column = tableSchema.at(key);
                                    ondemand::json_type type = value.type();
                                    auto argumentsIdx = column.index + 2;

                                    if (column.type == SyncColumnType::String && type == ondemand::json_type::string) {
                                        std::string_view stringView = value;
                                        sqlite3_bind_text(stmt, argumentsIdx, stringView.data(), (int) stringView.length(), SQLITE_STATIC);
                                    } else if (column.type == SyncColumnType::Boolean) {
                                        if (type == ondemand::json_type::boolean) {
                                            sqlite3_bind_int(stmt, argumentsIdx, (bool) value);
                                        } else if (type == ondemand::json_type::number && ((double) value == 0 || (double) value == 1)) {
                                            sqlite3_bind_int(stmt, argumentsIdx, (bool) (double) value);
                                        }
                                    } else if (column.type == SyncColumnType::Number && type == ondemand::json_type::number) {
                                        sqlite3_bind_double(stmt, argumentsIdx, (double) value);
                                    }
                                } catch (const std::out_of_range &ex) {
                                    continue;
                                }
                            }

                            executeUpdate(stmt);
                            sqlite3_reset(stmt);
                        }
                    }
                }
            }
        }
        executeMultiple(postamble);
        commit();
        platform::deleteSyncJson(jsonId);
        return residualValues;
    } catch (const std::exception &ex) {
        platform::deleteSyncJson(jsonId);
        rollback();
        throw;
    }
}

jsi::Value Database::unsafeLoadFromSync(int jsonId, jsi::Object &schema, std::string preamble, std::string postamble) {
    auto &rt = getRt();
    auto residual = loadFromSync(jsonId, decodeJsiSchema(rt, schema), preamble, postamble);
    jsi::Object residualValues(rt);
    for (const auto &entry : residual) {
        residualValues.setProperty(rt, jsi::String::createFromUtf8(rt, entry.first),
                                   jsi::String::createFromUtf8(rt, entry.second));
    }
    return residualValues;
}

} // namespace watermelondb
