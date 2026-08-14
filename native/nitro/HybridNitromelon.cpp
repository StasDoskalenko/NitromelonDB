#include "HybridNitromelon.hpp"
#include "DatabasePlatform.h"

namespace margelo::nitro::watermelondb {

void HybridNitromelon::provideSyncJson(double id, const std::string& json) {
  watermelondb::platform::provideSyncJson(static_cast<int>(id), json);
}

} // namespace margelo::nitro::watermelondb
