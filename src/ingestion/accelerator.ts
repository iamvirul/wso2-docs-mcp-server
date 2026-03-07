import { execSync } from 'child_process';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AcceleratorBackend = 'metal' | 'cuda' | 'cpu';

export interface AcceleratorConfig {
    backend: AcceleratorBackend;
    label: string;
    /**
     * ONNX model precision:
     * - 'q8'   : INT8 quantized — optimal for CPU/Apple Silicon NEON (3-4x faster than fp32)
     * - 'fp32' : Full precision — optimal for CUDA (GPU fp32 throughput beats quantization overhead)
     */
    dtype: 'q8' | 'fp32';
    /** Execution providers passed to onnxruntime-node, in priority order. */
    executionProviders: string[];
    /**
     * Max texts per onnxruntime inference call.
     * Larger batches amortize per-call overhead; smaller batches reduce memory pressure.
     */
    batchSize: number;
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Probes the current machine and returns the optimal ONNX Runtime config:
 *
 *   1. Apple Silicon (arm64 macOS)
 *      → INT8 quantized model on ARM NEON via CPU EP.
 *        CoreML has a prohibitive first-run shader-compilation cost (~20 min)
 *        that outweighs its batch-inference gains for typical chunk sizes.
 *        ARM NEON int8 is consistently 3-4x faster than fp32 with zero cold-start.
 *
 *   2. NVIDIA GPU (nvidia-smi present)
 *      → fp32 on CUDA EP. GPU fp32 throughput dominates; quantization adds
 *        unnecessary dequantization overhead on CUDA.
 *
 *   3. Everything else
 *      → INT8 quantized model on CPU. INT8 SIMD (SSE4/AVX2) gives the same
 *        3-4x speedup on x86 as NEON does on ARM.
 *
 * Detection is intentionally fast: the Apple Silicon check is a pure synchronous
 * platform test; the CUDA check shells out to nvidia-smi with a 2s timeout.
 */
export function detectAccelerator(): AcceleratorConfig {
    if (isAppleSilicon()) {
        return {
            backend: 'metal',
            label: 'Apple Silicon (ARM NEON INT8)',
            dtype: 'q8',
            executionProviders: ['cpu'],
            batchSize: 32,
        };
    }

    if (isCudaAvailable()) {
        return {
            backend: 'cuda',
            label: 'NVIDIA CUDA',
            dtype: 'fp32',
            executionProviders: ['cuda', 'cpu'],
            batchSize: 64,
        };
    }

    return {
        backend: 'cpu',
        label: 'CPU (INT8)',
        dtype: 'q8',
        executionProviders: ['cpu'],
        batchSize: 16,
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAppleSilicon(): boolean {
    return process.platform === 'darwin' && process.arch === 'arm64';
}

function isCudaAvailable(): boolean {
    try {
        execSync('nvidia-smi', { stdio: 'ignore', timeout: 2_000 });
        return true;
    } catch {
        return false;
    }
}
