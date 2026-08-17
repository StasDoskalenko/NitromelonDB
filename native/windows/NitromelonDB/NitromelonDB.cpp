#include "pch.h"

#include "NitromelonDB.h"

#include "CallInvokerDispatcher.hpp"
#include "HybridNitromelon.hpp"
#include "HybridObjectRegistry.hpp"
#include "InstallNitro.hpp"

#include <JSI/JsiApiContext.h>

#include <exception>
#include <memory>
#include <mutex>

using namespace winrt::Microsoft::ReactNative;

namespace {

void registerNitromelonHybridObject() noexcept
{
  using namespace margelo::nitro;
  using namespace margelo::nitro::watermelondb;

  static std::once_flag once;
  std::call_once(once, []() {
    HybridObjectRegistry::registerHybridObjectConstructor(
        "Nitromelon", []() -> std::shared_ptr<HybridObject> { return std::make_shared<HybridNitromelon>(); });
  });
}

} // namespace

namespace winrt::NitromelonDB
{

void NitroModules::Initialize(React::ReactContext const &reactContext) noexcept
{
  m_context = reactContext;
  registerNitromelonHybridObject();
}

std::optional<std::string> NitroModules::install() noexcept
{
  try {
    registerNitromelonHybridObject();

    facebook::jsi::Runtime *runtime = TryGetOrCreateContextRuntime(m_context);
    if (runtime == nullptr) {
      return std::string("No JSI runtime");
    }

    auto callInvoker = m_context.CallInvoker();
    if (callInvoker == nullptr) {
      return std::string("CallInvoker was null");
    }

    auto dispatcher = std::make_shared<margelo::nitro::CallInvokerDispatcher>(callInvoker);
    margelo::nitro::install(*runtime, dispatcher);
    return std::nullopt;
  } catch (const std::exception &exc) {
    return std::string(exc.what());
  } catch (...) {
    return std::string("Failed to install Nitro");
  }
}

} // namespace winrt::NitromelonDB
