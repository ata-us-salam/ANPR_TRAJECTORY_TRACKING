# ==============================================================================
# Multi-Stage Production Dockerfile for City-Wide ANPR Trajectory Tracking
# ==============================================================================

FROM python:3.11-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install critical system libraries required for OpenCV, PyTorch, and networking
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# Copy application source code and static assets
COPY . .

# Ensure data and export directories exist
RUN mkdir -p data/exports data/uploads

# Create a non-privileged user for security
RUN groupadd -r anprgroup && useradd -r -g anprgroup -d /app anpruser && \
    chown -R anpruser:anprgroup /app

USER anpruser

# Expose standard application port
EXPOSE 8000

# Container healthcheck targeting the FastAPI /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Launch using production-grade Gunicorn with Uvicorn workers
CMD ["gunicorn", "backend.main:app", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--keep-alive", "5", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
