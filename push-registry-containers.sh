#!/usr/bin/env bash

# Set the organization name
ORG_NAME="openpoliticsproject"  # Replace with your organization name

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# List of services with their Dockerfile paths and context paths
declare -A services=(
  ["backend"]="./backend/Dockerfile ./backend"
  ["frontend"]="./frontend/Dockerfile ./frontend"
  # ["celery_worker"]="./backend/Dockerfile ./backend"
)

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to detect OS
detect_os() {
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command_exists apt-get; then
      echo "ubuntu"
    elif command_exists yum; then
      echo "centos"
    elif command_exists pacman; then
      echo "arch"
    else
      echo "linux"
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macos"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    echo "windows"
  else
    echo "unknown"
  fi
}

# Function to install Docker
install_docker() {
  local os=$(detect_os)
  
  echo -e "${BLUE}Installing Docker...${NC}"
  
  case $os in
    "ubuntu")
      sudo apt-get update
      sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
      sudo apt-get update
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
      ;;
    "centos")
      sudo yum install -y yum-utils
      sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
      sudo systemctl start docker
      sudo systemctl enable docker
      ;;
    "arch")
      sudo pacman -S docker docker-buildx
      sudo systemctl start docker
      sudo systemctl enable docker
      ;;
    "macos")
      echo -e "${YELLOW}Please install Docker Desktop from: https://docs.docker.com/desktop/mac/install/${NC}"
      echo -e "${YELLOW}Or use Homebrew: brew install --cask docker${NC}"
      return 1
      ;;
    *)
      echo -e "${RED}Unsupported OS for automatic Docker installation.${NC}"
      echo -e "${YELLOW}Please install Docker manually from: https://docs.docker.com/get-docker/${NC}"
      return 1
      ;;
  esac
  
  # Add current user to docker group
  if [[ "$os" != "macos" ]]; then
    sudo usermod -aG docker $USER
    echo -e "${YELLOW}You may need to log out and back in for Docker group changes to take effect.${NC}"
  fi
}

# Function to check dependencies
check_dependencies() {
  local missing_deps=()
  local auto_install=${1:-false}
  
  echo -e "${BLUE}Checking dependencies...${NC}"
  
  # Check for Docker
  if ! command_exists docker; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    missing_deps+=("docker")
    
    if [[ "$auto_install" == "true" ]]; then
      read -p "Would you like to install Docker automatically? (y/N): " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        if install_docker; then
          echo -e "${GREEN}✓ Docker installed successfully${NC}"
        else
          echo -e "${RED}✗ Failed to install Docker${NC}"
          return 1
        fi
      else
        echo -e "${YELLOW}Please install Docker manually and run this script again.${NC}"
        return 1
      fi
    fi
  else
    echo -e "${GREEN}✓ Docker is installed${NC}"
  fi
  
  # Check if Docker daemon is running
  if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker daemon is not running${NC}"
    echo -e "${YELLOW}Please start Docker and try again.${NC}"
    return 1
  else
    echo -e "${GREEN}✓ Docker daemon is running${NC}"
  fi
  
  # Check for Docker Buildx
  if ! docker buildx version >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker Buildx is not available${NC}"
    echo -e "${YELLOW}Please install Docker Buildx plugin or update Docker to a newer version.${NC}"
    return 1
  else
    echo -e "${GREEN}✓ Docker Buildx is available${NC}"
  fi
  
  # Check Docker login status
  if ! docker info | grep -q "Username:"; then
    echo -e "${YELLOW}⚠ You may not be logged into Docker registry${NC}"
    echo -e "${YELLOW}Run 'docker login' if you encounter push errors${NC}"
  else
    echo -e "${GREEN}✓ Docker registry login detected${NC}"
  fi
  
  echo -e "${GREEN}All dependencies are satisfied!${NC}"
  return 0
}

