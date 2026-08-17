#include "UIThreadDispatcher.hpp"

#include <stdexcept>

namespace margelo::nitro {

void UIThreadDispatcher::runSync(std::function<void()> &&function)
{
  throw std::runtime_error("UIThreadDispatcher::runSync() is not implemented on Windows");
}

void UIThreadDispatcher::runAsync(std::function<void()> &&function)
{
  // SQLite HybridObjects are synchronous. View/UI dispatch is unused here.
  function();
}

} // namespace margelo::nitro
