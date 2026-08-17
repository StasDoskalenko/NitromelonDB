#include "ThreadUtils.hpp"
#include "UIThreadDispatcher.hpp"

#include <sstream>
#include <string>
#include <thread>
#include <windows.h>

namespace margelo::nitro {

std::string ThreadUtils::getThreadName()
{
  PWSTR description = nullptr;
  HRESULT hr = GetThreadDescription(GetCurrentThread(), &description);
  if (SUCCEEDED(hr) && description != nullptr && description[0] != L'\0') {
    int size = WideCharToMultiByte(CP_UTF8, 0, description, -1, nullptr, 0, nullptr, nullptr);
    std::string name(static_cast<size_t>(size > 0 ? size - 1 : 0), '\0');
    if (size > 1) {
      WideCharToMultiByte(CP_UTF8, 0, description, -1, name.data(), size, nullptr, nullptr);
    }
    LocalFree(description);
    return name;
  }
  if (description != nullptr) {
    LocalFree(description);
  }

  std::stringstream stream;
  stream << std::this_thread::get_id();
  return std::string("Thread #") + stream.str();
}

void ThreadUtils::setThreadName(const std::string &name)
{
  int size = MultiByteToWideChar(CP_UTF8, 0, name.c_str(), -1, nullptr, 0);
  if (size <= 0) {
    return;
  }
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, name.c_str(), -1, wide.data(), size);
  SetThreadDescription(GetCurrentThread(), wide.c_str());
}

bool ThreadUtils::isUIThread()
{
  return false;
}

std::shared_ptr<Dispatcher> ThreadUtils::createUIThreadDispatcher()
{
  return std::make_shared<UIThreadDispatcher>();
}

} // namespace margelo::nitro
