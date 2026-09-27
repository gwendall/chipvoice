// Ours. Mesen's real Core/pch.h is a big precompiled-header umbrella for the
// whole emulator (PPU, mappers, UI, ...). The vendored APU files only need a
// handful of standard headers and a couple of aliases/macros from it, so this
// shim provides just those instead of Mesen's own pch.h.
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using std::string;
using std::unique_ptr;
using std::vector;

// Mesen marks a few hot APU methods __forceinline (MSVC/clang spelling) or
// relies on __noinline existing; neither is a standard keyword.
#ifndef __forceinline
#define __forceinline inline
#endif
#ifndef __noinline
#define __noinline
#endif
