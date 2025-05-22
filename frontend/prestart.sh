#!/usr/bin/env bash

# curl http://localhost:8022/api/v1/openapi.json > openapi.json &&

# npx run modify-openapi-operationids.js 

npm run generate-client 

sed -i "s/default: pending,/default: 'pending',/g" ./src/client/schemas.ts
sed -i "s/default: paused,/default: 'paused',/g" ./src/client/schemas.ts
sed -i "s/default: read_only,/default: 'read_only',/g" ./src/client/schemas.ts
sed -i "s/default: success,/default: 'success',/g" ./src/client/schemas.ts

# Patch ShareablesService.exportResourcesBatch in services.ts to set responseType: 'blob'
# This ensures that axios handles the ZIP response correctly as a Blob for file download.
sed -i "/\\/api\\/v1\\/shareables\\/shareables\\/export-batch/,/^[[:space:]]*errors: {/s/\(^[[:space:]]*body: requestBody,\)/            responseType: 'blob',\\n\1/" ./src/client/services.ts

# Patch ApiRequestOptions.ts to include an optional responseType property
sed -i "/readonly errors?: Record<number, string>;/a \\\    readonly responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';" ./src/client/core/ApiRequestOptions.ts

# Patch request.ts to pass responseType from ApiRequestOptions to AxiosRequestConfig
# This allows the responseType: 'blob' (set by the above sed command for services.ts) to actually take effect in axios.
sed -i "/method: options.method,/i \\\    responseType: options.responseType as AxiosRequestConfig['responseType']," ./src/client/core/request.ts

npx biome format --write ./src/client 

echo "prestart.sh has been run successfully. OpenAI client generated and corrected."

