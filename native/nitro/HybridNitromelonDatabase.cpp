#include "HybridNitromelonDatabase.hpp"

#include "DatabasePlatform.h"

#include <NitroModules/AnyMap.hpp>
#include <cassert>
#include <cstdlib>
#include <stdexcept>
#include <type_traits>

namespace margelo::nitro::watermelondb {

using ::watermelondb::SqliteBatchOperation;
using ::watermelondb::SqliteQueryRecord;
using ::watermelondb::SqliteRow;
using ::watermelondb::SqliteValue;
using ::watermelondb::SyncColumn;
using ::watermelondb::SyncColumnType;
using ::watermelondb::SyncSchema;
using ::watermelondb::platform::consoleError;
using ::watermelondb::platform::consoleLog;

using NitroSqliteValue = std::variant<nitro::NullType, bool, std::string, double>;

namespace {

SqliteValue toSqliteValue(const NitroSqliteValue& value) {
  return std::visit(
      [](auto&& v) -> SqliteValue {
        using T = std::decay_t<decltype(v)>;
        if constexpr (std::is_same_v<T, nitro::NullType>) {
          return nullptr;
        } else {
          return v;
        }
      },
      value);
}

std::vector<SqliteValue> toSqliteArgs(const std::vector<NitroSqliteValue>& args) {
  std::vector<SqliteValue> sqliteArgs;
  sqliteArgs.reserve(args.size());
  for (const auto& arg : args) {
    sqliteArgs.push_back(toSqliteValue(arg));
  }
  return sqliteArgs;
}

NitroSqliteValue toNitroValue(const SqliteValue& value) {
  return std::visit(
      [](auto&& v) -> NitroSqliteValue {
        using T = std::decay_t<decltype(v)>;
        if constexpr (std::is_same_v<T, std::nullptr_t>) {
          return nitro::null;
        } else {
          return v;
        }
      },
      value);
}

std::shared_ptr<AnyMap> rowToAnyMap(const SqliteRow& row) {
  auto map = AnyMap::make(row.size());
  for (const auto& entry : row) {
    std::visit(
        [&](auto&& v) {
          using T = std::decay_t<decltype(v)>;
          if constexpr (std::is_same_v<T, std::nullptr_t>) {
            map->setNull(entry.first);
          } else if constexpr (std::is_same_v<T, bool>) {
            map->setBoolean(entry.first, v);
          } else if constexpr (std::is_same_v<T, double>) {
            map->setDouble(entry.first, v);
          } else {
            map->setString(entry.first, v);
          }
        },
        entry.second);
  }
  return map;
}

std::variant<std::string, std::shared_ptr<AnyMap>> toCachedRecord(const SqliteQueryRecord& record) {
  if (std::holds_alternative<std::string>(record)) {
    return std::get<std::string>(record);
  }
  return rowToAnyMap(std::get<SqliteRow>(record));
}

std::string anyValueToString(const AnyValue& value, const std::string& field) {
  if (std::holds_alternative<std::string>(value)) {
    return std::get<std::string>(value);
  }
  throw std::runtime_error("Expected string for " + field);
}

SyncSchema schemaFromAnyMap(const std::shared_ptr<AnyMap>& schema) {
  if (!schema || !schema->isObject("tables")) {
    throw std::runtime_error("schema.tables must be an object");
  }

  SyncSchema tables;
  const AnyObject tablesObj = schema->getObject("tables");
  for (const auto& tableEntry : tablesObj) {
    if (!std::holds_alternative<AnyObject>(tableEntry.second)) {
      continue;
    }
    const auto& tableObj = std::get<AnyObject>(tableEntry.second);
    auto columnArrayIt = tableObj.find("columnArray");
    if (columnArrayIt == tableObj.end() || !std::holds_alternative<AnyArray>(columnArrayIt->second)) {
      continue;
    }

    const auto& columnArray = std::get<AnyArray>(columnArrayIt->second);
    std::vector<SyncColumn> columns;
    columns.reserve(columnArray.size());
    for (size_t i = 0; i < columnArray.size(); i++) {
      if (!std::holds_alternative<AnyObject>(columnArray[i])) {
        continue;
      }
      const auto& columnObj = std::get<AnyObject>(columnArray[i]);
      auto nameIt = columnObj.find("name");
      auto typeIt = columnObj.find("type");
      if (nameIt == columnObj.end() || typeIt == columnObj.end()) {
        throw std::runtime_error("Invalid column schema");
      }

      SyncColumn column;
      column.index = static_cast<int>(i);
      column.name = anyValueToString(nameIt->second, "column.name");
      auto typeStr = anyValueToString(typeIt->second, "column.type");
      if (typeStr == "number") {
        column.type = SyncColumnType::Number;
      } else if (typeStr == "boolean") {
        column.type = SyncColumnType::Boolean;
      } else if (typeStr == "string") {
        column.type = SyncColumnType::String;
      } else {
        throw std::runtime_error("invalid column type in schema");
      }
      auto optionalIt = columnObj.find("isOptional");
      column.isOptional = optionalIt != columnObj.end() && std::holds_alternative<bool>(optionalIt->second) &&
                          std::get<bool>(optionalIt->second);
      columns.push_back(std::move(column));
    }
    tables[tableEntry.first] = std::move(columns);
  }
  return tables;
}

} // namespace

HybridNitromelonDatabase::HybridNitromelonDatabase(std::string dbName, bool usesExclusiveLocking)
    : HybridObject(TAG), dbName_(std::move(dbName)), usesExclusiveLocking_(usesExclusiveLocking) {}

::watermelondb::Database& HybridNitromelonDatabase::database() {
  if (!db_) {
    db_ = std::make_shared<::watermelondb::Database>(nullptr, dbName_, usesExclusiveLocking_);
    std::weak_ptr<::watermelondb::Database> weakDatabase = db_;
    ::watermelondb::platform::onDestroy([weakDatabase]() {
      if (auto databaseToDestroy = weakDatabase.lock()) {
        consoleLog("Destroying database due to RCTBridge invalidation");
        databaseToDestroy->destroy();
      }
    });

    // weak_from_this() returns weak_ptr<HybridObject> (the shared base --
    // see NitroModules/HybridObject.hpp), so the locked pointer is cast back
    // to this concrete type. A memory alert firing after this HybridObject
    // is gone is then a safe no-op instead of a use-after-free.
    std::weak_ptr<HybridObject> weakSelf = weak_from_this();
    ::watermelondb::platform::onMemoryAlert([weakSelf]() {
      if (auto self = weakSelf.lock()) {
        auto* hybridDatabase = static_cast<HybridNitromelonDatabase*>(self.get());
        if (hybridDatabase->memoryWarningCallback_) {
          hybridDatabase->memoryWarningCallback_();
        }
      }
    });
  }
  return *db_;
}

void HybridNitromelonDatabase::onMemoryWarning(const std::function<void()>& callback) {
  memoryWarningCallback_ = callback;
}

NitromelonInitializeResult HybridNitromelonDatabase::initialize(const std::string&, double expectedVersion) {
  int databaseVersion = database().getUserVersion();
  int expected = static_cast<int>(expectedVersion);

  if (databaseVersion == expected) {
    initialized_ = true;
    return NitromelonInitializeResult("ok", std::nullopt);
  }
  if (databaseVersion == 0) {
    return NitromelonInitializeResult("schema_needed", std::nullopt);
  }
  if (databaseVersion < expected) {
    return NitromelonInitializeResult("migrations_needed", static_cast<double>(databaseVersion));
  }
  consoleLog("Database has newer version (" + std::to_string(databaseVersion) + ") than what the app supports (" +
             std::to_string(expected) + "). Will reset database.");
  return NitromelonInitializeResult("schema_needed", std::nullopt);
}

void HybridNitromelonDatabase::setUpWithSchema(const std::string&, const std::string& schema, double schemaVersion) {
  try {
    database().unsafeResetDatabase(schema, static_cast<int>(schemaVersion));
  } catch (const std::exception& ex) {
    consoleError("Failed to set up the database correctly - " + std::string(ex.what()));
    std::abort();
  }
  initialized_ = true;
}

void HybridNitromelonDatabase::setUpWithMigrations(const std::string&, const std::string& migrationSchema, double fromVersion,
                                                   double toVersion) {
  try {
    database().migrate(migrationSchema, static_cast<int>(fromVersion), static_cast<int>(toVersion));
  } catch (const std::exception& ex) {
    consoleError("Failed to migrate the database correctly - " + std::string(ex.what()));
    throw;
  }
  initialized_ = true;
}

std::variant<nitro::NullType, std::string, std::shared_ptr<AnyMap>>
HybridNitromelonDatabase::find(const std::string& tableName, const std::string& id) {
  assert(initialized_);
  auto result = database().find(tableName, id);
  if (std::holds_alternative<std::nullptr_t>(result)) {
    return nitro::null;
  }
  if (std::holds_alternative<std::string>(result)) {
    return std::get<std::string>(result);
  }
  return rowToAnyMap(std::get<SqliteRow>(result));
}

std::vector<std::variant<std::string, std::shared_ptr<AnyMap>>>
HybridNitromelonDatabase::query(const std::string& tableName, const std::string& sql,
                                const std::vector<NitroSqliteValue>& args) {
  assert(initialized_);
  auto records = database().query(tableName, sql, toSqliteArgs(args));
  std::vector<std::variant<std::string, std::shared_ptr<AnyMap>>> results;
  results.reserve(records.size());
  for (const auto& record : records) {
    results.push_back(toCachedRecord(record));
  }
  return results;
}

std::vector<std::variant<std::string, std::vector<NitroSqliteValue>>>
HybridNitromelonDatabase::queryAsArray(const std::string& tableName, const std::string& sql,
                                       const std::vector<NitroSqliteValue>& args) {
  assert(initialized_);
  auto items = database().queryAsArray(tableName, sql, toSqliteArgs(args));
  std::vector<std::variant<std::string, std::vector<NitroSqliteValue>>> results;
  results.reserve(items.size());
  for (const auto& item : items) {
    if (std::holds_alternative<std::string>(item)) {
      results.emplace_back(std::get<std::string>(item));
    } else {
      const auto& values = std::get<std::vector<SqliteValue>>(item);
      std::vector<NitroSqliteValue> nitroValues;
      nitroValues.reserve(values.size());
      for (const auto& value : values) {
        nitroValues.push_back(toNitroValue(value));
      }
      results.emplace_back(std::move(nitroValues));
    }
  }
  return results;
}

std::vector<std::string> HybridNitromelonDatabase::queryIds(const std::string& sql, const std::vector<NitroSqliteValue>& args) {
  assert(initialized_);
  return database().queryIds(sql, toSqliteArgs(args));
}

std::vector<std::shared_ptr<AnyMap>> HybridNitromelonDatabase::unsafeQueryRaw(const std::string& sql,
                                                                             const std::vector<NitroSqliteValue>& args) {
  assert(initialized_);
  auto rows = database().unsafeQueryRaw(sql, toSqliteArgs(args));
  std::vector<std::shared_ptr<AnyMap>> results;
  results.reserve(rows.size());
  for (const auto& row : rows) {
    results.push_back(rowToAnyMap(row));
  }
  return results;
}

double HybridNitromelonDatabase::count(const std::string& sql, const std::vector<NitroSqliteValue>& args) {
  assert(initialized_);
  return database().count(sql, toSqliteArgs(args));
}

void HybridNitromelonDatabase::batch(
    const std::vector<std::tuple<double, std::optional<std::variant<nitro::NullType, std::string>>, std::string,
                                 std::vector<std::vector<NitroSqliteValue>>>>& operations) {
  assert(initialized_);
  std::vector<SqliteBatchOperation> cppOps;
  cppOps.reserve(operations.size());
  for (const auto& operation : operations) {
    SqliteBatchOperation cppOp;
    cppOp.cacheBehavior = std::get<0>(operation);
    const auto& table = std::get<1>(operation);
    if (table.has_value() && std::holds_alternative<std::string>(*table)) {
      cppOp.table = std::get<std::string>(*table);
    }
    cppOp.sql = std::get<2>(operation);
    for (const auto& args : std::get<3>(operation)) {
      cppOp.argBatches.push_back(toSqliteArgs(args));
    }
    cppOps.push_back(std::move(cppOp));
  }
  database().batch(cppOps);
}

void HybridNitromelonDatabase::batchJSON(const std::string& operations) {
  assert(initialized_);
  database().batchJSON(operations);
}

std::variant<nitro::NullType, std::string> HybridNitromelonDatabase::getLocal(const std::string& key) {
  assert(initialized_);
  auto value = database().getLocal(key);
  if (!value) {
    return nitro::null;
  }
  return *value;
}

std::shared_ptr<AnyMap> HybridNitromelonDatabase::unsafeLoadFromSync(double jsonId, const std::shared_ptr<AnyMap>& schema,
                                                                     const std::string& preamble,
                                                                     const std::string& postamble) {
  assert(initialized_);
  auto residual = database().loadFromSync(static_cast<int>(jsonId), schemaFromAnyMap(schema), preamble, postamble);
  auto map = AnyMap::make(residual.size());
  for (const auto& entry : residual) {
    map->setString(entry.first, entry.second);
  }
  return map;
}

void HybridNitromelonDatabase::unsafeExecuteMultiple(const std::string& sql) {
  assert(initialized_);
  database().executeMultiple(sql);
}

void HybridNitromelonDatabase::unsafeResetDatabase(const std::string& schema, double schemaVersion) {
  assert(initialized_);
  try {
    database().unsafeResetDatabase(schema, static_cast<int>(schemaVersion));
  } catch (const std::exception& ex) {
    consoleError("Failed to reset database correctly - " + std::string(ex.what()));
    std::abort();
  }
}

void HybridNitromelonDatabase::unsafeClose() {
  if (db_) {
    db_->destroy();
  }
  initialized_ = false;
}

} // namespace margelo::nitro::watermelondb
