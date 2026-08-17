#include "pch.h"

#include "DatabasePlatform.h"

#include <functional>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include <windows.h>
#include <winrt/Windows.Storage.h>

#include <sqlite3.h>

namespace watermelondb {
namespace platform {

void consoleLog(std::string message)
{
  std::string fullMessage = "NitromelonDB (info): " + message + "\n";
  OutputDebugStringA(fullMessage.c_str());
}

void consoleError(std::string message)
{
  std::string fullMessage = "NitromelonDB (error): " + message + "\n";
  OutputDebugStringA(fullMessage.c_str());
}

std::once_flag sqliteInitialization;

void initializeSqlite()
{
  std::call_once(sqliteInitialization, []() {
    if (sqlite3_config(SQLITE_CONFIG_URI, 1) != SQLITE_OK) {
      consoleError("Failed to configure SQLite to support file URI syntax - shared cache will not work");
    }

    auto tempPath = winrt::Windows::Storage::ApplicationData::Current().TemporaryFolder().Path();
    auto tempPathStr = winrt::to_string(tempPath);
    sqlite3_temp_directory = sqlite3_mprintf("%s", tempPathStr.c_str());

    if (sqlite3_initialize() != SQLITE_OK) {
      consoleError("Failed to initialize sqlite - this probably means sqlite was already initialized");
    }
  });
}

std::string resolveDatabasePath(std::string path)
{
  auto const localAppDataPath = winrt::Windows::Storage::ApplicationData::Current().LocalFolder().Path();
  return winrt::to_string(localAppDataPath) + "\\" + path;
}

void deleteDatabaseFile(std::string path, bool warnIfDoesNotExist)
{
  (void)path;
  (void)warnIfDoesNotExist;
}

void onMemoryAlert(std::function<void(void)> callback)
{
  (void)callback;
}

std::unordered_map<int, std::string> providedSyncJsons;
std::mutex providedSyncJsonsMutex;

void provideSyncJson(int id, std::string json)
{
  const std::lock_guard<std::mutex> lock(providedSyncJsonsMutex);
  if (providedSyncJsons.find(id) != providedSyncJsons.end()) {
    throw std::runtime_error("Sync json " + std::to_string(id) + " is already provided");
  }
  providedSyncJsons[id] = std::move(json);
}

std::string_view getSyncJson(int id)
{
  const std::lock_guard<std::mutex> lock(providedSyncJsonsMutex);
  auto search = providedSyncJsons.find(id);
  if (search == providedSyncJsons.end()) {
    throw std::runtime_error("Sync json " + std::to_string(id) + " does not exist");
  }
  return search->second;
}

void deleteSyncJson(int id)
{
  const std::lock_guard<std::mutex> lock(providedSyncJsonsMutex);
  providedSyncJsons.erase(id);
}

std::vector<std::function<void()>> destroyListeners;

void onDestroy(std::function<void(void)> callback)
{
  destroyListeners.push_back(std::move(callback));
}

} // namespace platform
} // namespace watermelondb
