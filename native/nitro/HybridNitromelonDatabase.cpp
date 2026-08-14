#include "HybridNitromelonDatabase.hpp"

#include "DatabasePlatform.h"
#include "JSIHelpers.h"

#include <cassert>
#include <cstdlib>
#include <stdexcept>

namespace margelo::nitro::watermelondb {

using facebook::jsi::Array;
using facebook::jsi::Object;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;
using watermelondb::makeError;
using watermelondb::platform::consoleError;
using watermelondb::platform::consoleLog;
using watermelondb::runBlock;

HybridNitromelonDatabase::HybridNitromelonDatabase(std::string dbName, bool usesExclusiveLocking)
    : HybridObject(TAG), dbName_(std::move(dbName)), usesExclusiveLocking_(usesExclusiveLocking) {}

watermelondb::Database& HybridNitromelonDatabase::database(Runtime& runtime) {
  if (!db_) {
    db_ = std::make_shared<watermelondb::Database>(&runtime, dbName_, usesExclusiveLocking_);
    std::weak_ptr<watermelondb::Database> weakDatabase = db_;
    watermelondb::platform::onDestroy([weakDatabase]() {
      if (auto databaseToDestroy = weakDatabase.lock()) {
        consoleLog("Destroying database due to RCTBridge invalidation");
        databaseToDestroy->destroy();
      }
    });
  }
  return *db_;
}

void HybridNitromelonDatabase::unsafeClose() {
  if (db_) {
    db_->destroy();
  }
  initialized_ = false;
}

void HybridNitromelonDatabase::loadHybridMethods() {
  HybridNitromelonDatabaseSpec::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerRawHybridMethod("initialize", 2, &HybridNitromelonDatabase::initialize);
    prototype.registerRawHybridMethod("setUpWithSchema", 3, &HybridNitromelonDatabase::setUpWithSchema);
    prototype.registerRawHybridMethod("setUpWithMigrations", 4, &HybridNitromelonDatabase::setUpWithMigrations);
    prototype.registerRawHybridMethod("find", 2, &HybridNitromelonDatabase::find);
    prototype.registerRawHybridMethod("query", 3, &HybridNitromelonDatabase::query);
    prototype.registerRawHybridMethod("queryAsArray", 3, &HybridNitromelonDatabase::queryAsArray);
    prototype.registerRawHybridMethod("queryIds", 2, &HybridNitromelonDatabase::queryIds);
    prototype.registerRawHybridMethod("unsafeQueryRaw", 2, &HybridNitromelonDatabase::unsafeQueryRaw);
    prototype.registerRawHybridMethod("count", 2, &HybridNitromelonDatabase::count);
    prototype.registerRawHybridMethod("batch", 1, &HybridNitromelonDatabase::batch);
    prototype.registerRawHybridMethod("batchJSON", 1, &HybridNitromelonDatabase::batchJSON);
    prototype.registerRawHybridMethod("getLocal", 1, &HybridNitromelonDatabase::getLocal);
    prototype.registerRawHybridMethod("unsafeLoadFromSync", 4, &HybridNitromelonDatabase::unsafeLoadFromSync);
    prototype.registerRawHybridMethod("unsafeExecuteMultiple", 1, &HybridNitromelonDatabase::unsafeExecuteMultiple);
    prototype.registerRawHybridMethod("unsafeResetDatabase", 2, &HybridNitromelonDatabase::unsafeResetDatabase);
  });
}

Value HybridNitromelonDatabase::initialize(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    auto& db = database(runtime);
    int expectedVersion = (int)args[1].getNumber();
    int databaseVersion = db.getUserVersion();

    Object response(runtime);
    if (databaseVersion == expectedVersion) {
      initialized_ = true;
      response.setProperty(runtime, "code", "ok");
    } else if (databaseVersion == 0) {
      response.setProperty(runtime, "code", "schema_needed");
    } else if (databaseVersion < expectedVersion) {
      response.setProperty(runtime, "code", "migrations_needed");
      response.setProperty(runtime, "databaseVersion", databaseVersion);
    } else {
      consoleLog("Database has newer version (" + std::to_string(databaseVersion) + ") than what the app supports (" +
                 std::to_string(expectedVersion) + "). Will reset database.");
      response.setProperty(runtime, "code", "schema_needed");
    }
    return Value(runtime, response);
  });
}

