#pragma once

#include "HybridNitromelonDatabaseSpec.hpp"
#include "Database.h"

#include <memory>
#include <string>
#include <vector>

namespace margelo::nitro::watermelondb {

class HybridNitromelonDatabase : public HybridNitromelonDatabaseSpec {
public:
  HybridNitromelonDatabase(std::string dbName, bool usesExclusiveLocking);

  NitromelonInitializeResult initialize(const std::string& dbName, double expectedVersion) override;
  void setUpWithSchema(const std::string& dbName, const std::string& schema, double schemaVersion) override;
  void setUpWithMigrations(const std::string& dbName, const std::string& migrationSchema, double fromVersion,
                           double toVersion) override;
  std::variant<nitro::NullType, std::string, std::shared_ptr<AnyMap>> find(const std::string& tableName,
                                                                          const std::string& id) override;
  std::vector<std::variant<std::string, std::shared_ptr<AnyMap>>>
  query(const std::string& tableName, const std::string& sql,
        const std::vector<std::variant<nitro::NullType, bool, std::string, double>>& args) override;
  std::vector<std::variant<std::string, std::vector<std::variant<nitro::NullType, bool, std::string, double>>>>
  queryAsArray(const std::string& tableName, const std::string& sql,
               const std::vector<std::variant<nitro::NullType, bool, std::string, double>>& args) override;
  std::vector<std::string> queryIds(const std::string& sql,
                                    const std::vector<std::variant<nitro::NullType, bool, std::string, double>>& args) override;
  std::vector<std::shared_ptr<AnyMap>>
  unsafeQueryRaw(const std::string& sql,
                 const std::vector<std::variant<nitro::NullType, bool, std::string, double>>& args) override;
  double count(const std::string& sql,
               const std::vector<std::variant<nitro::NullType, bool, std::string, double>>& args) override;
  void batch(const std::vector<std::tuple<double, std::optional<std::variant<nitro::NullType, std::string>>, std::string,
                                          std::vector<std::vector<std::variant<nitro::NullType, bool, std::string, double>>>>>&
                 operations) override;
  void batchJSON(const std::string& operations) override;
  std::variant<nitro::NullType, std::string> getLocal(const std::string& key) override;
  std::shared_ptr<AnyMap> unsafeLoadFromSync(double jsonId, const std::shared_ptr<AnyMap>& schema,
                                             const std::string& preamble, const std::string& postamble) override;
  void unsafeExecuteMultiple(const std::string& sql) override;
  void unsafeResetDatabase(const std::string& schema, double schemaVersion) override;
  void unsafeClose() override;

private:
  ::watermelondb::Database& database();

  std::string dbName_;
  bool usesExclusiveLocking_;
  bool initialized_ = false;
  std::shared_ptr<::watermelondb::Database> db_;
};

} // namespace margelo::nitro::watermelondb
