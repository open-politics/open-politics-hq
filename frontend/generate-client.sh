#!/usr/bin/env bash

echo "Because of with "/" and without "/" compatibilty errors you will see prints of dupliate operationIds. So these logs are expected."


curl http://localhost:8022/api/v1/openapi.json > openapi.json &&

# Replace the Node.js script with a jq command for modifying openapi.json
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install jq to modify openapi.json." >&2
    exit 1
fi

# Modify operationIds by removing tag prefixes
jq '.paths |= map_values(map_values(if (.tags and (.tags | length > 0) and .operationId) then (.tags[0] + "-") as $prefix | if (.operationId | startswith($prefix)) then .operationId = (.operationId | ltrimstr($prefix)) else . end else . end))' ./openapi.json > ./openapi.tmp.json && mv ./openapi.tmp.json ./openapi.json

npm run generate-client


# Patch ApiRequestOptions.ts to include an optional responseType property
sed -i "/readonly errors?: Record<number, string>;/a \\\    readonly responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';" ./src/client/core/ApiRequestOptions.ts

# Patch request.ts to pass responseType from ApiRequestOptions to AxiosRequestConfig
# This allows the responseType: 'blob' (set by the above sed command for services.ts) to actually take effect in axios.
sed -i "/method: options.method,/i \\\    responseType: options.responseType as AxiosRequestConfig['responseType']," ./src/client/core/request.ts

npx biome format --write ./src/client 

echo "prestart.sh has been run successfully. OpenAPI client generated and corrected."