Value HybridNitromelonDatabase::setUpWithSchema(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    auto& db = database(runtime);
    String schema = args[1].getString(runtime);
    int schemaVersion = (int)args[2].getNumber();
    try {
      db.unsafeResetDatabase(schema, schemaVersion);
    } catch (const std::exception& ex) {
      consoleError("Failed to set up the database correctly - " + std::string(ex.what()));
      std::abort();
    }
    initialized_ = true;
    return Value::undefined();
  });
}

Value HybridNitromelonDatabase::setUpWithMigrations(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    auto& db = database(runtime);
    String migrationSchema = args[1].getString(runtime);
    int fromVersion = (int)args[2].getNumber();
    int toVersion = (int)args[3].getNumber();
    try {
      db.migrate(migrationSchema, fromVersion, toVersion);
    } catch (const std::exception& ex) {
      consoleError("Failed to migrate the database correctly - " + std::string(ex.what()));
      return makeError(runtime, ex.what());
    }
    initialized_ = true;
    return Value::undefined();
  });
}

Value HybridNitromelonDatabase::find(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String tableName = args[0].getString(runtime);
    String id = args[1].getString(runtime);
    return database(runtime).find(tableName, id);
  });
}

Value HybridNitromelonDatabase::query(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String tableName = args[0].getString(runtime);
    String sql = args[1].getString(runtime);
    Array arguments = args[2].getObject(runtime).getArray(runtime);
    return database(runtime).query(tableName, sql, arguments);
  });
}

Value HybridNitromelonDatabase::queryAsArray(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String tableName = args[0].getString(runtime);
    String sql = args[1].getString(runtime);
    Array arguments = args[2].getObject(runtime).getArray(runtime);
    return database(runtime).queryAsArray(tableName, sql, arguments);
  });
}

Value HybridNitromelonDatabase::queryIds(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String sql = args[0].getString(runtime);
    Array arguments = args[1].getObject(runtime).getArray(runtime);
    return database(runtime).queryIds(sql, arguments);
  });
}

Value HybridNitromelonDatabase::unsafeQueryRaw(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String sql = args[0].getString(runtime);
    Array arguments = args[1].getObject(runtime).getArray(runtime);
    return database(runtime).unsafeQueryRaw(sql, arguments);
  });
}

Value HybridNitromelonDatabase::count(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String sql = args[0].getString(runtime);
    Array arguments = args[1].getObject(runtime).getArray(runtime);
    return database(runtime).count(sql, arguments);
  });
}

Value HybridNitromelonDatabase::batch(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    Array operations = args[0].getObject(runtime).getArray(runtime);
    database(runtime).batch(operations);
    return Value::undefined();
  });
}

Value HybridNitromelonDatabase::batchJSON(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    database(runtime).batchJSON(args[0].getString(runtime));
    return Value::undefined();
  });
}

Value HybridNitromelonDatabase::getLocal(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String key = args[0].getString(runtime);
    return database(runtime).getLocal(key);
  });
}

Value HybridNitromelonDatabase::unsafeLoadFromSync(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    auto jsonId = (int)args[0].getNumber();
    auto schema = args[1].getObject(runtime);
    auto preamble = args[2].getString(runtime).utf8(runtime);
    auto postamble = args[3].getString(runtime).utf8(runtime);
    return database(runtime).unsafeLoadFromSync(jsonId, schema, preamble, postamble);
  });
}

Value HybridNitromelonDatabase::unsafeExecuteMultiple(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    database(runtime).executeMultiple(args[0].getString(runtime).utf8(runtime));
    return Value::undefined();
  });
}

Value HybridNitromelonDatabase::unsafeResetDatabase(Runtime& runtime, const Value&, const Value* args, size_t) {
  return runBlock(runtime, [&]() {
    assert(initialized_);
    String schema = args[0].getString(runtime);
    int schemaVersion = (int)args[1].getNumber();
    try {
      database(runtime).unsafeResetDatabase(schema, schemaVersion);
      return Value::undefined();
    } catch (const std::exception& ex) {
      consoleError("Failed to reset database correctly - " + std::string(ex.what()));
      std::abort();
    }
  });
}

} // namespace margelo::nitro::watermelondb
