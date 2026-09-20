#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

usage() {
  echo "Usage: $0 [options] [pytest args...]"
  echo ""
  echo "Run the backend test suite via docker compose."
  echo ""
  echo "Options:"
  echo "  --unit          Only run unit tests (no infra needed)"
  echo "  --manual        Interactive: list test modules and let you pick"
  echo "  -k EXPR         Pass a pytest -k filter expression"
  echo "  -v, --verbose   Verbose pytest output"
  echo "  -h, --help      Show this help"
  echo ""
  echo "Examples:"
  echo "  $0                                          # run all tests"
  echo "  $0 --unit                                   # unit tests only"
  echo "  $0 --manual                                 # pick a test module"
  echo "  $0 app/tests/test_access_control.py -v      # specific file"
  echo "  $0 -k 'scope and not postgres'              # filter by name"
}

# --- discover test modules inside the container ---
list_test_modules() {
  docker compose run --rm --no-deps -T backend \
    find app/tests -name 'test_*.py' -type f 2>/dev/null | sort
}

interactive_pick() {
  echo -e "${YELLOW}Discovering test modules...${NC}"
  local modules
  modules=$(list_test_modules)

  if [[ -z "$modules" ]]; then
    echo -e "${RED}No test modules found.${NC}"
    exit 1
  fi

  echo ""
  local i=1
  local paths=()
  while IFS= read -r mod; do
    printf "  ${GREEN}%2d${NC}  %s\n" "$i" "$mod"
    paths+=("$mod")
    ((i++))
  done <<< "$modules"

  echo ""
  read -rp "Enter number(s) to run (comma-separated, or 'a' for all): " selection

  if [[ "$selection" == "a" ]]; then
    PYTEST_ARGS=("app/tests/")
    return
  fi

  PYTEST_ARGS=()
  IFS=',' read -ra picks <<< "$selection"
  for pick in "${picks[@]}"; do
    pick=$(echo "$pick" | tr -d ' ')
    if [[ "$pick" -ge 1 && "$pick" -le "${#paths[@]}" ]] 2>/dev/null; then
      PYTEST_ARGS+=("${paths[$((pick-1))]}")
    else
      echo -e "${RED}Invalid selection: $pick${NC}"
      exit 1
    fi
  done
}

# --- parse args ---
PYTEST_ARGS=()
UNIT_ONLY=false
MANUAL=false
VERBOSE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      usage
      exit 0
      ;;
    --unit)
      UNIT_ONLY=true
      shift
      ;;
    --manual)
      MANUAL=true
      shift
      ;;
    -v|--verbose)
      VERBOSE="-v"
      shift
      ;;
    *)
      PYTEST_ARGS+=("$1")
      shift
      ;;
  esac
done

# --- resolve what to run ---
if [[ "$MANUAL" == true ]]; then
  interactive_pick
elif [[ "$UNIT_ONLY" == true ]]; then
  PYTEST_ARGS=("-m" "not postgres" "app/tests/")
elif [[ ${#PYTEST_ARGS[@]} -eq 0 ]]; then
  PYTEST_ARGS=("app/tests/")
fi

# add verbose flag if requested
if [[ -n "$VERBOSE" ]]; then
  PYTEST_ARGS=("$VERBOSE" "${PYTEST_ARGS[@]}")
fi

# --- run ---
echo -e "${DIM}pytest ${PYTEST_ARGS[*]}${NC}"
echo ""

docker compose run --rm -T backend pytest "${PYTEST_ARGS[@]}"
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  echo ""
  echo -e "${GREEN}All tests passed.${NC}"
else
  echo ""
  echo -e "${RED}Tests failed (exit $EXIT_CODE).${NC}"
fi

exit $EXIT_CODE
