// GPU compute throughput for scripts/machine-probe.mjs: a Metal kernel doing a fixed number of
// fused multiply-adds per thread over 1M threads, timed on the GPU (command buffer GPU start/end),
// best of 5 dispatches. Prints {"gpuGflops": n} or {"gpuGflops": null} when there's no Metal
// device (some VMs). Compiled once per job: swiftc -O gpu.swift -o gpu-probe
import Foundation
import Metal

let source = """
#include <metal_stdlib>
using namespace metal;
kernel void fma_loop(device float *out [[buffer(0)]], uint id [[thread_position_in_grid]]) {
  float a = float(id) * 1e-6f, b = 1.0001f, c = 0.9999f;
  for (int i = 0; i < 4096; i++) {
    a = fma(a, b, c); b = fma(b, c, a); c = fma(c, a, b); a = fma(a, c, b);
  }
  out[id] = a + b + c;
}
"""

func emit(_ value: Double?) {
  if let value = value {
    print("{\"gpuGflops\": \(String(format: "%.1f", value))}")
  } else {
    print("{\"gpuGflops\": null}")
  }
}

guard let device = MTLCreateSystemDefaultDevice(),
  let library = try? device.makeLibrary(source: source, options: nil),
  let function = library.makeFunction(name: "fma_loop"),
  let pipeline = try? device.makeComputePipelineState(function: function),
  let queue = device.makeCommandQueue()
else {
  emit(nil)
  exit(0)
}

let threads = 1 << 20
let flopsPerThread = 4096.0 * 4 * 2
guard let buffer = device.makeBuffer(length: threads * MemoryLayout<Float>.size) else {
  emit(nil)
  exit(0)
}

var best = Double.infinity
for _ in 0..<6 {
  guard let commands = queue.makeCommandBuffer(), let encoder = commands.makeComputeCommandEncoder()
  else { break }
  encoder.setComputePipelineState(pipeline)
  encoder.setBuffer(buffer, offset: 0, index: 0)
  let group = min(pipeline.maxTotalThreadsPerThreadgroup, 256)
  encoder.dispatchThreads(
    MTLSize(width: threads, height: 1, depth: 1),
    threadsPerThreadgroup: MTLSize(width: group, height: 1, depth: 1))
  encoder.endEncoding()
  commands.commit()
  commands.waitUntilCompleted()
  let seconds = commands.gpuEndTime - commands.gpuStartTime
  if seconds > 0 { best = min(best, seconds) }
}
emit(best.isFinite ? Double(threads) * flopsPerThread / best / 1e9 : nil)
