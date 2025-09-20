#!/bin/bash
set -e

# Install k9s - Kubernetes CLI To Manage Your Clusters In Style
# This script installs k9s for cluster monitoring and management

echo "🎯 Installing k9s - Kubernetes CLI..."

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

case $OS in
    "Darwin")
        if command -v brew &> /dev/null; then
            echo "📦 Installing k9s via Homebrew..."
            brew install k9s
        else
            echo "❌ Homebrew not found. Please install Homebrew first:"
            echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.combrew/install/HEAD/install.sh)\""
            exit 1
        fi
        ;;
    "Linux")
        # Determine architecture
        case $ARCH in
            "x86_64")
                ARCH_SUFFIX="amd64"
                ;;
            "aarch64"|"arm64")
                ARCH_SUFFIX="arm64"
                ;;
            *)
                echo "❌ Unsupported architecture: $ARCH"
                exit 1
                ;;
        esac
        
        echo "📦 Installing k9s for Linux ($ARCH_SUFFIX)..."
        
        # Get latest version
        LATEST_VERSION=$(curl -s https://api.github.com/repos/derailed/k9s/releases/latest | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
        
        # Download and install
        DOWNLOAD_URL="https://github.com/derailed/k9s/releases/download/${LATEST_VERSION}/k9s_Linux_${ARCH_SUFFIX}.tar.gz"
        
        echo "   Downloading k9s ${LATEST_VERSION}..."
        curl -L "$DOWNLOAD_URL" -o /tmp/k9s.tar.gz
        
        echo "   Extracting and installing..."
        tar -xzf /tmp/k9s.tar.gz -C /tmp
        sudo mv /tmp/k9s /usr/local/bin/k9s
        sudo chmod +x /usr/local/bin/k9s
        
        # Cleanup
        rm -f /tmp/k9s.tar.gz
        ;;
    *)
        echo "❌ Unsupported operating system: $OS"
        echo "   Please install k9s manually from: https://github.com/derailed/k9s"
        exit 1
        ;;
esac

# Verify installation
if command -v k9s &> /dev/null; then
    echo "✅ k9s installed successfully!"
    echo "   Version: $(k9s version --short 2>/dev/null || echo 'installed')"
    echo ""
    echo "🎯 Usage:"
    echo "   k9s                              # Launch k9s"
    echo "   k9s -n open-politics            # Launch in specific namespace"
    echo "   k9s --context your-context      # Launch with specific context"
    echo ""
    echo "🔧 Key shortcuts in k9s:"
    echo "   :pods                            # View pods"
    echo "   :svc                             # View services"
    echo "   :deploy                          # View deployments"
    echo "   :logs                            # View logs"
    echo "   :describe                        # Describe resource"
    echo "   Ctrl+C                           # Exit"
else
    echo "❌ k9s installation failed"
    exit 1
fi
