#pragma once

#include "HybridNitromelonSpec.hpp"
#include "HybridNitromelonDatabase.hpp"

#include <memory>
#include <string>

namespace margelo::nitro::watermelondb {

class HybridNitromelon : public HybridNitromelonSpec {
public:
  HybridNitromelon() : HybridObject(TAG) {}

  std::string getNativeEngine() override {
    return "nitro";
  }

  std::string ping() override {
    return "pong";
  }

  std::shared_ptr<HybridNitromelonDatabaseSpec> createAdapter(const std::string& dbName, bool usesExclusiveLocking) override {
    return std::make_shared<HybridNitromelonDatabase>(dbName, usesExclusiveLocking);
  }

  void provideSyncJson(double id, const std::string& json) override;
};

} // namespace margelo::nitro::watermelondb
