import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'openapi.json',
  output: 
  { 
    path: 'src/client',
    // format: 'prettier',
  },
  plugins: [
    // '@hey-api/typescript',
    // '@hey-api/client-axios',
    {
      name: '@hey-api/sdk',
      asClass: true,
      classNameBuilder: '{{name}}Service',
      operationId: true,
      // Try without response: 'body' since it's not working
      // We'll handle the response extraction in post-processing
      response: 'body',
    },
    'legacy/axios',
  ],
});
