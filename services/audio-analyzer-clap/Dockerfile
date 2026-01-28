# CLAP Audio Analyzer Service - LAION CLAP embeddings for vibe similarity
FROM python:3.10-slim

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# CPU thread limiting for PyTorch and numerical libraries
# Prevents workers from using all CPU cores
ENV OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_MAX_THREADS=1 \
    TORCH_NUM_THREADS=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create models directory
RUN mkdir -p /app/models

# Download CLAP model at build time
# Using music_audioset checkpoint for music-specific embeddings
RUN python -c "import laion_clap; model = laion_clap.CLAP_Module(enable_fusion=False, amodel='HTSAT-base'); model.load_ckpt('music_audioset_epoch_15_esc_90.14.pt'); print('CLAP model downloaded successfully')"

# Verify model exists and laion_clap works
RUN python -c "import laion_clap; print('laion_clap import: OK')"

# Copy application code
COPY analyzer.py .

# Create non-root user
RUN useradd -m -u 1000 analyzer && \
    chown -R analyzer:analyzer /app

USER analyzer

# Health check that imports laion_clap
HEALTHCHECK --interval=30s --timeout=30s --start-period=60s --retries=3 \
    CMD python -c "import laion_clap; print('OK')" || exit 1

CMD ["python", "analyzer.py"]
