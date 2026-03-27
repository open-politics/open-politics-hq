#!/usr/bin/env bash




curl http://localhost:8022/api/v1/openapi.json > openapi.json &&

# Replace the Node.js script with a jq command for modifying openapi.json
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install jq to modify openapi.json." >&2
    exit 1
fi

# Modify operationIds by removing tag prefixes
jq '.paths |= map_values(map_values(if (.tags and (.tags | length > 0) and .operationId) then (.tags[0] + "-") as $prefix | if (.operationId | startswith($prefix)) then .operationId = (.operationId | ltrimstr($prefix)) else . end else . end))' ./openapi.json > ./openapi.tmp.json && mv ./openapi.tmp.json ./openapi.json

bun run generate-client

echo "Client generated. Duplicate operationId warnings from package-token route variants are expected."

