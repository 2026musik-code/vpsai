import sys
import time
import requests
import subprocess
import os
import json

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 vps_agent.py <API_URL> <AUTH_TOKEN>")
        sys.exit(1)

    API_URL = sys.argv[1].rstrip('/')
    AUTH_TOKEN = sys.argv[2]
    HEADERS = {'Authorization': AUTH_TOKEN, 'Content-Type': 'application/json'}

    print(f">>> VPS Agent starting...")
    print(f">>> Connecting to {API_URL}")

    while True:
        try:
            # 1. Heartbeat & Poll
            # We combine heartbeat and polling to save requests
            try:
                r = requests.get(f"{API_URL}/api/agent/tasks", headers=HEADERS, timeout=10)
            except requests.exceptions.RequestException as e:
                print(f"!!! Connection Error: {e}")
                time.sleep(5)
                continue

            if r.status_code == 401:
                print("!!! Unauthorized. Check token.")
                sys.exit(1)

            if r.status_code != 200:
                print(f"!!! Server Error: {r.status_code}")
                time.sleep(5)
                continue

            data = r.json()
            command_id = data.get('id')
            command_str = data.get('command')

            if command_id and command_str:
                print(f">>> Executing: {command_str}")

                # Execute Command
                try:
                    # Capture both stdout and stderr
                    # Use shell=True for complex bash commands, but be careful (auth token implies trust)
                    process = subprocess.Popen(
                        command_str,
                        shell=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        executable='/bin/bash'
                    )

                    stdout, stderr = process.communicate()
                    output = stdout + stderr
                    exit_code = process.returncode

                except Exception as e:
                    output = f"Execution Error: {e}"
                    exit_code = 1

                # Send Result
                result_payload = {
                    'id': command_id,
                    'output': output,
                    'exit_code': exit_code
                }

                print(f">>> Sending Result ({len(output)} chars)...")
                requests.post(f"{API_URL}/api/agent/result", headers=HEADERS, json=result_payload)

            else:
                # No tasks, just heartbeat
                # print(".", end="", flush=True)
                pass

        except KeyboardInterrupt:
            print("\n>>> Stopping Agent.")
            break
        except Exception as e:
            print(f"\n!!! Unexpected Error: {e}")

        time.sleep(1)

if __name__ == "__main__":
    main()
