FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 YOLO_CONFIG_DIR=/tmp/Ultralytics YOLO_MODEL=/app/yolo11n.pt PORT=8080
RUN python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')" && test -f yolo11n.pt
COPY worker.py health_runner.py ./
EXPOSE 8080
CMD ["python","health_runner.py"]
