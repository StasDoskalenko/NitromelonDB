project(NitromelonDB)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NitromelonDB)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# CMAKE_SOURCE_DIR is <repo>/android so Nitrogen's generated
# `../nitrogen/...` paths resolve at the package root.
add_library(${PACKAGE_NAME} SHARED
  ${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp/cpp-adapter.cpp
  ${CMAKE_SOURCE_DIR}/../native/nitro/HybridNitromelon.cpp
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitromelonDB+autolinking.cmake)

include_directories(
  "${CMAKE_SOURCE_DIR}/../native/nitro"
  "${CMAKE_SOURCE_DIR}/../native/android/src/main/cpp"
)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)
