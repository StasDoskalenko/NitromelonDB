// Measures how fast the machine is while a benchmark run is going on, for
// examples/benchmark/scripts/run-sync-trials.mjs --sampler. On a CI runner, other VMs slow the
// machine down by up to 4x and the slowdown changes within a minute (probes ~65 s apart don't
// correlate), so the only measure that can describe a run is one taken during it.
//
// Every 100 ms it times a fixed workload, ~1 ms on a fast Mac: random read-modify-writes over an
// 8 MiB buffer (bigger than the caches, like a database's pages) mixed with integer hashing.
// Every second it times a 4 KiB write + fsync, the way SQLite commits. It prints one line per
// sample, flushed: `c <microseconds>` or `f <microseconds>`. About 1% of one core.
//
// Build: clang -O2 sampler.c -o machine-sampler
// Usage: machine-sampler <scratch file>   (runs until killed)
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

#define BUFFER_WORDS (8u << 20) / sizeof(uint64_t)
#define OPS 60000

static uint64_t now_us(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}

static volatile uint64_t sink;

static uint64_t workload(uint64_t *buffer, uint64_t seed) {
  uint64_t x = seed | 1;
  for (int i = 0; i < OPS; i++) {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    uint64_t *slot = &buffer[x % BUFFER_WORDS];
    *slot = (*slot + x) * 0x9e3779b97f4a7c15ull;
  }
  return x;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: machine-sampler <scratch file>\n");
    return 1;
  }
  uint64_t *buffer = calloc(BUFFER_WORDS, sizeof(uint64_t));
  int fd = open(argv[1], O_RDWR | O_CREAT, 0644);
  if (!buffer || fd < 0) return 1;
  char page[4096];
  for (unsigned i = 0; i < sizeof page; i++) page[i] = (char)i;
  setvbuf(stdout, NULL, _IOLBF, 0);
  workload(buffer, 1);  // touch the buffer once
  uint64_t seed = 7;
  for (unsigned tick = 0;; tick++) {
    uint64_t start = now_us();
    seed = workload(buffer, seed);
    printf("c %llu\n", (unsigned long long)(now_us() - start));
    if (tick % 10 == 0) {
      start = now_us();
      off_t offset = (off_t)((seed >> 3) % 256) * 4096;
      if (pwrite(fd, page, sizeof page, offset) == (ssize_t)sizeof page && fsync(fd) == 0) {
        printf("f %llu\n", (unsigned long long)(now_us() - start));
      }
    }
    sink = seed;
    usleep(100000);
  }
}
