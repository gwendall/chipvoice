// chipvoice's own file, not MAME's. See README.md, "what is theirs and what
// is not."
//
// A minimal shim of the slice of MAME's device API that sn76496.cpp and
// sn76496.h need to compile standalone: device_t, device_sound_interface,
// sound_stream, save_item/NAME, attotime, emu_timer, devcb_write_line, the
// logging and bit macros. Every member here is either a no-op or the
// smallest thing that lets the vendored file's own logic run unmodified;
// none of it changes what sn76496.cpp computes.
//
// The two vendored files are compiled with `private` and `protected` mapped
// to `public` (see the bottom of this file), so main.cpp can read
// `m_register[]` and `m_output[]` straight off the device without touching
// sn76496.h. This only relaxes access control at compile time; it has no
// effect on layout or behaviour, and both gcc and clang accept it.
//
// Include order matters: bring in every standard header main.cpp needs
// *before* including this file, because the private/protected remapping
// below stays in effect for the rest of the translation unit.
#ifndef CHIPVOICE_SN76496_EMU_H
#define CHIPVOICE_SN76496_EMU_H

#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

using u8 = std::uint8_t;

#define ASSERT_LINE 1
#define CLEAR_LINE 0

#define ATTR_COLD
#define BIT(x, n) (((x) >> (n)) & 1)

// NAME(x) turns a member into the (value, name) pair save_item expects.
#define NAME(x) x, #x
// FUNC(x) turns a member function into the (name, pointer) pair timer_alloc
// expects.
#define FUNC(x) #x, &x
#define TIMER_CALLBACK_MEMBER(name) void name(std::int32_t param = 0)

struct machine_config {
};

struct device_type {
  const char *shortname;
  const char *fullname;
};

#define DECLARE_DEVICE_TYPE(Type, Class) \
  extern const device_type Type;         \
  class Class;

#define DEFINE_DEVICE_TYPE(Type, Class, ShortName, FullName) \
  const device_type Type{ShortName, FullName};

// Only from_hz's argument and adjust()'s call sites are exercised by
// sn76496.cpp; nothing here needs to measure real time, since main.cpp
// drives the device one internal step at a time itself.
struct attotime {
  static const attotime zero;
  static attotime from_hz(double) { return attotime{}; }
};
inline const attotime attotime::zero{};

struct emu_timer {
  void adjust(const attotime &, std::int32_t param = 0) { (void)param; }
};

class sound_stream {
 public:
  void update() {}
  int samples() const { return 1; }
  void put_int(int, int, int, int) {}
  void set_sample_rate(int) {}
};

class device_t {
 public:
  device_t(const machine_config &, device_type, const char *, device_t *, std::uint32_t clock)
      : m_clock(clock) {}
  virtual ~device_t() = default;

  std::uint32_t clock() const { return m_clock; }

  virtual void device_start() {}
  virtual void device_clock_changed() {}

  // Matches `timer_alloc(FUNC(Class::member), this)`; the callback is
  // never fired; main.cpp does not model the READY line.
  template <typename Device>
  emu_timer *timer_alloc(const char *, void (Device::*)(std::int32_t), Device *) {
    return &m_timer;
  }

  template <typename T>
  void save_item(T &, const char * = nullptr) {}

  // Forwarded to stderr so a write to register 6 with bit 7 clear (the one
  // path sn76496.cpp logs) is visible while debugging the corpus, without
  // touching the oracle's stdout protocol.
  void logerror(const char *fmt, ...) const {
    va_list ap;
    va_start(ap, fmt);
    std::vfprintf(stderr, fmt, ap);
    va_end(ap);
  }

 private:
  std::uint32_t m_clock;
  emu_timer m_timer;
};

class device_sound_interface {
 public:
  device_sound_interface(const machine_config &, device_t &) {}
  virtual ~device_sound_interface() = default;

 protected:
  sound_stream *stream_alloc(int, int, int) { return &m_stream; }
  virtual void sound_stream_update(sound_stream &stream) { (void)stream; }

 private:
  sound_stream m_stream;
};

struct devcb_write_line {
  template <typename T>
  explicit devcb_write_line(T &) {}
  devcb_write_line &bind() { return *this; }
  bool isunset() const { return true; }
  void operator()(int) {}
};

template <typename... Args>
[[noreturn]] void fatalerror(const char *fmt, Args &&...) {
  std::fprintf(stderr, "fatalerror: %s\n", fmt);
  std::abort();
}

// From here on, `private`/`protected` in the vendored sn76496.h read as
// `public`, so main.cpp can reach m_register[] and m_output[] directly.
// Nothing in sn76496.cpp/.h is edited to make this work.
#define private public
#define protected public

#endif  // CHIPVOICE_SN76496_EMU_H
