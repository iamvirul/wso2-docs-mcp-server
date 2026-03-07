import { execSync } from 'child_process';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AcceleratorBackend = 'metal' | 'cuda' | 'cpu';

export interface AcceleratorConfig {
    backend: AcceleratorBackend;
    label: string;
    /** Execution providers passed to onnxruntime-node, in priority order. */
    executionProviders: string[];
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Probes the current machine and returns the best available ONNX Runtime
 * execution provider configuration:
 *
 *   1. Apple Silicon (arm64 macOS) → CoreML EP  (Metal GPU via CoreML)
 *   2. NVIDIA GPU (nvidia-smi present) → CUDA EP
 *   3. Everything else → CPU EP
 *
 * Detection is intentionally fast: the CoreML check is a pure platform test,
 * the CUDA check shells out to nvidia-smi with a 2s timeout.
 */
export function detectAccelerator(): AcceleratorConfig {
    if (isAppleSilicon()) {
        return {
            backend: 'metal',
            label: 'Apple Metal (CoreML)',
            executionProviders: ['CoreMLExecutionProvider', 'CPUExecutionProvider'],
        };
    }

    if (isCudaAvailable()) {
        return {
            backend: 'cuda',
            label: 'NVIDIA CUDA',
            executionProviders: ['CUDAExecutionProvider', 'CPUExecutionProvider'],
        };
    }

    return {
        backend: 'cpu',
        label: 'CPU',
        executionProviders: ['CPUExecutionProvider'],
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
