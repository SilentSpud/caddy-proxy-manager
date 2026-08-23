#!/usr/bin/env python3
"""Minimal WebSocket client, used to prove a proxied upgrade stays usable.

    ws_client.py HOST PATH CA_BUNDLE MESSAGE [PORT]

Performs the RFC 6455 handshake over TLS, sends MESSAGE as a masked text frame
and prints every frame the server sends back, one per line, until the server
echoes the message or the read times out. Exits non-zero if the handshake did
not produce a 101.

Written against the standard library only: the client container carries no
Python packages, and a websocket assertion should not need one.
"""

import base64
import os
import socket
import ssl
import struct
import sys


def recv_exactly(sock, count):
    buf = b""
    while len(buf) < count:
        chunk = sock.recv(count - len(buf))
        if not chunk:
            raise EOFError("connection closed mid-frame")
        buf += chunk
    return buf


def read_frame(sock):
    header = recv_exactly(sock, 2)
    opcode = header[0] & 0x0F
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", recv_exactly(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exactly(sock, 8))[0]
    # Servers must not mask, so there is no mask key to read.
    payload = recv_exactly(sock, length) if length else b""
    return opcode, payload


def send_frame(sock, payload, opcode=0x1):
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < (1 << 16):
        header.append(0x80 | 126)
        header += struct.pack(">H", length)
    else:
        header.append(0x80 | 127)
        header += struct.pack(">Q", length)
    sock.sendall(bytes(header) + mask + masked)


def main(argv):
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    host, path, ca_bundle, message = argv[1], argv[2], argv[3], argv[4]
    port = int(argv[5]) if len(argv) > 5 else 443

    context = ssl.create_default_context(cafile=ca_bundle)
    raw = socket.create_connection((host, port), timeout=15)
    sock = context.wrap_socket(raw, server_hostname=host)
    sock.settimeout(15)

    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        "GET %s HTTP/1.1\r\n"
        "Host: %s\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n" % (path, host, key)
    )
    sock.sendall(request.encode())

    # Read just the response head; anything after the blank line is framing.
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(1)
        if not chunk:
            print("connection closed during handshake", file=sys.stderr)
            return 1
        head += chunk

    status_line = head.split(b"\r\n", 1)[0].decode("latin-1")
    if "101" not in status_line:
        print("handshake failed: %s" % status_line, file=sys.stderr)
        return 1
    print("handshake: %s" % status_line)

    send_frame(sock, message.encode())

    for _ in range(6):
        try:
            opcode, payload = read_frame(sock)
        except (EOFError, socket.timeout):
            break
        if opcode == 0x8:
            break
        text = payload.decode("utf-8", "replace")
        print(text)
        if text == "echo:" + message:
            break

    try:
        send_frame(sock, b"", opcode=0x8)
        sock.close()
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
