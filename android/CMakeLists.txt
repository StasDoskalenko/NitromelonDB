project(NitromelonDB)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitromelonDB)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

set(SIMDJSON_DIR "${CMAKE_SOURCE_DIR}/../native/vendor/simdjson")

# Which SQLite to compile (see native/shared/NitromelonSqliteConfig.h). native/android/build.gradle
# turns this on when the app opts into encryption ("nitromelondb": { "encryption": true } in its
# package.json, or NITROMELONDB_ENCRYPTION=1).
option(NITROMELON_ENCRYPTION "Build with SQLite3 Multiple Ciphers (database encryption)" OFF)
if(NITROMELON_ENCRYPTION)
  set(SQLITE_DIR "${CMAKE_SOURCE_DIR}/../native/vendor/sqlite3mc")
  message(STATUS "NitromelonDB: SQLite encryption build (SQLite3 Multiple Ciphers)")
else()
  set(SQLITE_DIR "${CMAKE_SOURCE_DIR}/../native/vendor/sqlite")
endif()

# CMAKE_SOURCE_DIR is <repo>/android so Nitrogen's generated
# `../nitrogen/...` paths resolve at the package root.
file(GLOB SHARED_SRC_FILES "${CMAKE_SOURCE_DIR}/../native/shared/*.cpp")

add_library(${PACKAGE_NAME} SHARED
  ${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp/cpp-adapter.cpp
  ${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp/DatabasePlatformAndroid.cpp
  ${CMAKE_SOURCE_DIR}/../native/nitro/HybridNitromelon.cpp
  ${CMAKE_SOURCE_DIR}/../native/nitro/HybridNitromelonDatabase.cpp
  ${SHARED_SRC_FILES}
  # Compiles ${SQLITE_DIR}'s amalgamation with native/shared/NitromelonSqliteConfig.h
  ${CMAKE_SOURCE_DIR}/../native/shared/NitromelonSqlite.c
  ${SIMDJSON_DIR}/simdjson.cpp
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitromelonDB+autolinking.cmake)

include_directories(
  "${CMAKE_SOURCE_DIR}/../native/nitro"
  "${CMAKE_SOURCE_DIR}/../native/shared"
  "${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp"
  "${SQLITE_DIR}"
  "${SIMDJSON_DIR}"
)

if(NITROMELON_ENCRYPTION)
  target_compile_definitions(${PACKAGE_NAME} PRIVATE NITROMELON_ENCRYPTION=1)
endif()

# simdjson is slow without optimization
set_source_files_properties(
  ${SIMDJSON_DIR}/simdjson.cpp
  PROPERTIES COMPILE_FLAGS "-Os"
)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)
