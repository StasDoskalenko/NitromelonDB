#pragma once

#include "HybridNitromelonSpec.hpp"

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
};

} // namespace margelo::nitro::watermelondb
