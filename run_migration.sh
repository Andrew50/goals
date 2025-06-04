#!/bin/bash

# Server URL
SERVER_URL="http://localhost:5059"

# Step 1: Sign in to get auth token
echo "Signing in to get auth token..."

# Replace these with your actual credentials
USERNAME="user"
PASSWORD="pass"

# Sign in and extract the token from the response
TOKEN_RESPONSE=$(curl -s -X POST "${SERVER_URL}/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

# Extract token from JSON response (assumes response format: {"token":"..."})
TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to get auth token. Response: $TOKEN_RESPONSE"
  exit 1
fi

echo "Successfully obtained auth token"

# Step 2: Run the migration
echo "Running migration..."

MIGRATION_RESPONSE=$(curl -s -X POST "${SERVER_URL}/migration/migrate-to-events" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json")

echo "Migration response: $MIGRATION_RESPONSE"

# Check if migration was successful
if [[ $MIGRATION_RESPONSE == *"Migration completed successfully"* ]]; then
  echo "✅ Migration completed successfully!"
else
  echo "❌ Migration may have failed. Please check the response above."
fi 