FROM python:3.11-slim

RUN pip install duckdb duckdb-rest-api pandas

WORKDIR /app

COPY init.sql /app/init.sql
COPY server.py /app/server.py

RUN mkdir -p /data

EXPOSE 8080

CMD ["python", "server.py"]