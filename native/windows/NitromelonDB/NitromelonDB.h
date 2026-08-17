#pragma once

#include "pch.h"
#include "resource.h"

#include "NativeModules.h"

#include <optional>
#include <string>

namespace winrt::NitromelonDB
{

// Provides the `NitroModules` TurboModule that react-native-nitro-modules JS expects
// (`TurboModuleRegistry.getEnforcing('NitroModules').install()`), then registers HybridNitromelon.
REACT_MODULE(NitroModules, L"NitroModules")
struct NitroModules
{
  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &reactContext) noexcept;

  REACT_SYNC_METHOD(install)
  std::optional<std::string> install() noexcept;

private:
  React::ReactContext m_context;
};

} // namespace winrt::NitromelonDB
