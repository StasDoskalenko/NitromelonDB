#pragma once

#include "targetver.h"

#define NOMINMAX 1
#define WIN32_LEAN_AND_MEAN 1
#define WINRT_LEAN_AND_MEAN 1

#include <windows.h>
#undef GetCurrentTime
#include <unknwn.h>

#include <winrt/base.h>
#include <CppWinRTIncludes.h>
#include <winrt/Microsoft.ReactNative.h>

#include <malloc.h>
#include <memory.h>
#include <stdlib.h>
#include <tchar.h>
