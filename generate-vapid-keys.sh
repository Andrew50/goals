#!/bin/bash

# Script to generate VAPID keys for web push notifications

echo "Generating VAPID keys for web push notifications..."
echo ""

# Check if npx is available
if ! command -v npx &> /dev/null; then
    echo "Error: npx is not installed. Please install Node.js and npm first."
    exit 1
fi

# Generate VAPID keys
OUTPUT=$(npx web-push generate-vapid-keys 2>/dev/null)

if [ $? -ne 0 ]; then
    echo "Error: Failed to generate VAPID keys."
    echo "Installing web-push globally..."
    npm install -g web-push
    OUTPUT=$(web-push generate-vapid-keys)
fi

# Extract keys
PUBLIC_KEY=$(echo "$OUTPUT" | grep "Public Key:" | cut -d' ' -f3)
PRIVATE_KEY=$(echo "$OUTPUT" | grep "Private Key:" | cut -d' ' -f3)

if [ -z "$PUBLIC_KEY" ] || [ -z "$PRIVATE_KEY" ]; then
    echo "Error: Failed to extract VAPID keys."
    echo "Raw output:"
    echo "$OUTPUT"
    exit 1
fi

echo "==============================================="
echo "VAPID Keys Generated Successfully!"
echo "==============================================="
echo ""
echo "Add these to your .env file:"
echo ""
echo "VAPID_PUBLIC_KEY=$PUBLIC_KEY"
echo "VAPID_PRIVATE_KEY=$PRIVATE_KEY"
echo "VAPID_SUBJECT=mailto:admin@yourdomain.com"
echo ""
echo "==============================================="
echo ""
echo "Note: Keep the private key secure and never commit it to version control!"
echo "The public key will be used in the frontend for push subscription."
