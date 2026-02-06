import sys
import time
import requests
import subprocess
import os
import json
import base64

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 vps_agent.py <API_URL> <AUTH_TOKEN>")
        sys.exit(1)

    API_URL = sys.argv[1].rstrip('/')
    AUTH_TOKEN = sys.argv[2]
    HEADERS = {'Authorization': AUTH_TOKEN, 'Content-Type': 'application/json'}

    print(f">>> VPS Agent starting...")
    print(f">>> Connecting to {API_URL}")

    # Initial Hello to wake up session
    try:
        requests.get(f"{API_URL}/api/agent/tasks", headers=HEADERS, timeout=10)
        print(">>> Connected to Server!")
    except:
        pass

    while True:
        try:
            # 1. Heartbeat & Poll
            try:
                r = requests.get(f"{API_URL}/api/agent/tasks", headers=HEADERS, timeout=30)
            except requests.exceptions.RequestException as e:
                print(f"!!! Connection Error: {e}")
                time.sleep(5)
                continue

            if r.status_code == 401:
                print("!!! Unauthorized. Check token.")
                sys.exit(1)

            if r.status_code != 200:
                time.sleep(1)
                continue

            data = r.json()
            task_id = data.get('id')
            action = data.get('action')
            payload = data.get('payload', {})

            if task_id and action:
                print(f">>> Received Task {task_id}: {action}")

                result = {
                    'id': task_id,
                    'success': False,
                    'output': '',
                    'data': None
                }

                try:
                    if action == 'exec':
                        cmd = payload.get('command')
                        # Use subprocess.run with timeout to prevent hanging forever
                        try:
                            # Run with timeout (e.g., 60 seconds for normal commands)
                            # For long running tasks, user should use 'nohup' or '&'
                            proc = subprocess.run(
                                cmd,
                                shell=True,
                                executable='/bin/bash',
                                capture_output=True,
                                text=True,
                                timeout=120
                            )
                            result['output'] = proc.stdout + proc.stderr
                            result['exit_code'] = proc.returncode
                            result['success'] = (proc.returncode == 0)
                        except subprocess.TimeoutExpired:
                            result['output'] = "Error: Command timed out (limit: 120s)."
                            result['success'] = False

                    elif action == 'read':
                        path = os.path.expanduser(payload.get('path'))
                        if os.path.exists(path) and os.path.isfile(path):
                            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                                result['data'] = f.read()
                            result['success'] = True
                        else:
                            result['output'] = f"File not found: {path}"

                    elif action == 'write':
                        path = os.path.expanduser(payload.get('path'))
                        content = payload.get('content')
                        # Ensure directory exists
                        dir_path = os.path.dirname(path)
                        if dir_path and not os.path.exists(dir_path):
                            os.makedirs(dir_path, exist_ok=True)

                        with open(path, 'w', encoding='utf-8') as f:
                            f.write(content)
                        result['success'] = True
                        result['output'] = f"Written to {path}"

                    elif action == 'list':
                        path = os.path.expanduser(payload.get('path', '.'))
                        items = []
                        if os.path.exists(path) and os.path.isdir(path):
                            for entry in os.scandir(path):
                                items.append({
                                    'name': entry.name,
                                    'isDirectory': entry.is_dir(),
                                    'path': entry.path,
                                    'size': entry.stat().st_size if not entry.is_dir() else 0
                                })
                            items.sort(key=lambda x: (not x['isDirectory'], x['name']))
                            result['data'] = items
                            result['success'] = True
                        else:
                            result['output'] = f"Directory not found: {path}"

                    elif action == 'delete':
                         path = os.path.expanduser(payload.get('path'))
                         if os.path.exists(path):
                             if os.path.isdir(path):
                                 import shutil
                                 shutil.rmtree(path)
                             else:
                                 os.remove(path)
                             result['success'] = True
                             result['output'] = f"Deleted {path}"
                         else:
                             result['output'] = "Path not found"

                except Exception as e:
                    result['output'] = f"Agent Execution Error: {str(e)}"

                # Send Result
                try:
                    requests.post(f"{API_URL}/api/agent/result", headers=HEADERS, json=result, timeout=10)
                except Exception as e:
                    print(f"!!! Failed to send result: {e}")

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"\n!!! Unexpected Error: {e}")
            time.sleep(2)

        time.sleep(0.1)

if __name__ == "__main__":
    main()
