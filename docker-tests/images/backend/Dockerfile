# Simulated proxy destinations: L7 HTTP/HTTPS/WebSocket origins and raw L4
# TCP/UDP endpoints. One image, one script, mode chosen by the command.
FROM python:3.12-alpine

COPY server.py /srv/server.py

ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python3", "/srv/server.py"]
CMD ["http", "8080"]
