#include "HybridNitromelon.hpp"
#include "DatabasePlatform.h"

#include <random>
#include <string>

namespace margelo::nitro::watermelondb {

void HybridNitromelon::provideSyncJson(double id, const std::string& json) {
  ::watermelondb::platform::provideSyncJson(static_cast<int>(id), json);
}

std::string HybridNitromelon::getRandomIds() {
  static constexpr char alphabet[] = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  static constexpr size_t batchSize = 64;
  static constexpr size_t idLength = 16;

  static thread_local std::mt19937 rng{std::random_device{}()};
  static thread_local std::uniform_int_distribution<int> dist(0, 61);

  std::string result;
  result.resize(batchSize * (idLength + 1) - 1);
  size_t offset = 0;
  for (size_t i = 0; i < batchSize; i++) {
    for (size_t j = 0; j < idLength; j++) {
      result[offset++] = alphabet[dist(rng)];
    }
    if (i != batchSize - 1) {
      result[offset++] = ',';
    }
  }
  return result;
}

} // namespace margelo::nitro::watermelondb