# Function to display usage information
show_usage() {
  echo "Usage:"
  echo "  $0 check                   - Check if all dependencies are installed"
  echo "  $0 install                 - Check and auto-install missing dependencies"
  echo "  $0 tag <service> <tag>     - Build and push a specific service with tag"
  echo "  $0 tag all <tag>          - Build and push all services with the same tag"
  echo ""
  echo "Available services: ${!services[@]}"
  echo ""
  echo "Dependencies:"
  echo "  - Docker (with daemon running)"
  echo "  - Docker Buildx plugin"
  echo "  - Docker registry login (for pushing)"
  echo ""
  echo "Examples:"
  echo "  $0 check                   # Check dependencies"
  echo "  $0 install                 # Install missing dependencies"
  echo "  $0 tag backend v1.2.3      # Build and push backend"
  echo "  $0 tag all latest          # Build and push all services"
  echo "  $0 tag frontend dev        # Build and push frontend"
}

# Function to build and push a Docker image
build_and_push() {
  local service_name=$1
  local dockerfile_path=$2
  local context_path=$3
  local tag=$4

  echo "Building and pushing: $service_name with tag: $tag"
  
  if ! docker buildx build -t $ORG_NAME/$service_name:$tag -f $dockerfile_path $context_path; then
    echo "Error: Failed to build $service_name"
    return 1
  fi
  
  if ! docker push $ORG_NAME/$service_name:$tag; then
    echo "Error: Failed to push $service_name:$tag"
    return 1
  fi
  
  echo "Successfully built and pushed: $service_name:$tag"
}

# Function to validate service name
validate_service() {
  local service=$1
  if [[ -z "${services[$service]}" ]]; then
    echo "Error: Invalid service '$service'"
    echo "Available services: ${!services[@]}"
    return 1
  fi
  return 0
}

# Main script logic
main() {
  # Check if no arguments provided
  if [[ $# -eq 0 ]]; then
    show_usage
    exit 1
  fi

  local command=$1
  
  case $command in
    "check")
      # Check dependencies only
      check_dependencies false
      exit $?
      ;;
      
    "install")
      # Check and install dependencies
      check_dependencies true
      exit $?
      ;;
      
    "tag")
      # Check dependencies before proceeding
      if ! check_dependencies false; then
        echo -e "${RED}Dependencies not satisfied. Run '$0 install' to auto-install or '$0 check' for details.${NC}"
        exit 1
      fi
      
      # Handle both single service and all services
      if [[ $# -ne 3 ]]; then
        echo "Error: 'tag' command requires exactly 2 arguments: <service|all> <tag>"
        show_usage
        exit 1
      fi
      
      local service_or_all=$2
      local tag=$3
      
      if [[ $service_or_all == "all" ]]; then
        # Handle all services: script tag all <tag>
        local failed_services=()
        
        echo "Building and pushing all services with tag: $tag"
        
        # Build and push all services
        for service in "${!services[@]}"; do
          IFS=' ' read -r -a paths <<< "${services[$service]}"
          if ! build_and_push "$service" "${paths[0]}" "${paths[1]}" "$tag"; then
            failed_services+=("$service")
          fi
        done
        
        # Report results
        if [[ ${#failed_services[@]} -eq 0 ]]; then
          echo "✅ All services built and pushed successfully with tag: $tag"
        else
          echo "❌ Failed to build/push the following services: ${failed_services[*]}"
          exit 1
        fi
      else
        # Handle single service: script tag <service> <tag>
        local service=$service_or_all
        
        # Validate service
        if ! validate_service "$service"; then
          exit 1
        fi
        
        # Build and push the service
        IFS=' ' read -r -a paths <<< "${services[$service]}"
        build_and_push "$service" "${paths[0]}" "${paths[1]}" "$tag"
      fi
      ;;
      
    "help"|"-h"|"--help")
      show_usage
      exit 0
      ;;
      
    *)
      echo "Error: Unknown command '$command'"
      show_usage
      exit 1
      ;;
  esac
}

# Run main function with all arguments
main "$@"