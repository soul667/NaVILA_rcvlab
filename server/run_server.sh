#!/bin/bash
# NaVILA Inference Server Launcher
# Usage: ./run_server.sh [--port PORT] [--host HOST] [--8bit] [--4bit] [--gpu GPU_ID]
#
# Environment variables:
#   NAVILA_MODEL_PATH  - Path to model checkpoint (default: ../checkpoints/navila-llama3-8b-8f)
#   NAVILA_LOAD_8BIT   - Set to "1" for 8-bit quantization
#   NAVILA_LOAD_4BIT   - Set to "1" for 4-bit quantization
#   CUDA_VISIBLE_DEVICES - GPU to use (default: 0)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults
HOST="0.0.0.0"
PORT=8000
GPU_ID="${CUDA_VISIBLE_DEVICES:-0}"

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --port) PORT="$2"; shift 2 ;;
        --host) HOST="$2"; shift 2 ;;
        --gpu) GPU_ID="$2"; shift 2 ;;
        --8bit) export NAVILA_LOAD_8BIT=1; shift ;;
        --4bit) export NAVILA_LOAD_4BIT=1; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

export CUDA_VISIBLE_DEVICES="$GPU_ID"

# Activate conda environment
eval "$(conda shell.bash hook)"
conda activate navila-eval

# Ensure project root is in PYTHONPATH
export PYTHONPATH="${PROJECT_ROOT}:${PYTHONPATH}"

echo "============================================"
echo "  NaVILA Inference Server"
echo "============================================"
echo "  Host:       ${HOST}:${PORT}"
echo "  GPU:        ${GPU_ID}"
echo "  Model:      ${NAVILA_MODEL_PATH:-${PROJECT_ROOT}/checkpoints/navila-llama3-8b-8f}"
echo "  8-bit:      ${NAVILA_LOAD_8BIT:-0}"
echo "  4-bit:      ${NAVILA_LOAD_4BIT:-0}"
echo "  Dashboard:  http://${HOST}:${PORT}/"
echo "============================================"

cd "$PROJECT_ROOT"
exec uvicorn server.app:app --host "$HOST" --port "$PORT" --workers 1
