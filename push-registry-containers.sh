#!/usr/bin/env bash

# Set the organization name
ORG_NAME="openpoliticsproject"  # Replace with your organization name

# Function to build and push a Docker image
build_and_push() {
  local service_name=$1
  local dockerfile_path=$2
  local context_path=$3
  local tag=$4

  echo "Building and pushing: $service_name with tag: $tag"
  docker buildx build -t $ORG_NAME/$service_name:$tag -f $dockerfile_path $context_path
  docker push $ORG_NAME/$service_name:$tag
}

# List of services with their Dockerfile paths and context paths
declare -A services=(
  ["backend"]="./backend/Dockerfile ./backend"
  ["frontend"]="./frontend/Dockerfile ./frontend"
  ["celery_worker"]="./backend/Dockerfile ./backend"

)

# Function to get tags for selected items
get_tags() {
  local -n items=$1
  declare -A tags
  for item in "${items[@]}"; do
    read -p "Enter a tag for $item (default: latest): " tag
    tags[$item]=${tag:-latest}
  done

  # Export tags as a string with key:value pairs separated by space
  local tag_string=""
  for key in "${!tags[@]}"; do
    tag_string+="$key:${tags[$key]} "
  done
  echo "$tag_string"
}

# Main menu for selecting build options
echo "Select an option:"
echo "1) Build and push all services"
echo "2) Select specific services to build and push"
read -p "Enter your choice: " choice

case $choice in
  1)
    selected_items=("${!services[@]}")
    ;;
  2)
    echo "Select specific services (space-separated):"
    echo "Available services: ${!services[@]}"
    read -a selected_items
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

# Get tags for selected items
tag_pairs=$(get_tags selected_items)
declare -A tags
for pair in $tag_pairs; do
  key=${pair%%:*}
  value=${pair#*:}
  tags[$key]=$value
done

# Build and push selected items
for item in "${selected_items[@]}"; do
  if [[ -n "${services[$item]}" ]]; then
    IFS=' ' read -r -a paths <<< "${services[$item]}"
    build_and_push "$item" "${paths[0]}" "${paths[1]}" "${tags[$item]}"
  else
    echo "Invalid item: $item"
    continue
  fi
done

echo "Build and push completed"


