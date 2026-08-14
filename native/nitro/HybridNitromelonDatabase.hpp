#pragma once

#include "HybridNitromelonDatabaseSpec.hpp"
#include "Database.h"

#include <jsi/jsi.h>
#include <memory>
#include <string>

namespace margelo::nitro::watermelondb {

class HybridNitromelonDatabase : public HybridNitromelonDatabaseSpec {
public:
  HybridNitromelonDatabase(std::string dbName, bool usesExclusiveLocking);

  void unsafeClose() override;
  void loadHybridMethods() override;

  facebook::jsi::Value initialize(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                  const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value setUpWithSchema(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                       const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value setUpWithMigrations(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                           const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value find(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                            const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value query(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                             const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value queryAsArray(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                    const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value queryIds(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value unsafeQueryRaw(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                      const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value count(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                             const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value batch(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                             const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value batchJSON(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                 const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value getLocal(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value unsafeLoadFromSync(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                          const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value unsafeExecuteMultiple(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                             const facebook::jsi::Value* args, size_t count);
  facebook::jsi::Value unsafeResetDatabase(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisValue,
                                           const facebook::jsi::Value* args, size_t count);

private:
  watermelondb::Database& database(facebook::jsi::Runtime& runtime);

  std::string dbName_;
  bool usesExclusiveLocking_;
  bool initialized_ = false;
  std::shared_ptr<watermelondb::Database> db_;
};

} // namespace margelo::nitro::watermelondb
