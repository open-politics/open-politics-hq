import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  client: 'legacy/axios',
  input: 'openapi.json',
  output: {
    path: 'src/client',
  },
  plugins: [
    {
      name: '@hey-api/sdk',
      asClass: true,
      classNameBuilder: '{{name}}Service',
      operationId: true,
      response: 'body',
    },
  ],
});
