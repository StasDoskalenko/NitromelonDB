project(NitromelonDB)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitromelonDB)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

set(SQLITE_VERSION sqlite-amalgamation-3460000)
set(NODE_MODULES_PATH "${CMAKE_SOURCE_DIR}/../node_modules")
set(SIMDJSON_DIR "${CMAKE_SOURCE_DIR}/../native/vendor/simdjson")

# CMAKE_SOURCE_DIR is <repo>/android so Nitrogen's generated
# `../nitrogen/...` paths resolve at the package root.
file(GLOB SHARED_SRC_FILES "${CMAKE_SOURCE_DIR}/../native/shared/*.cpp")

add_library(${PACKAGE_NAME} SHARED
  ${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp/cpp-adapter.cpp
  ${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp/DatabasePlatformAndroid.cpp
  ${CMAKE_SOURCE_DIR}/../native/nitro/HybridNitromelon.cpp
  ${CMAKE_SOURCE_DIR}/../native/nitro/HybridNitromelonDatabase.cpp
  ${SHARED_SRC_FILES}
  ${NODE_MODULES_PATH}/@nozbe/sqlite/${SQLITE_VERSION}/sqlite3.c
  ${SIMDJSON_DIR}/simdjson.cpp
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitromelonDB+autolinking.cmake)

include_directories(
  "${CMAKE_SOURCE_DIR}/../native/nitro"
  "${CMAKE_SOURCE_DIR}/../native/shared"
  "${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp"
  "${NODE_MODULES_PATH}/@nozbe/sqlite/${SQLITE_VERSION}"
  "${SIMDJSON_DIR}"
)

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
