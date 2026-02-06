#!/bin/bash

# VPS AI Environment Auto-Installer
# Usage: ./setup.sh <API_URL> <TOKEN>

API_URL=$1
TOKEN=$2

if [ -z "$API_URL" ] || [ -z "$TOKEN" ]; then
    echo "Usage: ./setup.sh <API_URL> <TOKEN>"
    exit 1
fi

echo ">>> Starting AI Environment Setup..."

# 1. Update Server (Optional - can be slow, skipping for speed in demo)
# echo ">>> Updating system packages..."
# sudo apt-get update

# 2. Install Python & Basic Tools
echo ">>> Checking Python3..."
if ! command -v python3 &> /dev/null; then
    echo "Installing Python3..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y python3 python3-pip
    elif command -v yum &> /dev/null; then
        sudo yum install -y python3 python3-pip
    fi
else
    echo "Python3 is already installed."
fi

# 3. Create Project Directory
PROJECT_DIR=~/vps-ai-agent
echo ">>> Creating workspace at $PROJECT_DIR..."
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# 4. Download Agent Script
echo ">>> Downloading Agent Script..."
curl -sL "$API_URL/vps_agent.py" -o vps_agent.py

# 5. Install Dependencies
echo ">>> Installing dependencies..."
pip3 install requests --break-system-packages 2>/dev/null || pip3 install requests

# 6. Run Agent (Daemon Mode)
echo ">>> Configuring Agent as a background service..."

# Create a robust runner script that restarts the agent if it crashes
cat > run_agent.sh <<EOF
#!/bin/bash
while true; do
    echo "Starting VPS Agent..." >> agent.log
    python3 vps_agent.py "$API_URL" "$TOKEN" >> agent.log 2>&1
    echo "Agent crashed/stopped. Restarting in 3 seconds..." >> agent.log
    sleep 3
done
EOF

chmod +x run_agent.sh

# Kill existing agent if running
pkill -f vps_agent.py || true
pkill -f run_agent.sh || true

# Start the runner in background
nohup ./run_agent.sh > /dev/null 2>&1 &

echo ">>> Agent Started in Daemon Mode! (PID: $!)"
echo ">>> Logs available at $PROJECT_DIR/agent.log"
echo ">>> You can close this terminal now. The agent will auto-restart if it crashes."
