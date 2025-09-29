To generate the frontend client, run:

```bash
chmod +x generate-client.sh
./generate-client.sh
```

make sure you have jq, and nvm installed

#### Warning: depending on when you read this, the version of nvm may be different.
#### Check the latest version here: https://github.com/nvm-sh/nvm

Quick install on linux:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm use --lts


On mac:
https://nodejs.org/en/download
'
# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# in lieu of restarting the shell
\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install 22

# Verify the Node.js version:
node -v # Should print "v22.20.0".

# Verify npm version:
npm -v # Should print "10.9.3".
'


# Development

For development the compose.override.yml sets the to Dockerfile.dev which uses bun instead of npm.
