#!/bin/bash

# VPS AI Environment Auto-Installer
# Usage: ./setup_vps.sh

echo ">>> Starting AI Environment Setup..."

# 1. Update Server
echo ">>> Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

# 2. Install Python & Basic Tools
echo ">>> Installing Python3 and dependencies..."
sudo apt-get install -y python3 python3-pip python3-venv git curl wget build-essential

# 3. Create Project Directory
PROJECT_DIR=~/vps-ai-workspace
echo ">>> Creating workspace at $PROJECT_DIR..."
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# 4. Create Virtual Environment
echo ">>> Setting up virtual environment..."
python3 -m venv venv
source venv/bin/activate

# 5. Install Common AI Libraries (Lightweight set for generic tasks)
# Adjust this list based on specific needs (TensorFlow/PyTorch are heavy)
echo ">>> Installing AI helper libraries..."
pip install --upgrade pip
pip install numpy pandas requests python-dotenv

echo ">>> Setup Complete!"
echo ">>> Virtual Environment is located at: $PROJECT_DIR/venv"
echo ">>> To activate: source ~/vps-ai-workspace/venv/bin/activate"
