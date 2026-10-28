#!/usr/bin/env python3
"""
Quick credential test for the Network Rail STOMP feed.
Connects, waits for one message, prints it, then exits.

Usage:
  python test_credentials.py
"""

import sys
import time
import os
import json
import socket
import stomp
from dotenv import load_dotenv

load_dotenv()

RECEIVED = []


class TestListener(stomp.ConnectionListener):

    def on_connected(self, frame):  # noqa: ARG002
        print("[OK] Connected to broker")

    def on_error(self, frame):
        print(f"[ERROR] Broker returned an error: {frame.body}", file=sys.stderr)
        sys.exit(1)

    def on_disconnected(self):
        print("[disconnected]")

    def on_message(self, frame):
        events = json.loads(frame.body)
        RECEIVED.append(events)
        print(f"[OK] Received message with {len(events)} event(s)")
        first = events[0] if events else {}
        header = first.get("header", {})
        body = first.get("body", {})
        print(f"     msg_type={header.get('msg_type')}  train_id={body.get('train_id')}")


def _check_tcp():
    """Try a raw TCP connect to give a clearer network-level verdict."""
    host, port = "publicdatafeeds.networkrail.co.uk", 61618
    print(f"[...] Checking raw TCP connectivity to {host}:{port}...", file=sys.stderr)
    try:
        with socket.create_connection((host, port), timeout=10):
            print(f"[OK]  TCP port {port} is reachable — issue is likely credentials.", file=sys.stderr)
    except OSError as e:
        print(f"[FAIL] TCP port {port} is NOT reachable: {e}", file=sys.stderr)
        print("       Check firewall rules or try from a different network.", file=sys.stderr)


def main():
    username = os.getenv("NR_USERNAME")
    password = os.getenv("NR_PASSWORD")

    if not username or not password:
        print("[ERROR] NR_USERNAME or NR_PASSWORD not set in .env", file=sys.stderr)
        sys.exit(1)

    print(f"[...] Connecting as {username}")

    conn = stomp.Connection12(
        host_and_ports=[("publicdatafeeds.networkrail.co.uk", 61618)],
        auto_content_length=False,
        heartbeats=(5000, 5000),
    )
    conn.set_listener("test", TestListener())

    try:
        conn.connect(username=username, passcode=password, wait=True)
    except stomp.exception.ConnectFailedException as e:
        print(f"[ERROR] Connection failed: {e}", file=sys.stderr)
        print("        Possible causes:", file=sys.stderr)
        print("          - Wrong username or password", file=sys.stderr)
        print("          - Network Rail feed is temporarily unavailable", file=sys.stderr)
        print("          - Port 61618 is blocked by a firewall", file=sys.stderr)
        _check_tcp()
        sys.exit(1)
    except socket.gaierror as e:
        print(f"[ERROR] DNS resolution failed for publicdatafeeds.networkrail.co.uk: {e}", file=sys.stderr)
        print("        Check your network/DNS settings.", file=sys.stderr)
        sys.exit(1)
    except OSError as e:
        print(f"[ERROR] TCP connection error: {e}", file=sys.stderr)
        _check_tcp()
        sys.exit(1)

    conn.subscribe(destination="/topic/TRAIN_MVT_ALL_TOC", id="1", ack="auto")
    print("[...] Subscribed — waiting up to 30s for a message...")

    deadline = time.time() + 30
    while not RECEIVED and time.time() < deadline:
        time.sleep(0.5)

    conn.disconnect()

    if RECEIVED:
        print("[OK] Credentials valid — data is flowing.")
        sys.exit(0)
    else:
        print("[WARN] Connected successfully but no message arrived within 30s.")
        print("       Credentials are likely valid; the feed may just be quiet.")
        sys.exit(0)


if __name__ == "__main__":
    main()
