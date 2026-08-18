# Checkmate Coach — Python analysis + OCR service (FastAPI)
# Runs Stockfish (engine) and Tesseract (scoresheet OCR).
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    stockfish \
    tesseract-ocr \
    tesseract-ocr-eng \
    # opencv-python-headless native requirements
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Debian installs stockfish to /usr/games, which is not on PATH in containers.
RUN ln -sf /usr/games/stockfish /usr/local/bin/stockfish

# Isolated environment (Debian bookworm marks the system Python as externally managed).
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The two pipeline modules live at the repo root; main.py prepends the parent
# directory to sys.path, so keep this layout.
COPY service/main.py service/main.py
COPY chessintel_clone.py scoresheet_ocr.py ./

ENV STOCKFISH_PATH=stockfish

EXPOSE 8000
CMD ["uvicorn", "service.main:app", "--host", "0.0.0.0", "--port", "8000"]
