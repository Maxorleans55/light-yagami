#!/bin/bash

echo "================================"
echo "  LIGHT YAGAMI BOT - STARTING"
echo "================================"

# Install cloudflared if not present
if ! command -v cloudflared &> /dev/null; then
    echo "[*] Installing cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    echo "[+] cloudflared installed"
fi

# Install npm dependencies
echo "[*] Installing dependencies..."
npm install --production 2>/dev/null

# Kill any existing processes on port 3000
echo "[*] Cleaning up port 3000..."
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

# Start cloudflared tunnel in background
echo "[*] Starting cloudflared tunnel..."
cloudflared tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &
CF_PID=$!
sleep 5

# Get the tunnel URL
TUNNEL_URL=$(grep -o 'https://[^ ]*trycloudflare.com' /tmp/cloudflared.log | head -1)

if [ -n "$TUNNEL_URL" ]; then
    echo ""
    echo "================================"
    echo "  TUNNEL URL:"
    echo "  $TUNNEL_URL"
    echo "================================"
    echo ""
    echo "Share this URL with others to connect via pairing code."
    echo ""
else
    echo "[!] Waiting for tunnel URL... checking again in 5s"
    sleep 5
    TUNNEL_URL=$(grep -o 'https://[^ ]*trycloudflare.com' /tmp/cloudflared.log | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        echo ""
        echo "================================"
        echo "  TUNNEL URL:"
        echo "  $TUNNEL_URL"
        echo "================================"
    else
        echo "[!] Could not get tunnel URL. Check /tmp/cloudflared.log"
    fi
fi

# Start the bot
echo "[*] Starting bot..."
node index.js

# Cleanup
kill $CF_PID 2>/dev/null
