#!/usr/bin/env python3
"""
Basic STOMP subscriber: connects to a broker, subscribes to a topic,
prints incoming messages, and runs until cancelled (Ctrl+C).

Usage:
  python stomp_subscriber.py --host localhost --port 61613 --destination /topic/test
  python stomp_subscriber.py --host broker.example.com --port 61614 --destination /topic/market --user myuser --password secret --ssl
"""

import sys
import time
import argparse
import stomp
import json
from dotenv import load_dotenv
import os
from kafka import KafkaProducer
import pprint


load_dotenv()


class Listener(stomp.ConnectionListener):

    def __init__(self, conn):
        self.conn = conn
        bootstrap = os.getenv('KAFKA_BROKER', 'localhost:9092')
        self.producer = KafkaProducer(
            bootstrap_servers=bootstrap,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            # Pin the API version so kafka-python 2.0.2 doesn't attempt broker
            # version negotiation (ApiVersions request) which hangs against
            # Confluent Platform / Kafka 3.x+.
            api_version=(2, 5, 0),
            # Fail fast so a metadata issue doesn't block the STOMP handler thread
            # and cause heartbeat timeouts.
            request_timeout_ms=10000,
            max_block_ms=10000,
            retries=3,
            retry_backoff_ms=500,
        )
        print(f"[Kafka producer initialized] bootstrap={bootstrap}")

    def on_connected(self, frame):  # noqa: ARG002
        print("[connected]")

    def on_message(self, frame):
        try:
            body_array = json.loads(frame.body)
        except Exception as e:
            print(f"[parse error] {e}", file=sys.stderr)
            return

        for event in body_array:
            flattened_event = {}
            if "header" in event:
                flattened_event.update(event["header"])
            if "body" in event:
                flattened_event.update(event["body"])

            try:
                msg_type = flattened_event.get("msg_type", "")
                train_id = flattened_event.get('train_id', 'unknown')

                if msg_type == "0001":
                    self.producer.send("train_activations_py", flattened_event)
                    print(f"[activation] Train {train_id}")
                elif msg_type == "0002":
                    self.producer.send("train_cancellations_py", flattened_event)
                    print(f"[cancellation] Train {train_id}")
                elif msg_type == "0003":
                    self.producer.send("train_movements_py", flattened_event)
                    print(f"[movement] Train {train_id} at {flattened_event.get('loc_stanox', '?')}")
                elif msg_type == "0005":
                    self.producer.send("train_reinstatements_py", flattened_event)
                    print(f"[reinstatement] Train {train_id}")
                elif msg_type == "0006":
                    self.producer.send("train_coo_py", flattened_event)
                    print(f"[change_of_origin] Train {train_id}")
                elif msg_type == "0007":
                    self.producer.send("train_coi_py", flattened_event)
                    print(f"[change_of_identity] Train {train_id}")

                # All events go to the catch-all topic too
                self.producer.send("train_events", flattened_event)
                # Non-blocking — let the producer batch and send in the background.
                # Do NOT call flush() here; it blocks the STOMP heartbeat thread
                # and causes heartbeat timeouts under load.
            except Exception as e:
                print(f"[kafka error] {e}", file=sys.stderr)

    def on_error(self, frame):
        print(f"[error] {frame}", file=sys.stderr)

    def on_disconnected(self):
        print("[disconnected]")


def make_connection():
    """Create a fresh STOMP connection and attach the listener."""
    conn = stomp.Connection12(
        host_and_ports=[("publicdatafeeds.networkrail.co.uk", 61618)],
        auto_content_length=False,
        heartbeats=(5000, 5000),
    )
    listener = Listener(conn)
    conn.set_listener("print", listener)
    return conn


def connect_and_subscribe(conn):
    """Connect to the NR STOMP broker and subscribe to the movement feed."""
    # Do NOT set client-id in the CONNECT frame.
    # ActiveMQ treats client-id as a durable subscription identifier — setting it
    # creates a persistent consumer that survives disconnects and accumulates on
    # the broker, eventually causing AMQ339009 (session/subscription limit hit).
    # Without client-id the broker creates a lightweight non-durable consumer
    # that is automatically cleaned up the moment the TCP connection closes.
    print("attempting to connect")
    conn.connect(
        username=os.getenv("NR_USERNAME"),
        passcode=os.getenv("NR_PASSWORD"),
        wait=True,
    )
    print("attempting to subscribe")
    conn.subscribe(
        destination="/topic/TRAIN_MVT_ALL_TOC",
        id="1",
        ack="auto",
    )
    print("[subscribed] /topic/TRAIN_MVT_ALL_TOC (non-durable)")


def main():
    MIN_DELAY = 10   # seconds — initial retry wait
    MAX_DELAY = 30   # seconds — cap for exponential backoff
    delay = MIN_DELAY

    conn = make_connection()

    try:
        while True:
            # ── Connect ───────────────────────────────────────────────────────
            if not conn.is_connected():
                try:
                    connect_and_subscribe(conn)
                    delay = MIN_DELAY  # reset backoff on successful connect
                except Exception as e:
                    print(f"[connect failed] {e} — retrying in {delay}s",
                          file=sys.stderr)
                    # Recreate the connection object; the old one may be in a
                    # broken state after an ERROR frame from the broker.
                    try:
                        conn.disconnect()
                    except Exception:
                        pass
                    time.sleep(delay)
                    delay = min(delay * 2, MAX_DELAY)  # exponential backoff
                    conn = make_connection()
                    continue

            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\n[shutdown] KeyboardInterrupt received.")
    finally:
        try:
            if conn.is_connected():
                conn.disconnect()
        except Exception:
            pass
        print("[bye]")


if __name__ == "__main__":
    main()
