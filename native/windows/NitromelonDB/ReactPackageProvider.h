#pragma once

#include "ReactPackageProvider.g.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::NitromelonDB::implementation
{

struct ReactPackageProvider : ReactPackageProviderT<ReactPackageProvider>
{
  ReactPackageProvider() = default;

  void CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept;
};

} // namespace winrt::NitromelonDB::implementation

namespace winrt::NitromelonDB::factory_implementation
{

struct ReactPackageProvider : ReactPackageProviderT<ReactPackageProvider, implementation::ReactPackageProvider> {};

} // namespace winrt::NitromelonDB::factory_implementation
