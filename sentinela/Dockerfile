FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sentinela ./sentinela
RUN useradd -r -u 1001 sentinela && mkdir -p /app/data && chown sentinela /app/data
USER sentinela
ENV SENTINELA_HOST=0.0.0.0 SENTINELA_PORT=8000
EXPOSE 8000
CMD ["python", "-m", "sentinela", "--db", "/app/data/sentinela.db", "api"]
