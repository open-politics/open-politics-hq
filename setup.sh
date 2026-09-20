#!/usr/bin/env bash
#
# HQ — single entrypoint.
#
#   ./setup.sh           interactive dashboard (default)
#   ./setup.sh --help    flag reference (automation / CI)
#
# Compose profiles do the orchestration; this script stays thin.
set -euo pipefail
cd "$(dirname "$0")"

# Scrub HQ config vars from the shell env BEFORE anything else. Compose's
# `${VAR}` interpolation in compose.yml resolves from SHELL FIRST, then .env.
# If a user has any of these exported (from .bashrc, `set -a; source .env`,
# a previous setup attempt that leaked into the shell, etc.), services that
# use `${VAR}` interpolation would pick the shell value while services that
# use `env_file:` would pick the .env value — silent divergence that survives
# every `docker compose down -v` because shell env outlives container teardown.
# The only sane source of truth is .env; defend it by clearing the rest.
unset POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB POSTGRES_PORT POSTGRES_SERVER \
      REDIS_PASSWORD REDIS_PORT REDIS_HOST REDIS_DB \
      S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN \
      DOMAIN ACME_EMAIL BACKEND_PORT FRONTEND_PORT BACKEND_BIND_HOST \
      SECRET_KEY ENCRYPTION_MASTER_KEY ENCRYPTION_MASTER_KEY_FALLBACKS \
      FIRST_SUPERUSER FIRST_SUPERUSER_PASSWORD \
      LOCAL_STORAGE_HOST_PATH LOCAL_STORAGE_BASE_PATH \
      BACKEND_WORKERS CELERY_CONCURRENCY CELERY_PROCESSING_CONCURRENCY \
      COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME COMPOSE_BAKE \
      HQ_BIND_HOST HQ_SEARXNG_PORT HQ_CONFIG_SHA \
      TAG INSTALL_DEV DOCKER_IMAGE_BACKEND S3_BUCKET_NAME 2>/dev/null || true

# ── Constants ─────────────────────────────────────────────────────────────────

# ANSI-C quoting so the bytes are real ESC (works through `printf %s`).
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'
DIM=$'\033[2m';   BOLD=$'\033[1m';     NC=$'\033[0m'

# Path, then the mode it is written with. One rule decides the mode: 600 iff the
# file can hold a secret, 644 otherwise. my-hq.yml is 644 deliberately — it holds
# no key material, and 600 would couple it to whatever UID the backend container
# runs as the day that stops being root.
ENV_FILE=".env";                                      ENV_MODE=600
EXAMPLE_FILE=".env.example"
CONF_FILE="my-hq.yml";                                CONF_MODE=644
CONF_EXAMPLE="my-hq.example.yml"
SETUP_CONF=".config/hq/setup.conf";                   SETUP_CONF_MODE=644
HOST_NET_FRAGMENT=".config/hq/compose.host-net.yml";  HOST_NET_MODE=644
GARAGE_CONFIG=".config/hq/garage.toml";               GARAGE_CONFIG_MODE=644
ENV_BACKUP_DIR=".config/hq/backups/env_files";        ENV_BACKUP_DIR_MODE=700
PLACEHOLDERS="|changeThis|changethis|app_user|app_user_password|"
OPTIONAL_SERVICES=(garage ollama searxng nominatim caddy)

# ── Foundation service providers ──────────────────────────────────────────────
# Two tables, and both hold only what my-hq.yml cannot tell us.
#
# Everything else is READ from the config: whether we run a provider, where it
# lives, which .env variable holds its key, who may use it. The eight-field
# rows this replaces restated all of that, so adding a provider meant editing
# the same fact in two files and the two drifted — a menu row for a Gemini
# provider the backend never declared, a geocoding key renamed in one place
# only. Derive it and there is nothing to keep in sync.

# Which providers serve which capability. Not inferable from the config,
# because a provider you have switched OFF must still be offerable in the menu.
PROVIDERS_FOR="
language   ollama llamacpp openai anthropic mistral
embedding  ollama openai jina voyage
storage    local_fs s3
web_search searxng tavily
geocoding  nominatim_local nominatim_api mapbox
ocr        tesseract ollama
scraping   newspaper4k
"

# Display only: name, and where it runs / who pays. Never model names — those
# go stale the moment a vendor ships, and the app's model picker lists what the
# endpoint actually has.
PROVIDER_INFO="
ollama|Ollama|open models, in a container on this machine
llamacpp|llama.cpp|open models, llama-server already running on the host
openai|OpenAI|hosted, needs an API key
anthropic|Anthropic|hosted, needs an API key
mistral|Mistral|hosted, needs an API key
jina|Jina|hosted embeddings, needs an API key
voyage|Voyage|hosted embeddings, needs an API key
local_fs|Local files|files live under ./.store/local_fs on this machine
s3|Object storage (S3)|Garage in Docker, or point it at Hetzner / AWS / any S3
searxng|SearXNG|meta-searches DuckDuckGo, Brave, Bing
tavily|Tavily|search API tuned for agent use
nominatim_local|Nominatim (local)|OSM on your hardware, ~5GB + ~2h first import
nominatim_api|Nominatim (public)|free public API, no key, rate-limited
mapbox|Mapbox|paid, fast, high quality
tesseract|Tesseract|built in, always available, no setup
newspaper4k|Newspaper4k|built into the backend, always available
"

CAPABILITY_LIST=(
  "language|AI chat models|chat, annotation, agents"
  "embedding|Embeddings|semantic search, retrieval"
  "storage|File storage|uploads, dataset blobs, exports"
  "web_search|Web search|live news, agent browsing"
  "geocoding|Geocoding|place names ↔ coordinates"
  "ocr|OCR|text from images and scans"
  "scraping|Web scraping|article text from URLs"
)

cap_field() {  # cap_field CAP_KEY {label|desc}
  local want="$2" row ck cl cd
  for row in "${CAPABILITY_LIST[@]}"; do
    IFS='|' read -r ck cl cd <<< "$row"
    [[ "$ck" == "$1" ]] || continue
    case "$want" in label) echo "$cl" ;; desc) echo "$cd" ;; esac
    return 0
  done
}

prov_field() {  # prov_field CAP PROVIDER {label|kind|profile|key_env|notes}
  local cap="$1" prov="$2" want="$3" host
  case "$want" in
    label|notes)
      local line l n
      line="$(printf '%s\n' "$PROVIDER_INFO" | awk -F'|' -v k="$prov" '$1==k{print; exit}')"
      IFS='|' read -r _ l n <<< "$line"
      [[ "$want" == label ]] && echo "${l:-$prov}" || echo "$n"
      ;;
    key_env)   yget "foundation.providers.$prov.key_env" ;;
    profile)   prov_profile "$prov" ;;
    kind)
      # A provider we can start is a container; one with a key is somebody
      # else's service; anything with neither runs inside the backend.
      if [[ -n "$(prov_profile "$prov")" ]]; then echo container
      elif [[ -n "$(yget "foundation.providers.$prov.base_url")" ]]; then echo cloud
      else echo builtin; fi
      ;;
  esac
  return 0
}

# The compose profile a provider needs, or empty. Derived from its address:
# a base_url pointing at something listed in foundation.run is that container.
prov_profile() {
  local prov="$1" host
  # s3 is the one address that isn't under providers.* — the bucket lives in
  # deployment.services.s3, and garage is what serves it locally.
  if [[ "$prov" == "s3" ]]; then
    host="$(url_host "$(yget deployment.services.s3.endpoint)")"
  else
    host="$(url_host "$(yget "foundation.providers.$prov.base_url")")"
  fi
  [[ -z "$host" ]] && { echo ""; return 0; }
  ykeys foundation.run | grep -qFx "$host" && echo "$host" || echo ""
  return 0
}

# Grants and defaults, read and written where they live. There used to be a
# PROVIDER_ACCESS_<CAP>_<KEY> string built here and decoded again two calls
# later — an encode/decode round trip between two places that both already had
# (capability, provider). That concatenated key is the thing this whole change
# set out to delete; synthesising it in the script just moved it.
prov_grant()     { yget "foundation.access.$1.$2"; }                 # CAP PROV
prov_set_grant() { yadd "foundation.access.$1" "$2" "$3"; }          # CAP PROV LEVEL

# Which provider answers a capability when nobody picked. language and
# embedding have none: a stored vector's dimension depends on the choice, so it
# is always the user's.
cap_default() {  # CAP
  case "$1" in
    language|embedding) echo "" ;;
    storage)            yget deployment.storage.use ;;
    *)                  yget "foundation.use.$1" ;;
  esac
}
cap_set_default() {  # CAP PROVIDER
  case "$1" in
    language|embedding) : ;;
    storage)            yset deployment.storage.use "$2" ;;
    *)                  yset "foundation.use.$1" "$2" ;;
  esac
  return 0
}
# True when this capability resolves to exactly one provider deployment-wide.
cap_has_default() { [[ "$1" != language && "$1" != embedding ]]; }

providers_for_cap() {  # echo each provider_key for a capability, in order
  printf '%s\n' "$PROVIDERS_FOR" | awk -v c="$1" '$1==c{for(i=2;i<=NF;i++) print $i}'
}


# True for capabilities that resolve to exactly one provider deployment-wide
# (no user-pickable runtime override). Status display treats these as a radio
# button — only the current system default is "active."
cap_is_exclusive() {
  case "$1" in storage|scraping) return 0 ;; *) return 1 ;; esac
}

# True if a provider is usable for a capability.
# - Exclusive caps (storage/scraping): the active *_PROVIDER_TYPE is the one.
# - Multi-provider caps: anything keyed-and-not-blocked, or keyless-and-not-
#   blocked, or a running local container.
provider_active() {  # provider_active CAP PROVIDER
  local cap="$1" prov="$2" kind prof type_val
  if cap_is_exclusive "$cap"; then
    type_val="$(cap_default "$cap")"
    if [[ -n "$type_val" ]]; then
      [[ "$type_val" == "$prov" ]]
    else
      # No explicit default — the canonical built-in is the implicit answer.
      case "$cap" in
        storage)  [[ "$prov" == "local_fs"    ]] ;;
        scraping) [[ "$prov" == "newspaper4k" ]] ;;
      esac
    fi
    return
  fi
  kind="$(prov_field "$cap" "$prov" kind)"
  case "$kind" in
    builtin)
      cap_has_default "$cap" || return 0   # no system default → always implicitly available
      type_val="$(cap_default "$cap")"
      # Built-in is active either as the system default or (when no default is
      # set) as the implicit fallback. Tesseract = OCR default.
      [[ "$type_val" == "$prov" || -z "$type_val" ]]
      ;;
    container)
      prof="$(prov_field "$cap" "$prov" profile)"
      profile_active "$prof"
      ;;
    cloud)
      # Usable when the key is set (if needed) AND sharing isn't explicitly
      # blocked. Keyless cloud (nominatim public API) is usable unless blocked.
      local kenv; kenv="$(prov_field "$cap" "$prov" key_env)"
      if [[ -n "$kenv" ]]; then
        [[ -n "$(get_env "$kenv")" && "$(prov_grant "$cap" "$prov")" != "none" ]]
      else
        [[ "$(prov_grant "$cap" "$prov")" != "none" ]]
      fi
      ;;
  esac
}

# Friendly status snippet for a single provider — used in the per-capability menu.
# Returns a colored token. Caller is responsible for layout.
provider_status_token() {  # provider_status_token CAP PROVIDER
  local cap="$1" prov="$2" kind kenv g
  kind="$(prov_field "$cap" "$prov" kind)"
  kenv="$(prov_field "$cap" "$prov" key_env)"
  g="$(prov_grant "$cap" "$prov")"
  case "$kind" in
    container)
      if provider_active "$cap" "$prov"; then echo "${GREEN}on${NC}"
      else echo "${DIM}off${NC}"; fi ;;
    builtin)
      echo "${GREEN}built-in${NC}" ;;
    cloud)
      if [[ -n "$kenv" && -z "$(get_env "$kenv")" ]]; then
        echo "${DIM}no key${NC}"
      elif [[ "$g" == "none" ]]; then
        echo "${RED}blocked${NC}"
      else
        case "$g" in
          all)       echo "${GREEN}shared: everyone${NC}" ;;
          superuser) echo "${YELLOW}shared: admins only${NC}" ;;
          *)         [[ -n "$kenv" ]] && echo "${DIM}key set, not shared${NC}" || echo "${DIM}available${NC}" ;;
        esac
      fi ;;
  esac
}

# Compact single-line capability status for the foundation menu. Skips the
# kind marker when the provider's display label already includes one in
# parentheses (e.g. "Nominatim (local)", "Object storage (S3)") so we don't
# emit "Nominatim (local) (local)".
capability_status_line() {  # capability_status_line CAP
  local cap="$1" prov parts="" tok kind label
  for prov in $(providers_for_cap "$cap"); do
    kind="$(prov_field "$cap" "$prov" kind)"
    provider_active "$cap" "$prov" || continue
    label="$(prov_field "$cap" "$prov" label)"
    case "$kind" in
      container) [[ "$label" == *"("*")" ]] && tok="$label" || tok="$label ${DIM}(local)${NC}" ;;
      builtin)   [[ "$label" == *"("*")" ]] && tok="$label" || tok="$label ${DIM}(built-in)${NC}" ;;
      cloud)     tok="$label ${DIM}(${NC}$(provider_status_token "$cap" "$prov")${DIM})${NC}" ;;
    esac
    parts="${parts:+$parts · }$tok"
  done
  [[ -z "$parts" ]] && echo "${DIM}not configured${NC}" || echo "$parts"
}

# Pure-bash TUI niceties — opt in to alt-screen + live refresh + single-key
# dispatch only when stdin AND stdout are real TTYs. CI / piped input falls
# back to plain line-based prompts so non-interactive use stays clean.
INTERACTIVE_TTY=false
[[ -t 0 && -t 1 ]] && INTERACTIVE_TTY=true

# Soft-detect fzf — used opportunistically for long pick lists (API providers,
# .env key editor). Numbered prompts remain the fallback path.
HAS_FZF=false
command -v fzf >/dev/null 2>&1 && HAS_FZF=true

# Refresh cadence (seconds) for the dashboard's live state poll.
TUI_REFRESH_SECONDS=3
TUI_TICK=0  # heartbeat counter for the footer indicator

say()  { echo -e "$@"; }
ok()   { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
die()  { echo -e "${RED}$*${NC}" >&2; exit 1; }

# ── Terminal control (only when INTERACTIVE_TTY) ──────────────────────────────
# Alternate screen buffer: same trick `vim` / `less` use — on entry the script
# takes over the terminal; on exit (clean or signal) we restore everything,
# including your shell scrollback. The trap is what makes the restore safe.

ALT_SCREEN_ON=false

enter_alt_screen() {
  $INTERACTIVE_TTY || return 0
  $ALT_SCREEN_ON  && return 0
  printf '\033[?1049h\033[H'   # enter alt-screen + cursor home
  ALT_SCREEN_ON=true
}

leave_alt_screen() {
  $ALT_SCREEN_ON || return 0
  printf '\033[?25h'           # ensure cursor is visible
  printf '\033[?1049l'         # exit alt-screen → original buffer restored
  ALT_SCREEN_ON=false
}

cursor_home() { $INTERACTIVE_TTY || return 0; printf '\033[H'; }
clear_below() { $INTERACTIVE_TTY || return 0; printf '\033[J'; }
hide_cursor() { $INTERACTIVE_TTY || return 0; printf '\033[?25l'; }
show_cursor() { $INTERACTIVE_TTY || return 0; printf '\033[?25h'; }

term_cols()  { tput cols  2>/dev/null || echo 80; }
term_lines() { tput lines 2>/dev/null || echo 24; }

# Single-key dispatch: read one char, no echo. The caller adds a newline if it
# wants the next output on its own line. Works inside `if`/`||` chains so a
# read timeout (set -e + nonzero exit) doesn't abort the script.
pick_key() { # pick_key VAR [timeout_seconds]
  local _t="${2:-}"
  if [[ -n "$_t" ]]; then
    read -t "$_t" -n 1 -s "$1" 2>/dev/null
  else
    read -n 1 -s "$1"
  fi
}

# Cleanup on exit / interrupt. Defined once, fires no matter how we leave.
__cleanup() { leave_alt_screen; show_cursor; }
trap '__cleanup' EXIT
trap '__cleanup; exit 130' INT
trap '__cleanup; exit 143' TERM

# ── Atomic file writes ────────────────────────────────────────────────────────
# Every file this script writes goes through stage_file → commit_file.
#
#   MODE       mktemp happens to make 0600 files and mv happens to carry that
#              mode over, so .env ended up private by accident and my-hq.yml
#              ended up 0664 or 0600 depending on which path wrote it last.
#              commit_file takes the mode as an argument.
#   ATOMICITY  bare mktemp creates in $TMPDIR — usually tmpfs, a different
#              filesystem from the repo — so mv was copy-then-unlink. Interrupt
#              it and .env is truncated, after backup_env already ran. Staging
#              beside the target makes it a real rename(2).
stage_file() {          # stage_file TARGET → temp path on TARGET's filesystem
  local dir; dir="$(dirname "$1")"
  mkdir -p "$dir"
  mktemp "${dir}/.$(basename "$1").tmp.XXXXXX"
}

commit_file() {         # commit_file TMP TARGET MODE
  chmod "$3" "$1"
  mv -f "$1" "$2"
}

# ── .env IO ───────────────────────────────────────────────────────────────────

backup_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  # mkdir -p is a no-op on an existing dir, so the chmod is what actually fixes
  # a backups dir created before modes were stated. These are full copies of .env.
  mkdir -p "$ENV_BACKUP_DIR"; chmod "$ENV_BACKUP_DIR_MODE" "$ENV_BACKUP_DIR"
  local b="${ENV_BACKUP_DIR}/.env.bak.$(date +%Y%m%d%H%M%S)"
  install -m "$ENV_MODE" "$ENV_FILE" "$b"; say "${DIM}backed up $ENV_FILE → $b${NC}"
}

# One-time migration: move legacy .env.bak.* files out of the repo root.
migrate_old_env_backups() {
  shopt -s nullglob
  local f moved=0
  for f in .env.bak.*; do
    mkdir -p "$ENV_BACKUP_DIR"; chmod "$ENV_BACKUP_DIR_MODE" "$ENV_BACKUP_DIR"
    mv "$f" "$ENV_BACKUP_DIR/" && chmod "$ENV_MODE" "$ENV_BACKUP_DIR/$f" && moved=$((moved+1))
  done
  shopt -u nullglob
  # `(( expr ))` returns 1 when expr is false, which `set -e` would abort on.
  # Use `[[ ]]` instead.
  [[ "$moved" -gt 0 ]] && say "${DIM}moved ${moved} legacy .env backup(s) → ${ENV_BACKUP_DIR}${NC}"
  return 0
}

get_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v k="$1" '$1==k{print substr($0, length($1)+2); exit}' "$ENV_FILE" \
    | sed 's/[[:space:]]*#.*$//; s/^"\(.*\)"$/\1/'
}

# .env has exactly two kinds of key. Secrets, which live here and are edited
# here; and the generated region, which render_env projects from my-hq.yml for
# compose to interpolate. Writing a generated key here looked like it worked and
# was silently reverted by the next render — five settings-menu actions and the
# port-conflict retry all did it. Refusing is the only version that cannot rot.
set_env() {
  local key="$1" val="$2" tmp
  if [[ " ${RENDERED_ENV_KEYS[*]:-} " == *" $key "* ]]; then
    die "set_env: $key is generated from $CONF_FILE — set it with \`yset\` and re-render, not here."
  fi
  local _yp; _yp="$(yaml_path_for_env "$key")"
  if [[ -n "$_yp" ]]; then
    die "set_env: $key is read from $CONF_FILE ($_yp), not .env — set it with \`yset $_yp\`."
  fi
  tmp="$(stage_file "$ENV_FILE")"
  if [[ -f "$ENV_FILE" ]] && grep -qE "^${key}=" "$ENV_FILE"; then
    # Value goes through ENVIRON[], not awk -v: -v interprets backslash escapes
    # and would corrupt any secret containing one.
    SETENV_KEY="$key" SETENV_VAL="$val" awk '
      BEGIN { k = ENVIRON["SETENV_KEY"]; v = ENVIRON["SETENV_VAL"] }
      $0 ~ "^" k "=" { print k "=" v; next }
      { print }
    ' "$ENV_FILE" > "$tmp"
  else
    [[ -f "$ENV_FILE" ]] && cat "$ENV_FILE" > "$tmp" || true
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  commit_file "$tmp" "$ENV_FILE" "$ENV_MODE"
}

is_placeholder() {
  local v="${1:-}"
  [[ -z "$v" ]] && return 0
  [[ "$PLACEHOLDERS" == *"|$v|"* ]] && return 0
  return 1
}

gen_fernet() { openssl rand -base64 32 | tr '+/' '-_'; }
gen_secret() { openssl rand -base64 24 | tr -d '/+='; }

ensure_secret() {
  local key="$1" gen="$2" cur
  cur="$(get_env "$key")"
  if [[ "${REGEN:-false}" == true ]] || is_placeholder "$cur"; then
    set_env "$key" "$($gen)"; say "  generated $key"
  else
    say "${DIM}  kept existing $key${NC}"
  fi
}

# Compose names volumes <project>_<vol>. Matching the suffix alone matched every
# other project on the box — so a first install where an HQ already existed saw
# "existing data" and offered to delete a volume belonging to something else.
project_volume() {      # project_volume VOL → <project>_<vol>
  local proj; proj="$(yget stack.name)"
  echo "${proj:-$(basename "$PWD")}_$1"
}

docker_volume_exists() {
  docker_ok || return 1
  docker volume ls --format '{{.Name}}' 2>/dev/null | grep -qFx "$(project_volume "$1")"
}

# Postgres bakes POSTGRES_PASSWORD into the data dir on first init — env vars
# are NEVER consulted again for the data already there. Generating a fresh
# password when an old data volume exists therefore locks the backend out:
# .env has new pw, postgres has old pw, every connect fails with
# "password authentication failed". Detect this and force an explicit choice.
ensure_postgres_password() {
  local cur; cur="$(get_env POSTGRES_PASSWORD)"
  local will_regen=false
  [[ "${REGEN:-false}" == true ]] && will_regen=true
  is_placeholder "$cur" && will_regen=true

  if ! $will_regen; then
    say "${DIM}  kept existing POSTGRES_PASSWORD${NC}"
    return 0
  fi

  if ! docker_volume_exists "app-db-data"; then
    set_env POSTGRES_PASSWORD "$(gen_secret)"
    say "  generated POSTGRES_PASSWORD"
    return 0
  fi

  echo
  warn "Existing postgres data volume found:"
  printf '    %s\n' "$(project_volume app-db-data)"
  warn "Postgres bakes the password into its data dir on first init. Generating"
  warn "a fresh POSTGRES_PASSWORD now would NOT match what's stored there, and"
  warn "the backend would fail authentication on every restart."
  echo
  say "  ${BOLD}1${NC}  Wipe the volume and start fresh  ${DIM}(deletes all postgres data)${NC}"
  say "  ${BOLD}2${NC}  Cancel — I'll edit .env and set POSTGRES_PASSWORD to the"
  say "      value that matches the existing volume, then re-run setup."
  echo
  say "  ${DIM}Manual wipe command (equivalent to choice 1):${NC}"
  say "    ${DIM}$(compose_cmd) down${NC}"
  say "    ${DIM}docker volume rm $(project_volume app-db-data)${NC}"
  echo
  if [[ "${ASSUME_YES:-false}" == true ]]; then
    die "Auto-yes mode refuses to destroy postgres data silently. Re-run interactively."
  fi
  local c; read -rp "  Your choice [1/2]: " c
  case "$c" in
    1)
      # The volume is attached to the db container — must remove the container
      # before we can remove the volume. `compose down` (without -v) stops +
      # removes all containers but preserves named volumes; we then surgically
      # remove just app-db-data, leaving redis_data / ollama_data / caddy_data
      # / nominatim-data intact (those can be huge and shouldn't be collateral).
      say "${DIM}stopping stack to release the postgres volume…${NC}"
      local cmd; cmd="$(compose_cmd)"
      COMPOSE_PROFILES="$(active_profiles)" $cmd down >/dev/null 2>&1 || true

      local v removed=0 failed=0
      while IFS= read -r v; do
        [[ -z "$v" ]] && continue
        if docker volume rm "$v" >/dev/null 2>&1; then
          removed=$((removed + 1))
          say "  removed volume $v"
        else
          failed=$((failed + 1))
          warn "  could not remove $v"
        fi
      done < <(docker volume ls --format '{{.Name}}' | grep -Fx "$(project_volume app-db-data)")

      if [[ "$failed" -gt 0 || "$removed" -eq 0 ]]; then
        warn "Volume removal incomplete. Try manually:"
        warn "    $cmd down  &&  docker volume rm <volume-name>"
        die "Aborting — re-run setup after the volume is gone."
      fi
      set_env POSTGRES_PASSWORD "$(gen_secret)"
      ok "removed postgres volume + generated fresh POSTGRES_PASSWORD" ;;
    *)
      die "Aborted. Edit .env (set POSTGRES_PASSWORD to the existing value) and re-run." ;;
  esac
}

# ── my-hq.yml IO ──────────────────────────────────────────────────────────────
# my-hq.yml holds everything non-secret. .env holds secrets + a generated region
# rendered from it for what only compose can read. Strict yaml subset: 2-space
# indent, block maps, block lists, # comments. No flow maps, no anchors.

# Scalar at a dotted path, or a comma-joined block list. Empty when absent.
yget() {
  [[ -f "$CONF_FILE" ]] || return 0
  awk -v want="$1" '
    BEGIN { n = split(want, seek, ".") }
    {
      line = $0
      sub(/[[:space:]]+#.*$/, "", line)
      if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) next
      match(line, / */); ind = RLENGTH / 2
      body = substr(line, RLENGTH + 1)
      if (body ~ /^- /) {
        if (hit && ind == hitind + 1) {
          v = substr(body, 3); gsub(/^"|"$/, "", v)
          out = out (out == "" ? "" : ",") v
        }
        next
      }
      if (body !~ /:/) next
      key = body; sub(/:.*/, "", key)
      val = body; sub(/^[^:]*:[[:space:]]*/, "", val)
      if (val == body) val = ""
      gsub(/^"|"$/, "", val)
      path[ind] = key
      for (i = ind + 1; i <= 16; i++) path[i] = ""
      if (hit && ind <= hitind) exit
      ok = 1
      for (i = 0; i < n; i++) if (path[i] != seek[i + 1]) ok = 0
      if (ok && ind == n - 1) {
        if (val != "") { print val; exit }
        hit = 1; hitind = ind
      }
    }
    END { if (out != "") print out }
  ' "$CONF_FILE"
}

# Immediate child keys of a dotted path.
ykeys() {
  [[ -f "$CONF_FILE" ]] || return 0
  awk -v want="$1" '
    BEGIN { n = split(want, seek, ".") }
    {
      line = $0
      sub(/[[:space:]]+#.*$/, "", line)
      if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) next
      match(line, / */); ind = RLENGTH / 2
      body = substr(line, RLENGTH + 1)
      if (body !~ /:/) next
      key = body; sub(/:.*/, "", key)
      path[ind] = key
      for (i = ind + 1; i <= 16; i++) path[i] = ""
      if (hit && ind <= hitind) exit
      if (hit && ind == hitind + 1) { print key; next }
      ok = 1
      for (i = 0; i < n; i++) if (path[i] != seek[i + 1]) ok = 0
      if (ok && ind == n - 1) { hit = 1; hitind = ind }
    }
  ' "$CONF_FILE"
}

yon() { [[ "$(yget "$1")" == "true" ]]; }

# An address carries both facts we need. http://searxng:8888/x -> host searxng,
# port 8888. garage:3900 -> garage, 3900. Nothing is hardcoded elsewhere:
# change base_url and the bind, the port and the extra_hosts entry all follow.
url_host() { local u="${1#*://}"; u="${u%%/*}"; echo "${u%%:*}"; }
url_port() {
  local u="${1#*://}"; u="${u%%/*}"
  case "$u" in *:*) echo "${u##*:}" ;; *) case "$1" in https://*) echo 443 ;; *) echo 80 ;; esac ;; esac
}
provider_host() { url_host "$(yget "foundation.providers.$1.base_url")"; }
provider_port() { url_port "$(yget "foundation.providers.$1.base_url")"; }

# Rewrites ONE existing line. Never creates keys and never round-trips the doc —
# that's what keeps the operator's comments and formatting intact.
yset() {
  local path="$1" val="$2" tmp
  [[ -f "$CONF_FILE" ]] || die "No $CONF_FILE — run ./setup.sh first."
  tmp="$(stage_file "$CONF_FILE")"
  YSET_PATH="$path" YSET_VAL="$val" awk '
    BEGIN { n = split(ENVIRON["YSET_PATH"], seek, "."); v = ENVIRON["YSET_VAL"] }
    {
      line = $0; probe = line
      sub(/[[:space:]]+#.*$/, "", probe)
      if (done || probe ~ /^[[:space:]]*#/ || probe ~ /^[[:space:]]*$/) { print; next }
      match(probe, / */); ind = RLENGTH / 2
      body = substr(probe, RLENGTH + 1)
      if (body !~ /:/ || body ~ /^- /) { print; next }
      key = body; sub(/:.*/, "", key)
      path[ind] = key
      for (i = ind + 1; i <= 16; i++) path[i] = ""
      ok = 1
      for (i = 0; i < n; i++) if (path[i] != seek[i + 1]) ok = 0
      if (ok && ind == n - 1) {
        comment = ""
        if (match(line, /[[:space:]]+#.*$/)) comment = substr(line, RSTART, RLENGTH)
        printf "%*s%s: %s%s\n", ind * 2, "", key, v, comment
        done = 1; next
      }
      print
    }
  ' "$CONF_FILE" > "$tmp"
  commit_file "$tmp" "$CONF_FILE" "$CONF_MODE"
}

# Replaces a block list's items. Separate from yset: a scalar written over a
# list leaves `paths: a,b` sitting on top of the old `- ` lines.
yset_list() {
  local path="$1" csv="$2" tmp
  [[ -f "$CONF_FILE" ]] || die "No $CONF_FILE — run ./setup.sh first."
  tmp="$(stage_file "$CONF_FILE")"
  YSL_PATH="$path" YSL_CSV="$csv" awk '
    BEGIN { n = split(ENVIRON["YSL_PATH"], seek, "."); split(ENVIRON["YSL_CSV"], vals, ",") }
    {
      line = $0; probe = line
      sub(/[[:space:]]+#.*$/, "", probe)
      if (done && !hit) { print; next }
      match(probe, / */); ind = RLENGTH / 2
      body = substr(probe, RLENGTH + 1)
      if (hit) { if (body ~ /^- /) next; hit = 0 }
      print
      if (body !~ /:/ || body ~ /^- /) next
      key = body; sub(/:.*/, "", key)
      path[ind] = key
      for (i = ind + 1; i <= 16; i++) path[i] = ""
      ok = 1
      for (i = 0; i < n; i++) if (path[i] != seek[i + 1]) ok = 0
      if (ok && ind == n - 1) {
        for (j = 1; j in vals; j++) printf "%*s- %s\n", (ind + 1) * 2, "", vals[j]
        hit = 1; done = 1
      }
    }
  ' "$CONF_FILE" > "$tmp"
  commit_file "$tmp" "$CONF_FILE" "$CONF_MODE"
}

# Sets a child key, inserting it when absent. Migration needs this: an operator
# can hold a grant the example only ships commented out, and dropping it would
# silently revoke access nobody asked to revoke.
yadd() {
  local parent="$1" key="$2" val="$3"
  if ykeys "$parent" | grep -qFx "$key"; then yset "$parent.$key" "$val"; return; fi
  local tmp; tmp="$(stage_file "$CONF_FILE")"
  YADD_PARENT="$parent" YADD_KEY="$key" YADD_VAL="$val" awk '
    BEGIN { n = split(ENVIRON["YADD_PARENT"], seek, "."); k = ENVIRON["YADD_KEY"]; v = ENVIRON["YADD_VAL"] }
    function emit() { printf "%*s%s: %s\n", (hitind + 1) * 2, "", k, v; done = 1 }
    {
      line = $0; probe = line
      sub(/[[:space:]]+#.*$/, "", probe)
      if (done) { print; next }
      if (probe ~ /^[[:space:]]*$/) { pending = pending line "\n"; next }
      match(probe, / */); ind = RLENGTH / 2
      body = substr(probe, RLENGTH + 1)
      if (hit && body != "" && ind <= hitind) { emit(); printf "%s", pending; pending = ""; print; next }
      printf "%s", pending; pending = ""
      print
      if (body ~ /^- / || body !~ /:/) next
      key = body; sub(/:.*/, "", key)
      path[ind] = key
      for (i = ind + 1; i <= 16; i++) path[i] = ""
      ok = 1
      for (i = 0; i < n; i++) if (path[i] != seek[i + 1]) ok = 0
      if (ok && ind == n - 1) { hit = 1; hitind = ind }
    }
    END { if (!done && hit) emit(); printf "%s", pending }
  ' "$CONF_FILE" > "$tmp"
  commit_file "$tmp" "$CONF_FILE" "$CONF_MODE"
}

ensure_conf() {
  [[ -f "$CONF_FILE" ]] && return 0
  [[ -f "$CONF_EXAMPLE" ]] || die "$CONF_EXAMPLE is missing — this checkout is incomplete. Re-clone or restore it."
  install -m "$CONF_MODE" "$CONF_EXAMPLE" "$CONF_FILE"
  ok "created $CONF_FILE from $CONF_EXAMPLE"
  if [[ -f "$ENV_FILE" ]]; then
    backup_env
    migrate_env_to_conf   # settings out of the old .env…
    rebuild_env           # …and the keys they came from out of .env
  fi
  return 0
}

# ── one-time migration from a pre-split .env ─────────────────────────────────

migrate_env_to_conf() {
  local moved=0
  _mv() {  # ENV_NAME yaml.path [lower]
    local v; v="$(get_env "$1")"
    v="${v#\'}"; v="${v%\'}"
    [[ -z "$v" ]] && return 0
    [[ "${3:-}" == lower ]] && v="$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')"
    yset "$2" "$v"; moved=$((moved + 1))
  }

  _mv PROJECT_NAME        stack.project
  _mv ENVIRONMENT         stack.environment
  _mv GEOCODING_USER_AGENT stack.user_agent
  _mv DOMAIN              deployment.network.domain
  _mv ACME_EMAIL          deployment.network.acme_email
  _mv BACKEND_PORT        deployment.services.backend.port
  _mv BACKEND_WORKERS     deployment.services.backend.workers
  _mv DOCKER_IMAGE_BACKEND deployment.services.backend.image
  _mv FRONTEND_PORT       deployment.services.frontend.port
  _mv CELERY_CONCURRENCY  deployment.services.celery.workers
  _mv CELERY_PROCESSING_CONCURRENCY deployment.services.celery.processing_workers
  _mv POSTGRES_SERVER     deployment.services.database.host
  _mv POSTGRES_PORT       deployment.services.database.port
  _mv POSTGRES_DB         deployment.services.database.name
  _mv POSTGRES_USER       deployment.services.database.user
  _mv POSTGRES_SSL_MODE   deployment.services.database.ssl_mode
  _mv REDIS_HOST          deployment.services.redis.host
  _mv REDIS_PORT          deployment.services.redis.port
  _mv REDIS_DB            deployment.services.redis.db
  _mv REDIS_URL           deployment.services.redis.url
  _mv SMTP_HOST           deployment.email.host
  _mv SMTP_PORT           deployment.email.port
  _mv SMTP_USER           deployment.email.user
  _mv EMAILS_FROM_EMAIL   deployment.email.from_email
  _mv EMAILS_FROM_NAME    deployment.email.from_name
  _mv USERS_OPEN_REGISTRATION      deployment.users.open_registration lower
  _mv REQUIRE_EMAIL_VERIFICATION   deployment.users.require_email_verification lower
  _mv DEPLOYMENT_CAPABILITIES      deployment.users.allowed_actions
  _mv STORAGE_BROWSE_MAX_COUNT_FILES deployment.storage.browse_max_files
  _mv LOCAL_STORAGE_HOST_PATH      deployment.storage.user_uploads.host_path
  _mv LOCAL_STORAGE_BASE_PATH      deployment.storage.user_uploads.base_path
  _mv PDF_MAX_PAGES                deployment.processing.pdf_max_pages
  _mv PROCESS_CONTENT_RATE_LIMIT   deployment.processing.content_rate_limit
  _mv MAX_UPLOAD_SIZE_BYTES        deployment.processing.max_upload_size_bytes
  _mv DEFAULT_ANNOTATION_CONCURRENCY deployment.processing.annotation.default_concurrency
  _mv MAX_ANNOTATION_CONCURRENCY   deployment.processing.annotation.max_concurrency
  _mv DISCOURSE_CONNECT_ENABLED    deployment.sso.discourse.enabled lower
  _mv DISCOURSE_CONNECT_URL        deployment.sso.discourse.url
  _mv OLLAMA_BASE_URL              foundation.providers.ollama.base_url
  _mv OLLAMA_OCR_MODEL             foundation.providers.ollama.ocr_model
  _mv OPENAI_BASE_URL              foundation.providers.openai.base_url
  _mv ANTHROPIC_BASE_URL           foundation.providers.anthropic.base_url
  _mv MISTRAL_BASE_URL             foundation.providers.mistral.base_url
  _mv VOYAGE_BASE_URL              foundation.providers.voyage.base_url
  _mv JINA_EMBEDDING_MODEL         foundation.providers.jina.model
  _mv NOMINATIM_BASE_URL           foundation.providers.nominatim_local.base_url
  _mv NOMINATIM_PBF_URL            foundation.providers.nominatim_local.pbf_url
  _mv NOMINATIM_IMPORT_STYLE       foundation.providers.nominatim_local.import_style

  local ip co; ip="$(get_env ALLOWED_IMPORT_PATHS)"; co="$(get_env BACKEND_CORS_ORIGINS)"
  [[ -n "$ip" ]] && { yset_list deployment.storage.importable_paths "$ip"; moved=$((moved + 1)); }
  [[ -n "$co" ]] && { yset_list deployment.network.cors.origins "$co"; moved=$((moved + 1)); }

  local gp; gp="$(get_env GEOCODING_PROVIDER_TYPE)"
  [[ "$gp" == "local" ]] && gp="nominatim_local"
  [[ -n "$gp" ]] && { yset foundation.use.geocoding "$gp"; moved=$((moved + 1)); }

  local st; st="$(get_env STORAGE_PROVIDER_TYPE)"
  case "$st" in
    minio) yset deployment.storage.use s3
           warn "STORAGE_PROVIDER_TYPE=minio → storage.use: s3. MinIO's on-disk layout is not"
           warn "Garage's — copy the bucket out before switching object servers." ;;
    ""|local_fs) : ;;
    *)     yset deployment.storage.use "$st" ;;
  esac

  local p cur; cur=",$(get_env COMPOSE_PROFILES),"
  for p in $(ykeys foundation.run); do
    [[ "$cur" == *",$p,"* ]] && yset "foundation.run.$p" true
  done
  [[ "$cur" == *",minio,"* ]] && warn "profile 'minio' has no equivalent — see storage.use above"

  migrate_grants; moved=$((moved + MIGRATED_GRANTS))

  local en; en="$(get_env ENABLED_ENRICHERS)"
  if [[ -n "$en" ]]; then
    local e
    for e in $(ykeys deployment.processing.background_content_enrichers); do
      [[ "$en" == "*" || ",$en," == *",$e,"* ]] \
        && yset "deployment.processing.background_content_enrichers.$e" true
    done
  fi

  ok "migrated $moved setting(s) from $ENV_FILE into $CONF_FILE"
  say "${DIM}  review $CONF_FILE, then re-run ./setup.sh${NC}"
}

# PROVIDER_ACCESS_<CAP>_<provider> → foundation.access.<cap>.<provider>.
# Driven off what .env holds, not what the example lists — a grant for a provider
# the example only shows commented out is still a grant. Anything unplaceable is
# reported, never dropped in silence: this is a security control.
MIGRATED_GRANTS=0
migrate_grants() {
  MIGRATED_GRANTS=0
  local line k v cap prov c caps
  caps="$(ykeys foundation.access)"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    k="${line%%=*}"; v="${line#*=}"
    v="$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')"
    k="$(printf '%s' "${k#PROVIDER_ACCESS_}" | tr '[:upper:]' '[:lower:]')"
    [[ "$k" == llm_* ]] && k="language_${k#llm_}"      # legacy alias
    case "$v" in all|superuser|none) ;; *) warn "dropped ${line%%=*}=$v — not all|superuser|none"; continue ;; esac
    cap=""; prov=""
    for c in $(printf '%s\n' $caps | awk '{print length, $0}' | sort -rn | cut -d' ' -f2-); do
      [[ "$k" == "${c}_"* ]] && { cap="$c"; prov="${k#${c}_}"; break; }
    done
    [[ -z "$cap" ]] && { warn "dropped ${line%%=*} — no matching capability in $CONF_FILE"; continue; }
    yadd "foundation.access.$cap" "$prov" "$v"
    MIGRATED_GRANTS=$((MIGRATED_GRANTS + 1))
  done < <(grep -E '^PROVIDER_ACCESS_[A-Za-z_]+=.' "$ENV_FILE" 2>/dev/null || true)
}

# Rebuilds .env's secret region from .env.example with current values. Deleting
# migrated keys line-by-line would leave their comment blocks orphaned. Anything
# unrecognised is appended and reported, never dropped.
rebuild_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  local tmp known="" k v line kept=""
  tmp="$(stage_file "$ENV_FILE")"
  while IFS= read -r line; do
    [[ "$line" == "# ── generated"* ]] && break
    if [[ "$line" =~ ^([A-Z_0-9]+)= ]]; then
      k="${BASH_REMATCH[1]}"; known="$known $k"; v="$(get_env "$k")"
      [[ -n "$v" ]] && printf '%s=%s\n' "$k" "$v" || printf '%s\n' "$line"
    else
      printf '%s\n' "$line"
    fi
  done < "$EXAMPLE_FILE" > "$tmp"
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Za-z_0-9]+)=(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    [[ -z "$v" ]] && continue
    [[ " $known " == *" $k "* ]] && continue
    [[ " ${RENDERED_ENV_KEYS[*]} " == *" $k "* ]] && continue
    [[ " ${MIGRATED_ENV_KEYS[*]} " == *" $k "* ]] && continue
    [[ "$k" == PROVIDER_ACCESS_* ]] && continue
    kept="${kept:+$kept }$k"
    printf '%s=%s\n' "$k" "$v" >> "$tmp"
  done < "$ENV_FILE"
  commit_file "$tmp" "$ENV_FILE" "$ENV_MODE"
  [[ -n "$kept" ]] && warn "kept unrecognised .env keys: $kept"
  return 0
}

MIGRATED_ENV_KEYS=(
  PROJECT_NAME ORGANISATION_NAME STACK_NAME ENVIRONMENT DOMAIN ACME_EMAIL
  BACKEND_CORS_ORIGINS CORS_ALLOWED_METHODS CORS_ALLOWED_HEADERS
  USERS_OPEN_REGISTRATION REQUIRE_EMAIL_VERIFICATION DEPLOYMENT_CAPABILITIES
  ACCESS_TOKEN_EXPIRE_MINUTES EMAIL_RESET_TOKEN_EXPIRE_HOURS
  STORAGE_PROVIDER_TYPE ALLOWED_IMPORT_PATHS STORAGE_BROWSE_MAX_COUNT_FILES
  ENABLED_ENRICHERS PDF_MAX_PAGES PROCESS_CONTENT_RATE_LIMIT
  MAX_UPLOAD_SIZE_BYTES DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS
  DEFAULT_ANNOTATION_CONCURRENCY MAX_ANNOTATION_CONCURRENCY ANNOTATION_CHUNK_SIZE
  GEOCODING_USER_AGENT GEOCODING_PROVIDER_TYPE OCR_PROVIDER_TYPE
  WEB_SEARCH_PROVIDER_TYPE SCRAPING_PROVIDER_TYPE NOMINATIM_BASE_URL
  OLLAMA_OCR_MODEL JINA_EMBEDDING_MODEL
  OPENAI_BASE_URL ANTHROPIC_BASE_URL MISTRAL_BASE_URL VOYAGE_BASE_URL
  POSTGRES_SERVER POSTGRES_DB POSTGRES_USER POSTGRES_SSL_MODE
  DB_POOL_SIZE DB_MAX_OVERFLOW DB_POOL_PRE_PING REDIS_URL
  SMTP_HOST SMTP_PORT SMTP_TLS SMTP_SSL SMTP_USER
  EMAILS_FROM_NAME EMAILS_FROM_EMAIL
  DISCOURSE_CONNECT_ENABLED DISCOURSE_CONNECT_URL
  DOCKER_IMAGE_FRONTEND WIPE_DB MINIO_ENDPOINT MINIO_HOST MINIO_PORT
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_BUCKET_NAME MINIO_REGION
  MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_SECURE MINIO_USE_SSL
)

# Drop the legacy names my-hq.yml now owns. They are inert — the backend's
# _SecretsOnlyEnvSource refuses to read a yaml-backed name out of .env — but
# inert is not harmless: MINIO_SECRET_KEY outlived MinIO by months, and WIPE_DB
# is a DROP TABLE switch one character from firing. A key that looks editable
# and does nothing is a trap for whoever reads this file next.
#
# Runs on every render, not once at migration. The one-shot in ensure_conf fires
# only on the upgrade from a pre-split .env and never again, so anything its
# list missed at the time was permanent.
prune_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  local tmp line k dropped="" past_marker=false
  tmp="$(stage_file "$ENV_FILE")"
  while IFS= read -r line; do
    # Only the hand-editable region above the marker. The generated region
    # below it is render_env's to own, and several migrated names legitimately
    # reappear there as the compose projection.
    [[ "$line" == "# ── generated"* ]] && past_marker=true
    if [[ "$past_marker" == false && "$line" =~ ^([A-Za-z_0-9]+)= ]]; then
      k="${BASH_REMATCH[1]}"
      if [[ " ${MIGRATED_ENV_KEYS[*]} " == *" $k "* || "$k" == PROVIDER_ACCESS_* ]]; then
        dropped="${dropped:+$dropped }$k"
        continue
      fi
    fi
    printf '%s\n' "$line"
  done < "$ENV_FILE" > "$tmp"
  commit_file "$tmp" "$ENV_FILE" "$ENV_MODE"
  [[ -n "$dropped" ]] && say "  pruned legacy .env keys: $dropped"
  return 0
}

# ── garage.toml ──────────────────────────────────────────────────────────────
# Garage takes its binds from a config FILE only — no env var reaches
# rpc_bind_addr or api_bind_addr (the env overrides it does have are secrets:
# GARAGE_RPC_SECRET, GARAGE_ADMIN_TOKEN). So the file is generated, from the
# same my-hq.yml everything else derives from.
#
#   bridge mode  0.0.0.0 inside garage's own namespace, nothing published
#   host mode    HQ_BIND_HOST, because there is no namespace to hide in
write_garage_config() {
  local bind port region
  if [[ "$(yget deployment.network.mode)" == host ]]; then
    bind="$(yget deployment.network.bind)"; bind="${bind:-127.0.0.1}"
  else
    bind="0.0.0.0"
  fi
  port="$(url_port "$(yget deployment.services.s3.endpoint)")"
  region="$(yget deployment.services.s3.region)"

  local tmp; tmp="$(stage_file "$GARAGE_CONFIG")"
  cat > "$tmp" <<TOML
# Generated by ./setup.sh from my-hq.yml — DO NOT edit by hand.
# Secrets are NOT here: GARAGE_RPC_SECRET and GARAGE_ADMIN_TOKEN come from .env,
# which is what keeps this file safe to read and safe to check in.

metadata_dir = "/var/lib/garage/meta"
data_dir     = "/var/lib/garage/data"
db_engine    = "lmdb"

# Single node. Garage is happy with this; it just means no redundancy, which is
# the right trade for one machine holding one copy anyway.
replication_factor = 1

rpc_bind_addr   = "${bind}:3901"
rpc_public_addr = "${bind}:3901"

[s3_api]
s3_region     = "${region:-garage}"
api_bind_addr = "${bind}:${port:-3900}"
root_domain   = ".s3.garage"

[admin]
api_bind_addr = "${bind}:3903"
TOML
  commit_file "$tmp" "$GARAGE_CONFIG" "$GARAGE_CONFIG_MODE"
  ok "wrote $GARAGE_CONFIG"
}

# Garage serves nothing until a layout is applied and a bucket exists. The
# image is scratch plus one static binary, so there is no shell in it to run a
# sidecar script — each step is its own `exec` of the binary. All of them are
# idempotent, which is what makes running this on every start the simple option.
garage_bootstrap() {
  local c node bucket key sec
  c="$(compose_cmd)"
  bucket="$(yget deployment.services.s3.bucket)"
  key="$(get_env S3_ACCESS_KEY_ID)"; sec="$(get_env S3_SECRET_ACCESS_KEY)"
  [[ -z "$bucket" || -z "$key" ]] && { warn "garage: missing bucket or key, skipping bootstrap"; return 0; }

  local i
  for i in $(seq 1 30); do
    COMPOSE_PROFILES="$(active_profiles)" $c exec -T garage /garage status >/dev/null 2>&1 && break
    sleep 2
  done

  node="$(COMPOSE_PROFILES="$(active_profiles)" $c exec -T garage /garage node id -q 2>/dev/null | cut -d@ -f1 | tr -d '\r')"
  [[ -z "$node" ]] && { warn "garage: node not answering, skipping bootstrap"; return 0; }

  local g=(env COMPOSE_PROFILES="$(active_profiles)" $c exec -T garage /garage)
  # A node with no role stores nothing. Assign once; re-running is a no-op.
  "${g[@]}" layout assign "$node" -z hq -c 10G >/dev/null 2>&1 || true
  "${g[@]}" layout apply --version 1          >/dev/null 2>&1 || true
  # Imported, not created: .env already holds the key and the backend is using
  # it. Letting garage mint its own would guarantee they disagree.
  "${g[@]}" key import --yes -n hq "$key" "$sec" >/dev/null 2>&1 || true
  "${g[@]}" bucket create "$bucket"              >/dev/null 2>&1 || true
  "${g[@]}" bucket allow "$bucket" --key hq --read --write --owner >/dev/null 2>&1 || true

  if "${g[@]}" bucket info "$bucket" >/dev/null 2>&1; then
    ok "garage ready — bucket '$bucket', key hq"
  else
    warn "garage: bucket '$bucket' still not present after bootstrap. Inspect with:"
    warn "  $c exec garage /garage status"
  fi
  return 0
}

# Garage key format is exact: an id of GK + 24 hex, a secret of 64 hex. They are
# generated HERE rather than by `garage key new` so .env and the running node
# agree by construction — the bootstrap imports exactly what the backend holds.
ensure_s3_secrets() {
  local id sec
  id="$(get_env S3_ACCESS_KEY_ID)"; sec="$(get_env S3_SECRET_ACCESS_KEY)"
  if [[ "${REGEN:-false}" == true ]] || [[ ! "$id" =~ ^GK[0-9a-f]{24}$ ]] || [[ ! "$sec" =~ ^[0-9a-f]{64}$ ]]; then
    set_env S3_ACCESS_KEY_ID     "GK$(openssl rand -hex 12)"
    set_env S3_SECRET_ACCESS_KEY "$(openssl rand -hex 32)"
    say "  generated S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY"
  else
    say "${DIM}  kept existing S3 credentials${NC}"
  fi
  local k
  for k in GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN; do
    [[ "${REGEN:-false}" == true ]] || is_placeholder "$(get_env "$k")" && set_env "$k" "$(openssl rand -hex 32)"
  done
  return 0
}

# ── my-hq.yml ──► .env generated region ──────────────────────────────────────
# Compose can only interpolate from .env, so what it needs is rendered there.
# Not a second home — nothing in the backend reads these names, it reads the
# mounted yaml — so they can't disagree. Stale is caught by HQ_CONFIG_SHA.

RENDERED_ENV_KEYS=(
  HQ_CONFIG_SHA COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES
  FRONTEND_PORT BACKEND_PORT BACKEND_BIND_HOST
  POSTGRES_PORT POSTGRES_DB POSTGRES_USER
  REDIS_HOST REDIS_PORT REDIS_DB HQ_BIND_HOST HQ_SEARXNG_PORT
  LOCAL_STORAGE_HOST_PATH LOCAL_STORAGE_BASE_PATH BACKEND_WORKERS
  CELERY_CONCURRENCY CELERY_PROCESSING_CONCURRENCY
  NOMINATIM_PBF_URL NOMINATIM_REPLICATION_URL NOMINATIM_IMPORT_STYLE
  OLLAMA_BASE_URL SEARXNG_API_URL DOMAIN ACME_EMAIL
  DOCKER_IMAGE_BACKEND TAG INSTALL_DEV S3_BUCKET_NAME COMPOSE_BAKE
)

# Names that exist in .env's history but whose value the backend reads only from
# my-hq.yml — config.py declares them with an AliasPath, and its env sources hand
# back nothing for those. Writing one here is a silent no-op, so set_env refuses
# and names the path instead. ENV_NAME|yaml.path
YAML_BACKED_ENV_KEYS=(
  "SMTP_HOST|deployment.email.host"
  "SMTP_PORT|deployment.email.port"
  "SMTP_USER|deployment.email.user"
  "SMTP_TLS|deployment.email.tls"
  "SMTP_SSL|deployment.email.ssl"
  "EMAILS_FROM_EMAIL|deployment.email.from_email"
  "EMAILS_FROM_NAME|deployment.email.from_name"
  "USERS_OPEN_REGISTRATION|deployment.users.open_registration"
  "REQUIRE_EMAIL_VERIFICATION|deployment.users.require_email_verification"
  "S3_REGION|deployment.services.s3.region"
  "S3_ENDPOINT|deployment.services.s3.endpoint"
  "STORAGE_PROVIDER_TYPE|deployment.storage.use"
  "ENVIRONMENT|stack.environment"
  "PROJECT_NAME|stack.project"
)

yaml_path_for_env() {   # echoes the yaml path, or nothing
  local row
  for row in "${YAML_BACKED_ENV_KEYS[@]}"; do
    [[ "${row%%|*}" == "$1" ]] && { echo "${row#*|}"; return 0; }
  done
  return 0
}

# Concurrency follows the host instead of a hardcoded 4. `auto` in my-hq.yml
# (or a blank/non-numeric value) derives from the CPU count; an explicit number
# always wins, so nothing you set by hand gets second-guessed.
#
# The multipliers differ because the pools do different work:
#   backend    1x  uvicorn workers are event loops — one per core saturates it,
#                  and each additional one re-imports the whole app.
#   celery     2x  default/llm/embedding/external_api are I/O-bound; they spend
#                  most of their life waiting on someone else's API.
#   processing 1x  ingestion and content parsing are CPU-bound (PDF extraction,
#                  hashing, chunking), so oversubscribing just thrashes.
host_cpus() {
  getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 2
}

# derived_concurrency <yaml-value> <multiplier> <floor> <ceiling>
derived_concurrency() {
  local v="$1" mult="$2" lo="$3" hi="$4" n
  if [[ "$v" =~ ^[0-9]+$ ]] && (( v > 0 )); then echo "$v"; return; fi
  n=$(( $(host_cpus) * mult ))
  (( n < lo )) && n=$lo
  (( n > hi )) && n=$hi
  echo "$n"
}

derived_profiles() {
  local p out=""
  for p in $(ykeys foundation.run); do yon "foundation.run.$p" && out="${out:+$out,}$p"; done
  [[ "$(yget deployment.network.reach)" == "public" ]] && out="${out:+$out,}caddy"
  echo "$out"
}

# Dev names both files explicitly: passing any -f stops compose auto-loading
# the override, which would silently drop the source binds.
derived_compose_file() {
  local f="compose.yml"
  [[ "$(yget stack.environment)" == "local" ]] && f="$f:compose.override.yml"
  [[ "$(yget deployment.network.mode)" == "host" ]] && f="$f:$HOST_NET_FRAGMENT"
  echo "$f"
}

# The compose projection: every value my-hq.yml hands to docker compose, and
# nothing else. Printed, not written, so the same text can be hashed and
# rendered — they cannot disagree.
render_projection() {
  local bind mode; bind="$(yget deployment.network.bind)"; bind="${bind:-127.0.0.1}"
  mode="$(yget deployment.network.mode)"
  printf 'COMPOSE_PROJECT_NAME=%s\n'          "$(yget stack.name)"
  printf 'COMPOSE_FILE=%s\n'                  "$(derived_compose_file)"
  printf 'COMPOSE_PROFILES=%s\n'              "$(derived_profiles)"
  # Four services share context: ./backend, so plain compose issues four
  # identical build requests. Bake collapses them into one graph.
  printf 'COMPOSE_BAKE=%s\n'                   'true'
  printf 'FRONTEND_PORT=%s\n'                 "$(yget deployment.services.frontend.port)"
  printf 'BACKEND_PORT=%s\n'                  "$(yget deployment.services.backend.port)"
  printf 'BACKEND_BIND_HOST=%s\n'             "$([[ "$mode" == host ]] && echo "$bind" || echo 0.0.0.0)"
  printf 'POSTGRES_PORT=%s\n'                 "$(yget deployment.services.database.port)"
  printf 'POSTGRES_DB=%s\n'                   "$(yget deployment.services.database.name)"
  printf 'POSTGRES_USER=%s\n'                 "$(yget deployment.services.database.user)"
  printf 'REDIS_HOST=%s\n'                    "$(yget deployment.services.redis.host)"
  printf 'REDIS_PORT=%s\n'                    "$(yget deployment.services.redis.port)"
  printf 'REDIS_DB=%s\n'                      "$(yget deployment.services.redis.db)"
  printf 'HQ_BIND_HOST=%s\n'                  "$bind"
  printf 'HQ_SEARXNG_PORT=%s\n'               "$(provider_port searxng)"
  printf 'LOCAL_STORAGE_HOST_PATH=%s\n'       "$(yget deployment.storage.user_uploads.host_path)"
  printf 'LOCAL_STORAGE_BASE_PATH=%s\n'       "$(yget deployment.storage.user_uploads.base_path)"
  printf 'BACKEND_WORKERS=%s\n'               "$(derived_concurrency "$(yget deployment.services.backend.workers)" 1 2 8)"
  printf 'CELERY_CONCURRENCY=%s\n'            "$(derived_concurrency "$(yget deployment.services.celery.workers)" 2 2 8)"
  printf 'CELERY_PROCESSING_CONCURRENCY=%s\n' "$(derived_concurrency "$(yget deployment.services.celery.processing_workers)" 1 2 6)"
  printf 'NOMINATIM_PBF_URL=%s\n'             "$(yget foundation.providers.nominatim_local.pbf_url)"
  printf 'NOMINATIM_REPLICATION_URL=%s\n'     "$(yget foundation.providers.nominatim_local.replication_url)"
  printf 'NOMINATIM_IMPORT_STYLE=%s\n'        "$(yget foundation.providers.nominatim_local.import_style)"
  printf 'OLLAMA_BASE_URL=%s\n'               "$(yget foundation.providers.ollama.base_url)"
  printf 'SEARXNG_API_URL=%s\n'               "$(yget foundation.providers.searxng.base_url)"
  printf 'DOMAIN=%s\n'                        "$(yget deployment.network.domain)"
  printf 'ACME_EMAIL=%s\n'                    "$(yget deployment.network.acme_email)"
  printf 'DOCKER_IMAGE_BACKEND=%s\n'          "$(yget deployment.services.backend.image)"
  printf 'TAG=%s\n'                           "$(yget deployment.services.backend.tag)"
  printf 'INSTALL_DEV=%s\n'                   "$([[ "$(yget stack.environment)" == local ]] && echo true || echo false)"
  printf 'S3_BUCKET_NAME=%s\n'                "$(yget deployment.services.s3.bucket)"
}

# Hashes the FILE, and must keep doing so: config.py's staleness gate recomputes
# this same digest, and the projection below is bash the backend cannot run. A
# projection hash would be the sharper check — an edit to a value only the
# backend reads would stop invalidating .env — but only if both sides could
# produce it byte-identically, and derived_concurrency alone (host cpu count,
# clamped) makes that a promise we would break. So: file hash, and `setup.sh
# render` is the cheap one-command answer when it trips.
conf_sha() {
  [[ -f "$CONF_FILE" ]] || { echo ""; return; }
  { sha256sum "$CONF_FILE" 2>/dev/null || shasum -a 256 "$CONF_FILE" 2>/dev/null; } | cut -c1-16
}

render_env() {
  [[ -f "$CONF_FILE" ]] || die "No $CONF_FILE — run ./setup.sh first."
  [[ -f "$ENV_FILE"  ]] || die "No $ENV_FILE — run ./setup.sh first."
  local marker="# ── generated from my-hq.yml by ./setup.sh, do not edit ──"
  local tmp k pat=""; tmp="$(stage_file "$ENV_FILE")"
  for k in "${RENDERED_ENV_KEYS[@]}"; do pat="${pat:+$pat|}^${k}="; done
  # Match the marker by PREFIX: an exact match meant renaming the script left the
  # old marker unrecognised and appended a second region.
  awk '/^# ── generated from my-hq\.yml/ { exit } { print }' "$ENV_FILE" | grep -vE "$pat" \
    | awk 'BEGIN{b=0} /^[[:space:]]*$/{b++; next} {while(b>0){print ""; b--} print}' > "$tmp"
  {
    echo ""
    echo "$marker"
    printf 'HQ_CONFIG_SHA=%s\n' "$(conf_sha)"
    render_projection
  } >> "$tmp"
  commit_file "$tmp" "$ENV_FILE" "$ENV_MODE"
}


# ── wizard ──► my-hq.yml ─────────────────────────────────────────────────────
# The wizard collects choices into shell vars (FMODE, REACH, STORAGE, PROFILES
# and the queued grants/defaults). This is the one place they land in the
# config file, so there is a single seam between what was chosen and what is
# written.

# Settings that contradict the network mode. Lives here, not in the backend:
# how compose wires the network is not something the API can verify, and it has
# no business refusing to boot over it. Declaration -> this check -> the runtime
# audit in verify_loopback_only, which is the only one that proves anything.
check_network_coherence() {
  local mode reach bind problems=""
  mode="$(yget deployment.network.mode)"
  reach="$(yget deployment.network.reach)"
  bind="$(yget deployment.network.bind)"
  if [[ "$reach" == public ]]; then
    [[ -n "$(yget deployment.network.acme_email)" ]] || problems="${problems}
  network.acme_email is empty with reach: public — Caddy's email directive
    cannot parse an empty value and the proxy will not start. Set a contact
    address for the certificate authority."
    local dom; dom="$(yget deployment.network.domain)"
    [[ "$dom" == localhost || -z "$dom" ]] && problems="${problems}
  network.domain is '$dom' with reach: public — Let's Encrypt cannot issue for
    that. Set the domain whose A-record points at this host."
  fi

  if [[ "$mode" != host ]]; then
    [[ -z "$problems" ]] && return 0
    warn "Network config cannot hold:${problems}"
    die "Fix $CONF_FILE and re-run."
  fi

  # Host networking is a Linux kernel feature. Docker Desktop emulates it only
  # when explicitly switched on, and a stack that starts while nothing answers
  # is the worst way to find that out. A warning, not a die: on a Mac with the
  # setting enabled this works, and only the operator knows which Mac this is.
  if [[ "$(uname -s)" != Linux ]]; then
    warn "network.mode: host on $(uname -s) needs Docker Desktop's host networking
  (Settings -> Resources -> Network -> Enable host networking). Without it the
  containers start and nothing answers on 127.0.0.1. Set mode: bridge in
  $CONF_FILE for published ports instead — bridge binds 127.0.0.1 too."
  fi

  if [[ "$reach" == local && -n "$bind" && "$bind" != 127.0.0.1 && "$bind" != ::1 && "$bind" != localhost ]]; then
    problems="${problems}
  network.bind: $bind with reach: local — that claims hardening it does not have.
    Use 127.0.0.1, or set reach: public and let caddy be the front door."
  fi

  [[ -z "$problems" ]] && return 0
  warn "Network config cannot hold:${problems}"
  die "Fix $CONF_FILE and re-run."
}

apply_wizard_to_conf() {
  yset stack.environment "$([[ "$FMODE" == dev ]] && echo local || echo production)"
  yset deployment.network.mode  "$NETWORK_MODE"
  yset deployment.network.reach "$([[ "$REACH" == public ]] && echo public || echo local)"
  [[ -n "$DOMAIN_OPT"     ]] && yset deployment.network.domain     "$DOMAIN_OPT"
  [[ -n "$ACME_EMAIL_OPT" ]] && yset deployment.network.acme_email "$ACME_EMAIL_OPT"
  [[ -n "${BACKEND_WORKERS:-}"    ]] && yset deployment.services.backend.workers "$BACKEND_WORKERS"
  [[ -n "${CELERY_CONCURRENCY:-}" ]] && yset deployment.services.celery.workers  "$CELERY_CONCURRENCY"
  [[ -n "$STORAGE" ]] && yset deployment.storage.use "$STORAGE"

  local c p l
  while IFS='|' read -r c p l; do
    [[ -n "$c" ]] && prov_set_grant "$c" "$p" "$l"
  done < <(echo -e "$QUEUED_GRANTS")
  while IFS='|' read -r c p; do
    [[ -n "$c" ]] && cap_set_default "$c" "$p"
  done < <(echo -e "$QUEUED_DEFAULTS")

  # `run` is the truth for which containers start; PROFILES is the wizard's
  # in-flight accumulator. Write every key so deselecting turns one off.
  local p
  for p in $(ykeys foundation.run); do
    [[ ",$PROFILES," == *",$p,"* ]] && yset "foundation.run.$p" true || yset "foundation.run.$p" false
  done
  reconcile_use_with_run
  return 0
}

# Drop any `use` entry whose container was just switched off, keeping the rest
# of the ordered list. A capability left with nothing is removed entirely rather
# than pointed at something the user did not choose.
reconcile_use_with_run() {
  local cap raw entry host keep changed=false
  for cap in $(ykeys foundation.use); do
    raw="$(yget "foundation.use.$cap")"
    [[ -n "$raw" ]] || continue
    keep=""
    for entry in ${raw//,/ }; do
      host="$(provider_host "$entry")"
      # No host means in-process (tesseract, newspaper4k) — always usable.
      if [[ -n "$host" ]] && ykeys foundation.run | grep -qFx "$host" && ! yon "foundation.run.$host"; then
        changed=true; continue
      fi
      keep="${keep:+$keep, }$entry"
    done
    if [[ "$keep" != "$raw" ]]; then
      yset "foundation.use.$cap" "$keep"
      [[ -z "$keep" ]] && warn "  foundation.use.$cap cleared — nothing enabled can answer it."
    fi
  done
  $changed && say "${DIM}  foundation.use updated to match the services you enabled${NC}"
  return 0
}

# ── .config/hq/setup.conf (UX state, not deployment config) ───────────────────

conf_get() {
  [[ -f "$SETUP_CONF" ]] || { echo "${2:-}"; return; }
  local v
  v="$(awk -F= -v k="$1" '$1==k{print substr($0, length($1)+2); exit}' "$SETUP_CONF")"
  [[ -z "$v" ]] && v="${2:-}"
  echo "$v"
}

conf_set() {
  local tmp; tmp="$(stage_file "$SETUP_CONF")"
  if [[ -f "$SETUP_CONF" ]] && grep -qE "^$1=" "$SETUP_CONF"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k"="v;next}{print}' "$SETUP_CONF" > "$tmp"
  else
    [[ -f "$SETUP_CONF" ]] && cat "$SETUP_CONF" > "$tmp"
    printf '%s=%s\n' "$1" "$2" >> "$tmp"
  fi
  commit_file "$tmp" "$SETUP_CONF" "$SETUP_CONF_MODE"
}

# ── Config builder: four-step wizard ─────────────────────────────────────────
# Step 1  Developing vs Running
# Step 2  (Running only) How will HQ be reachable?
#           local       just this computer (default, safe by design)
#           public      published at a domain (Caddy + auto-TLS)
#           hardened    same exposure as local + structurally-impossible
#                       public exposure (host network + 127.0.0.1 binds)
# Step 3  Superuser account
# Step 4  Optionals — domain/ACME if public, plus per-capability foundation
#                     services (local container vs hosted via API key)

PROFILES=""; QUEUED_GRANTS=""; QUEUED_DEFAULTS=""; ENVIRONMENT="local"; STORAGE="local_fs"; FMODE="dev"
DOMAIN_OPT=""; ACME_EMAIL_OPT=""
SU_EMAIL_OPT=""; SU_PASSWORD_OPT=""
REACH="local"        # local | public | hardened — meaningful only when FMODE=prod
NETWORK_MODE="host"   # host | bridge — host is the default; bridge is the opt-out
MODE_SET=false; REACH_SET=false; NET_SET=false; SERVICES_SET=false; STORAGE_SET=false; USER_SET=false
LANG_LOCAL=false; EMB_LOCAL=false  # for summary display

add_profile() { [[ ",$PROFILES," == *",$1,"* ]] || PROFILES="${PROFILES:+$PROFILES,}$1"; }
# The wizard asks its questions before my-hq.yml is written, so answers queue
# here and apply_wizard_to_conf flushes them. They are (capability, provider)
# pairs — not env-var names to be decoded again later.
add_grant()   { QUEUED_GRANTS="${QUEUED_GRANTS}$1|$2|$3\n"; }    # CAP PROV LEVEL
add_default() { QUEUED_DEFAULTS="${QUEUED_DEFAULTS}$1|$2\n"; }   # CAP PROV

apply_mode() {
  case "$1" in
    dev|development|local) FMODE=dev;  ENVIRONMENT=local ;;
    prod|production|run|running) FMODE=prod; ENVIRONMENT=production ;;
    *) die "Unknown mode: '$1' (dev|production)" ;;
  esac
  MODE_SET=true
}

# Apply the reach choice (CLI: --reach NAME, or chosen interactively in step 2).
# Only meaningful when FMODE=prod. Sets REACH, NETWORK_MODE, and side-effects
# like adding the caddy profile.
# Network mode is its OWN axis — reach says who can get to HQ, network mode says
# how the containers are wired, and caddy-in-front is a valid combination with
# both. So an explicit --secure-network is never undone by a reach default that
# happens to be applied afterwards (e.g. the interactive step 2).
set_net() { [[ "$NET_SET" == true ]] || NETWORK_MODE="$1"; }

apply_reach() {
  case "$1" in
    local|just|computer)
      REACH=local; set_net bridge ;;
    public|published|domain)
      REACH=public; set_net bridge
      add_profile caddy ;;
    hardened|host|secure)
      REACH=hardened; set_net host ;;
    *) die "Unknown --reach: '$1' (local|public|hardened)" ;;
  esac
  REACH_SET=true
}

# Apply a non-interactive --with NAME flag (mirrors the interactive y/n choices).
apply_storage() {
  case "$1" in
    local_fs|local|files)
      STORAGE=local_fs
      : ;;   # storage has no grant — it is never a user-facing credential
    s3|garage|minio)
      # minio accepted as the old spelling; it was always just an S3 bucket.
      STORAGE=s3; add_profile garage ;;
    s3|external)
      STORAGE=s3 ;;
    *) die "Unknown --storage: '$1' (local_fs|s3)" ;;
  esac
  STORAGE_SET=true
}

# Boxed wizard step framing — clearly distinct from the main dashboard.
wizard_step() {
  local step="$1" total="$2" title="$3"
  clear 2>/dev/null || true
  say "${BLUE}┌─ Setup wizard · Step ${step} of ${total} · ${title}${NC}"
  say "${BLUE}│${NC}"
}
wizard_end() { say "${BLUE}└─────────────────────────────────────────────────────────────────────${NC}"; }

# y/n helper. Default: 'y' or 'n'. With ASSUME_YES, returns the default.
ask_yn() {
  local prompt="$1" default="${2:-n}" hint reply
  case "$default" in y|Y) hint="[Y/n]"; default=y ;; *) hint="[y/N]"; default=n ;; esac
  if [[ "${ASSUME_YES:-false}" == true ]]; then
    [[ "$default" == y ]]; return $?
  fi
  read -rp "  ${prompt} ${hint}: " reply
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

# Compute total wizard steps based on path. Running = 4 (usage, reach, user,
# optionals), Developing = 3 (usage, user, optionals — no reach choice).
wizard_total_steps() { [[ "$FMODE" == prod ]] && echo 4 || echo 3; }

# Step 1 — usage: developing vs running.
choose_usage_interactive() {
  local default_mode; default_mode="$(conf_get last_mode running)"
  wizard_step 1 "$(wizard_total_steps)" "How will you use HQ?"
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    1) ${BOLD}Developing${NC} — you're working on HQ's code"
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    2) ${BOLD}Running it${NC} — you want to use HQ for actual work"
  wizard_end
  local d
  case "$default_mode" in dev|development) d=1 ;; *) d=2 ;; esac

  if [[ "${ASSUME_YES:-false}" == true ]]; then
    [[ "$d" == 1 ]] && apply_mode dev || apply_mode running
    return 0
  fi
  local sel; read -rp "  Your choice [press Enter for: ${d}]: " sel
  sel="${sel:-$d}"
  case "$sel" in
    1|dev|development)        apply_mode dev ;;
    2|run|running|prod|production) apply_mode production ;;
    *) die "Invalid choice: '$sel' (1 or 2)" ;;
  esac
}

# Step 2 — reach: only shown when FMODE=prod.
# Plain language for the basic options; technical depth only for the advanced one.
choose_reach_interactive() {
  [[ "$FMODE" == prod ]] || return 0
  local default_reach; default_reach="$(conf_get last_reach local)"
  wizard_step 2 "$(wizard_total_steps)" "How will HQ be reachable?"
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    1) ${BOLD}Just from this computer${NC}"
  say "${BLUE}│${NC}       Only browsers on this machine can reach HQ. Nothing is exposed"
  say "${BLUE}│${NC}       to your local network or the internet. Safe on any machine."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    2) ${BOLD}From the internet, at a domain you own${NC}"
  say "${BLUE}│${NC}       HQ runs at https://your-domain.com with automatic TLS"
  say "${BLUE}│${NC}       certificates (free, via Let's Encrypt). Your domain must"
  say "${BLUE}│${NC}       already point at this server's IP address."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    3) ${BOLD}Just from this computer — hardened${NC} ${DIM}(advanced)${NC}"
  say "${BLUE}│${NC}       Same exposure as option 1, plus stricter network isolation:"
  say "${BLUE}│${NC}       all services share the host's network namespace and bind to"
  say "${BLUE}│${NC}       127.0.0.1, making accidental network exposure structurally"
  say "${BLUE}│${NC}       impossible. Recommended for security-focused deployments."
  say "${BLUE}│${NC}       On Mac/Windows requires enabling Docker Desktop's host"
  say "${BLUE}│${NC}       networking feature (Settings → Resources → Network)."
  wizard_end
  local d
  case "$default_reach" in
    local|just) d=1 ;;
    public|published|domain|hosted) d=2 ;;
    hardened|host|secure) d=3 ;;
    *) d=1 ;;
  esac

  if [[ "${ASSUME_YES:-false}" == true ]]; then
    case "$default_reach" in
      public|published|hosted) apply_reach public ;;
      hardened|host)           apply_reach hardened ;;
      *)                       apply_reach local ;;
    esac
    return 0
  fi
  local sel; read -rp "  Your choice [press Enter for: ${d}]: " sel
  sel="${sel:-$d}"
  case "$sel" in
    1|local|just)                apply_reach local ;;
    2|public|published|domain)   apply_reach public ;;
    3|hardened|host|secure)      apply_reach hardened ;;
    *) die "Invalid choice: '$sel' (1, 2, or 3)" ;;
  esac
}

# Step 3 — superuser identity. Plain prompts, no jargon.
choose_user_interactive() {
  local step; step=$([[ "$FMODE" == prod ]] && echo 3 || echo 2)
  wizard_step "$step" "$(wizard_total_steps)" "Create your first user"
  say "${BLUE}│${NC}  This is the admin account. You can add more users later from"
  say "${BLUE}│${NC}  inside HQ."
  wizard_end

  local cur_email; cur_email="$(get_env FIRST_SUPERUSER)"
  is_placeholder "$cur_email" && cur_email=""

  if [[ "${ASSUME_YES:-false}" == true ]]; then
    [[ -n "$cur_email" ]] || SU_EMAIL_OPT="admin@localhost"
    # Generate a password if there isn't a real one already.
    local cur_pw; cur_pw="$(get_env FIRST_SUPERUSER_PASSWORD)"
    if is_placeholder "$cur_pw"; then SU_PASSWORD_OPT="$(gen_secret)"; fi
    return 0
  fi

  local email; read -rp "  Email${cur_email:+ [$cur_email]}: " email
  email="${email:-$cur_email}"
  [[ -n "$email" ]] || die "Email is required."
  SU_EMAIL_OPT="$email"

  # The email question offers the existing value as a default; the password one
  # must too, or a re-run forces the operator to invent a new password for an
  # account that already works. An empty SU_PASSWORD_OPT is already the "leave
  # it alone" signal — ensure_env only writes the var when it is non-empty.
  local cur_pw keep_ok=false
  cur_pw="$(get_env FIRST_SUPERUSER_PASSWORD)"
  is_placeholder "$cur_pw" || keep_ok=true

  local pw1 pw2
  while true; do
    if $keep_ok; then
      read -rsp "  Password (min 8 chars, Enter keeps the current one): " pw1; echo
      [[ -z "$pw1" ]] && { SU_PASSWORD_OPT=""; return 0; }
    else
      read -rsp "  Password (min 8 chars): " pw1; echo
    fi
    [[ ${#pw1} -ge 8 ]] || { warn "Too short."; continue; }
    read -rsp "  Confirm password:        " pw2; echo
    [[ "$pw1" == "$pw2" ]] && break
    warn "Passwords don't match — try again."
  done
  SU_PASSWORD_OPT="$pw1"
}

# Step 4 — optionals.
# (a) Domain + ACME email, but only if reach=public.
# (b) Foundation services: per-capability local-vs-hosted toggles + storage.
# Defaults for the service questions come from the CURRENT .env, not from "off".
# Re-running the wizard (especially with -y) must not silently disable services
# you already had — the answer to "do you want ollama?" defaults to "you already
# do". Same principle as conf_get last_mode seeding the mode question.
profile_default() {
  yon "foundation.run.$1" && echo y || echo n
}

choose_optionals_interactive() {
  local step; step=$([[ "$FMODE" == prod ]] && echo 4 || echo 3)
  wizard_step "$step" "$(wizard_total_steps)" "Optional choices"
  say "${BLUE}│${NC}  Foundation services have safe defaults. Pick local containers"
  say "${BLUE}│${NC}  only when you actually need them — you can always enable hosted"
  say "${BLUE}│${NC}  providers later in the dashboard by pasting an API key."
  wizard_end

  # (a) Domain + ACME if reach=public.
  if [[ "$REACH" == public && "${ASSUME_YES:-false}" != true ]]; then
    echo
    say "${BOLD}Domain & TLS${NC}  ${DIM}(needed because you picked option 2)${NC}"
    local cur_d cur_a; cur_d="$(get_env DOMAIN)"; cur_a="$(get_env ACME_EMAIL)"
    is_placeholder "$cur_d" && cur_d=""
    local dom; read -rp "  Domain (e.g. hq.example.org)${cur_d:+ [$cur_d]}: " dom
    dom="${dom:-$cur_d}"
    [[ -n "$dom" ]] || die "Domain is required when publishing on the internet."
    DOMAIN_OPT="$dom"
    local acme; read -rp "  Contact email (for Let's Encrypt notices)${cur_a:+ [$cur_a]}: " acme
    ACME_EMAIL_OPT="${acme:-$cur_a}"
    [[ -n "$ACME_EMAIL_OPT" ]] || warn "Contact email empty — Let's Encrypt still works but you won't get expiry warnings."
  fi

  # (b) Foundation services.
  echo
  say "${BOLD}AI chat models${NC}  ${DIM}(annotation, agents, chat)${NC}"
  say "  ${DIM}Local container:${NC}  Ollama — runs open models on your hardware"
  say "  ${DIM}Hosted (API key):${NC} OpenAI, Anthropic, Mistral, …"
  if ask_yn "Run Ollama locally?" "$(profile_default ollama)"; then
    add_profile ollama
    add_grant language ollama all
    LANG_LOCAL=true
  fi

  echo
  say "${BOLD}Embeddings${NC}  ${DIM}(semantic search, retrieval)${NC}"
  say "  ${DIM}Local container:${NC}  Ollama (same container as above if enabled)"
  say "  ${DIM}Hosted (API key):${NC} OpenAI, Voyage, Jina, …"
  local emb_default; emb_default="$(profile_default ollama)"
  $LANG_LOCAL && emb_default=y
  if ask_yn "Use Ollama for embeddings?" "$emb_default"; then
    add_profile ollama
    add_grant embedding ollama all
    EMB_LOCAL=true
  fi

  echo
  say "${BOLD}Web search${NC}  ${DIM}(live news, agent browsing)${NC}"
  say "  ${DIM}Local container:${NC}  SearXNG — meta-searches DuckDuckGo, Brave, Bing…"
  say "  ${DIM}Hosted (API key):${NC} Tavily, Serper, Exa (future)"
  if ask_yn "Run SearXNG locally?" "$(profile_default searxng)"; then
    add_profile searxng
    add_grant   web_search searxng all
    add_default web_search searxng
  fi

  echo
  say "${BOLD}Geocoding${NC}  ${DIM}(place names ↔ coordinates)${NC}"
  say "  ${DIM}Local container:${NC}  Nominatim — OpenStreetMap on your hardware"
  say "                    ${DIM}(needs ~5GB disk + ~2h initial import)${NC}"
  say "  ${DIM}Hosted (API key):${NC} external geocoders"
  if ask_yn "Run Nominatim locally?" "$(profile_default nominatim)"; then
    add_profile nominatim
    add_grant   geocoding nominatim_local all
    add_default geocoding nominatim_local
  fi

  echo
  if ! $STORAGE_SET; then
    say "${BOLD}File storage${NC}  ${DIM}(uploads, dataset blobs, exports)${NC}"
    say "  ${DIM}1) Local files${NC}    Just a directory on this machine (./.store/local_fs)"
    say "  ${DIM}2) Object storage${NC} S3 — Garage in Docker, or your own bucket"
    say "  ${DIM}3) External S3${NC}    AWS S3 or compatible — credentials added later"
    local d=1   # local_fs is the safe default for everyone — s3 opt-in
    if [[ "${ASSUME_YES:-false}" == true ]]; then
      apply_storage local_fs
    else
      local s; read -rp "  Storage [press Enter for: ${d}]: " s
      s="${s:-$d}"
      case "$s" in
        1|local_fs|local|files) apply_storage local_fs ;;
        2|s3|garage|minio)      apply_storage s3 ;;
        3|s3|external)          apply_storage s3 ;;
        *) die "Invalid storage choice: '$s'" ;;
      esac
    fi
  fi
}

# Step 2 — per-capability local-vs-hosted toggles with what-each-does context
choose_local_services_interactive() {
  wizard_step 2 2 "Which foundation services should run locally?"
  say "${BLUE}│${NC}  For each capability, choose between a local container or a"
  say "${BLUE}│${NC}  hosted/cloud provider. Hosted providers are configured later"
  say "${BLUE}│${NC}  via API keys in the dashboard. Defaults are conservative —"
  say "${BLUE}│${NC}  add containers only when you actually need them."
  wizard_end

  echo
  say "${BOLD}Language models${NC}  ${DIM}(chat, annotation, agents)${NC}"
  say "  ${DIM}Local:${NC}  Ollama — open models, in a container on this machine"
  say "  ${DIM}Hosted:${NC} OpenAI, Anthropic, Mistral, etc. via API keys"
  if ask_yn "Run Ollama locally?" "$(profile_default ollama)"; then
    add_profile ollama
    add_grant language ollama all
    LANG_LOCAL=true
  fi

  echo
  say "${BOLD}Embeddings${NC}  ${DIM}(semantic search, retrieval)${NC}"
  say "  ${DIM}Local:${NC}  Ollama (reuses the language container if enabled)"
  say "  ${DIM}Hosted:${NC} OpenAI, Voyage, Jina via API keys"
  local emb_default; emb_default="$(profile_default ollama)"
  $LANG_LOCAL && emb_default=y
  if ask_yn "Use Ollama for embeddings?" "$emb_default"; then
    add_profile ollama
    add_grant embedding ollama all
    EMB_LOCAL=true
  fi

  echo
  say "${BOLD}Web search${NC}  ${DIM}(live news, agent browsing)${NC}"
  say "  ${DIM}Local:${NC}  SearXNG — meta-search across DuckDuckGo, Brave, Bing, etc."
  say "  ${DIM}Hosted:${NC} Tavily, Serper, Exa via API keys (future)"
  if ask_yn "Run SearXNG locally?" "$(profile_default searxng)"; then
    add_profile searxng
    add_grant   web_search searxng all
    add_default web_search searxng
  fi

  echo
  say "${BOLD}Geocoding${NC}  ${DIM}(place name ↔ coordinates)${NC}"
  say "  ${DIM}Local:${NC}  Nominatim — OpenStreetMap on your hardware"
  say "          ${DIM}(~5GB disk + ~2h import for world admin boundaries)${NC}"
  say "  ${DIM}Hosted:${NC} external geocoders via API keys"
  if ask_yn "Run Nominatim locally?" "$(profile_default nominatim)"; then
    add_profile nominatim
    add_grant   geocoding nominatim_local all
    add_default geocoding nominatim_local
  fi

  echo
  if ! $STORAGE_SET; then
    say "${BOLD}Object storage${NC}  ${DIM}(uploaded files, dataset blobs, exports)${NC}"
    say "  ${DIM}1) Local files${NC}   Just a directory on disk (./.store/local_fs)"
    say "  ${DIM}2) Object storage${NC} S3 — Garage in Docker, or your own bucket"
    say "  ${DIM}3) External S3${NC}   AWS S3 or compatible — credentials in dashboard"
    local d=1   # local_fs is the safe default for everyone — s3 opt-in
    if [[ "${ASSUME_YES:-false}" == true ]]; then
      apply_storage local_fs
    else
      local s; read -rp "  Storage [press Enter for: ${d}]: " s
      s="${s:-$d}"
      case "$s" in
        1|local_fs|local|files) apply_storage local_fs ;;
        2|s3|garage|minio)      apply_storage s3 ;;
        3|s3|external)          apply_storage s3 ;;
        *) die "Invalid storage choice: '$s'" ;;
      esac
    fi
  fi
}

# ── Filesystem setup ──────────────────────────────────────────────────────────

ensure_store_dirs() {
  mkdir -p ./.store ./.config
  if yon foundation.run.garage; then
    if [[ -d ./.store/garage ]]; then
      say "${DIM}keeping existing garage data ($(find ./.store/garage -maxdepth 1 | wc -l) entries)${NC}"
    else
      mkdir -p ./.store/garage/meta ./.store/garage/data; chmod -R 700 ./.store/garage
      ok "created ./.store/garage (0700)"
    fi
  fi
  # nominatim keeps its data in named volumes; nothing bind-mounts .store/nominatim.
  if [[ "$(yget deployment.network.reach)" == public ]]; then
    [[ -f ./.config/caddy/Caddyfile ]] || die ".config/caddy/Caddyfile missing — repo state is inconsistent."
  fi
  return 0
}

ensure_local_fs_path() {
  [[ "$(yget deployment.storage.use)" == "local_fs" ]] || return 0
  # Host-side path (LOCAL_STORAGE_HOST_PATH) lives under .store/ alongside
  # garage/nominatim — same convention, no sudo needed on fresh clones.
  # Container-side path (LOCAL_STORAGE_BASE_PATH) stays /data/storage; the
  # compose bind maps one to the other.
  local host; host="$(yget deployment.storage.user_uploads.host_path)"; host="${host:-./.store/local_fs}"
  if [[ ! -d "$host" ]]; then
    mkdir -p "$host" 2>/dev/null \
      || die "$host does not exist and is not creatable. Run: sudo mkdir -p $host && sudo chown $(id -u) $host"
    chmod 755 "$host"
    ok "created local_fs host path $host (0755)"
  elif [[ ! -w "$host" ]]; then
    die "$host exists but is not writable by $(id -un). Fix ownership and re-run."
  else
    say "${DIM}local_fs host path $host ok${NC}"
  fi
}

# ── Port availability checks ──────────────────────────────────────────────────
# Detect whether anything is listening on a TCP port locally. Tries `nc -z`
# (cross-platform, fast), then bash's built-in /dev/tcp as a fallback. We
# deliberately do NOT use `timeout` — it isn't installed by default on macOS
# and the earlier implementation silently treated every port as free when
# timeout was missing.
port_in_use() {
  local p="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$p" >/dev/null 2>&1
  else
    # Loopback connections are instant; no real risk of hanging.
    (exec 3<>/dev/tcp/127.0.0.1/"$p") 2>/dev/null && { exec 3<&- 3>&-; return 0; }
    return 1
  fi
}

# Effective mode/profiles, preferring in-process state during the wizard and
# falling back to the persisted .env afterward. The dashboard runs with stale
# state vars (FMODE="dev" from script init), so without this fallback we'd
# pick the wrong compose files + skip checking the wrong ports.
effective_fmode() {
  # Wizard explicitly set the mode → trust state var. Otherwise read .env so
  # the dashboard/settings menu reflect persisted choice rather than the
  # script-init default of "dev".
  if "${MODE_SET:-false}"; then echo "$FMODE"; return; fi
  [[ "$(yget stack.environment)" == "production" ]] && echo prod || echo dev
}
effective_profiles() {
  if [[ -n "$PROFILES" ]]; then echo "$PROFILES"; return; fi
  [[ -f "$ENV_FILE" ]] && get_env COMPOSE_PROFILES || true
}

# Ports HQ will try to bind on the host, given the effective mode + active
# profiles. Returns one port per line.
needed_host_ports() {
  local mode profs net
  mode="$(effective_fmode)"
  profs="$(effective_profiles)"
  net="$(active_network_mode)"

  # Frontend host port (always bound in bridge mode; in host mode the frontend
  # container binds 127.0.0.1:3000 directly to the host).
  local fp; fp="$(get_env FRONTEND_PORT)"; echo "${fp:-3000}"

  # Dev override binds backend on the host for direct API access.
  if [[ "$mode" == dev ]]; then
    local bp; bp="$(get_env BACKEND_PORT)"; echo "${bp:-8022}"
  fi

  # Caddy when active — always 0.0.0.0:80,443.
  [[ ",$profs," == *",caddy,"* ]] && { echo 80; echo 443; }

  # Ollama when active — bridge: 127.0.0.1:11434; host: 11434 directly.
  [[ ",$profs," == *",ollama,"* ]] && provider_port ollama

  # Host network mode adds everything else.
  if [[ "$net" == host ]]; then
    local bp pp rp
    bp="$(get_env BACKEND_PORT)";  echo "${bp:-8022}"
    pp="$(get_env POSTGRES_PORT)"; echo "${pp:-5432}"
    rp="$(get_env REDIS_PORT)";    echo "${rp:-6379}"
    [[ ",$profs," == *",searxng,"* ]] && provider_port searxng
    [[ ",$profs," == *",nominatim,"* ]] && provider_port nominatim_local
    # garage also holds rpc 3901 and admin 3903; those are fixed in garage.toml.
    [[ ",$profs," == *",garage,"* ]] && { url_port "$(yget deployment.services.s3.endpoint)"; echo 3901; echo 3903; }
  fi
  # Every emit above is a conditional `[[ ]] && echo`, so the last one deciding
  # NOT to emit would make this function return 1. Under `set -e` + pipefail
  # that kills the caller's `ports="$(needed_host_ports | ...)"` assignment
  # before it prints anything — a silent exit. Always succeed; emitting nothing
  # is a valid answer.
  return 0
}

# For movable ports (BACKEND/POSTGRES/REDIS/FRONTEND), pick the next free
# port upward from the current value. Caller updates .env. Fixed-port
# services (caddy/ollama/garage/searxng/nominatim) can't be auto-moved —
# their wire protocols expect specific ports.
next_free_port() {
  local p=$(( $1 + 1 ))
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
}

# Map a port number back to the env var that controls it, IF it's one of the
# movable user-config ports. Returns empty string for fixed ports (80, 443,
# 11434, etc.) — those expect specific wire-protocol ports and can't be moved.
port_to_env_var() {
  local p="$1" bp pp rp fp
  bp="$(get_env BACKEND_PORT)";  bp="${bp:-8022}"
  pp="$(get_env POSTGRES_PORT)"; pp="${pp:-5432}"
  rp="$(get_env REDIS_PORT)";    rp="${rp:-6379}"
  fp="$(get_env FRONTEND_PORT)"; fp="${fp:-3000}"
  case "$p" in
    "$bp") echo BACKEND_PORT  ;;
    "$pp") echo POSTGRES_PORT ;;
    "$rp") echo REDIS_PORT    ;;
    "$fp") echo FRONTEND_PORT ;;
  esac
}

precheck_ports() {
  # Ports held by our OWN stack are not conflicts. `up -d` recreates containers
  # in place and each listener moves with its container, so restarting a running
  # deployment is a normal operation — without this it reports every one of its
  # own ports as taken by "another process" and refuses to start. The precheck
  # exists to catch a FIRST start colliding with something unrelated on the box.
  if stack_has_any_container; then
    say "${DIM}stack already present — skipping port precheck (its ports are its own).${NC}"
    return 0
  fi
  local ports; ports="$(needed_host_ports | sort -u | tr '\n' ' ')"
  say "${DIM}checking host ports: ${ports}${NC}"
  local conflicts=() p
  for p in $ports; do
    [[ -z "$p" ]] && continue
    port_in_use "$p" && conflicts+=("$p")
  done

  [[ ${#conflicts[@]} -eq 0 ]] && { say "${DIM}all ports free.${NC}"; return 0; }

  echo
  warn "These host ports HQ wants are already in use:"
  for p in "${conflicts[@]}"; do
    printf "    %s   ${DIM}(in use by another process)${NC}\n" "$p"
  done
  echo

  # Build a reverse-lookup from port number to env var name (only movables).
  local backend_p postgres_p redis_p frontend_p
  backend_p="$(get_env BACKEND_PORT)";  backend_p="${backend_p:-8022}"
  postgres_p="$(get_env POSTGRES_PORT)"; postgres_p="${postgres_p:-5432}"
  redis_p="$(get_env REDIS_PORT)";       redis_p="${redis_p:-6379}"
  frontend_p="$(get_env FRONTEND_PORT)"; frontend_p="${frontend_p:-3000}"

  # Detect any fixed-port conflicts; those need user action.
  local fixed_blockers=()
  for p in "${conflicts[@]}"; do
    case "$p" in
      "$backend_p"|"$postgres_p"|"$redis_p"|"$frontend_p") : ;;
      80|443) fixed_blockers+=("$p  ${DIM}(caddy — likely nginx/apache running)${NC}") ;;
      11434)  fixed_blockers+=("$p  ${DIM}(ollama — local ollama already running)${NC}") ;;
      8888)   fixed_blockers+=("$p  ${DIM}(searxng)${NC}") ;;
      3900|3901|3903) fixed_blockers+=("$p  ${DIM}(garage)${NC}") ;;
      8080)   fixed_blockers+=("$p  ${DIM}(nominatim)${NC}") ;;
      *)      fixed_blockers+=("$p  ${DIM}(unknown — fixed)${NC}") ;;
    esac
  done

  if [[ ${#fixed_blockers[@]} -gt 0 ]]; then
    warn "These can't be auto-moved (the protocol expects a specific port):"
    for p in "${fixed_blockers[@]}"; do echo "    $p"; done
    echo
    say "  Stop the conflicting process, then re-run setup. On Linux:"
    say "    ${DIM}sudo ss -ltnp | grep ':<port>'${NC}        ${DIM}# find the PID${NC}"
    die "Resolve fixed-port conflicts and re-run."
  fi

  if [[ "${ASSUME_YES:-false}" == true ]]; then
    say "Auto-yes: bumping movable ports upward."
  elif ! confirm "Auto-pick free alternatives for the movable ports above?"; then
    die "Aborted — free up the ports or set alternatives in .env, then re-run."
  fi

  backup_env
  for p in "${conflicts[@]}"; do
    local var="" new
    case "$p" in
      "$backend_p")  var=BACKEND_PORT  ;;
      "$postgres_p") var=POSTGRES_PORT ;;
      "$redis_p")    var=REDIS_PORT    ;;
      "$frontend_p") var=FRONTEND_PORT ;;
    esac
    [[ -z "$var" ]] && continue
    new="$(next_free_port "$p")"
    set_env "$var" "$new"
    ok "moved $var: $p → $new"
  done
}

# Static guard against accidental public binds in compose.yml. We promise users
# that "Just from this computer" really means just from this computer — the
# only listener on 0.0.0.0 should be caddy (profile-gated, intentionally public).
# Anything else with 0.0.0.0:port:port slipped past review.
assert_no_stray_public_binds() {
  [[ -f compose.yml ]] || return 0
  # Pull every "<n>:<n>" port mapping that isn't preceded by 127.0.0.1: or
  # localhost:, then check whether we're inside the caddy service block.
  local offenders
  offenders="$(awk '
    /^  [a-z_]+:$/ { svc = $1; sub(":", "", svc) }
    /- *"[0-9]+:[0-9]+/ {
      # match port-mapping lines that lack a loopback bind prefix
      if ($0 !~ /127\.0\.0\.1:/ && $0 !~ /localhost:/ && svc != "caddy") {
        printf "  %s:  %s\n", svc, $0
      }
    }
  ' compose.yml)"
  if [[ -n "$offenders" ]]; then
    warn "compose.yml has stray public port bindings (0.0.0.0) outside caddy:"
    printf '%s\n' "$offenders"
    die "Refusing to proceed — fix compose.yml so only caddy binds 0.0.0.0."
  fi
}

# Generate the host-network override fragment under .config/hq/.
# This file is NOT checked into the repo; it lives next to setup.conf as a
# UX/state artifact. compose_cmd appends `-f $HOST_NET_FRAGMENT` when active.
#
# What this does:
#   • network_mode: host on every service, so containers share the host's
#     network namespace. No docker bridge, no NAT, no port mappings.
#   • extra_hosts maps every service name (db, redis, backend, ...) to the
#     bind address, so in-app URLs like redis://redis:6379 still resolve.
#   • Every listener is pinned to that same address. One value, one name:
#     ${HQ_BIND_HOST}. Each service spells it in whatever key its own server
#     reads — postgres wants listen_addresses, redis --bind, uvicorn HOST,
#     granian GRANIAN_HOST, garage's config file. Those names belong to the
#     vendors, so they are annotated here rather than renamed.
#
# Two compose merge tags are load-bearing:
#   • `ports: !reset null` and `networks: !reset null` on EVERY service.
#     Both are incompatible with network_mode: host. Resetting unconditionally
#     means a `ports:` added to compose.yml later cannot silently break this
#     mode — it is removed whether or not anyone remembered this file.
#   • `extra_hosts: !override`. Compose MERGES extra_hosts across files, so
#     without it compose.override.yml's `host.docker.internal:host-gateway`
#     survives alongside ours and /etc/hosts ends up with two conflicting
#     entries for the same name.
write_host_net_fragment() {
  local tmp; tmp="$(stage_file "$HOST_NET_FRAGMENT")"

  # Every address comes from my-hq.yml. Hardcoding them here is what let the
  # fragment drift from the config it is supposed to implement.
  local sx_port ol_port nm_port s3_host s3_port
  sx_port="$(provider_port searxng)"
  ol_port="$(provider_port ollama)"
  nm_port="$(provider_port nominatim_local)"
  s3_host="$(url_host "$(yget deployment.services.s3.endpoint)")"
  s3_port="$(url_port "$(yget deployment.services.s3.endpoint)")"

  # One namespace means one port space. In bridge mode two services can both
  # sit on 8080 because each has its own; here they cannot.
  local seen="" svc port collide=""
  for svc in "searxng:$sx_port" "ollama:$ol_port" "nominatim:$nm_port" \
             "backend:$(yget deployment.services.backend.port)" \
             "frontend:$(yget deployment.services.frontend.port)" \
             "postgres:$(yget deployment.services.database.port)" \
             "redis:$(yget deployment.services.redis.port)" \
             "s3:$s3_port"; do
    port="${svc##*:}"; [[ -z "$port" ]] && continue
    [[ " $seen " == *" $port "* ]] && collide="${collide} ${svc%%:*}($port)"
    seen="$seen $port"
  done
  [[ -n "$collide" ]] && die "Port collision in host mode:${collide}. Every service shares
one namespace here — give them distinct ports in $CONF_FILE."

  # Service names still resolve: extra_hosts points each at the bind address.
  local hosts="" h
  for h in host.docker.internal db redis backend frontend caddy \
           "$(provider_host searxng)" "$(provider_host ollama)" \
           "$(provider_host nominatim_local)" "$s3_host"; do
    [[ -z "$h" ]] && continue
    [[ " $hosts " == *" $h "* ]] && continue
    hosts="$hosts $h"
  done

  {
    cat <<'YAML'
# Generated by ./setup.sh — DO NOT edit by hand.
# Regenerate by re-running the wizard or toggling network mode in Settings.
#
# Every service joins the host's network namespace and binds HQ_BIND_HOST.
# `ports:` and `networks:` are !reset — meaningless without a namespace of your
# own. Names still resolve through extra_hosts, so redis://redis:6379 keeps
# working. Caddy is the only thing that binds the wildcard, and only when you
# asked to publish. Ports and hostnames below are derived from my-hq.yml.

x-extra-hosts: &extra_hosts !override
YAML
    for h in $hosts; do
      printf '  - "%s:${HQ_BIND_HOST:-127.0.0.1}"\n' "$h"
    done
    cat <<'YAML'

x-host-net: &host_net
  network_mode: "host"
  networks: !reset null
  ports: !reset null
  extra_hosts: *extra_hosts
YAML
    cat <<YAML

x-searxng-url: &searxng_url
  SEARXNG_BASE_URL: http://$(provider_host searxng):${sx_port}/

services:
  db:
    <<: *host_net
    command:                                          # postgres: listen_addresses
      - postgres
      - -c
      - listen_addresses=\${HQ_BIND_HOST:-127.0.0.1}
      - -c
      - port=\${POSTGRES_PORT:-5432}

  backend:
    <<: *host_net
    environment:
      <<: *searxng_url
      BACKEND_BIND_HOST: \${HQ_BIND_HOST:-127.0.0.1}   # prod: compose.yml command
      HOST: \${HQ_BIND_HOST:-127.0.0.1}                # dev:  start-reload.sh

  redis:
    <<: *host_net
    command: >                                        # redis: --bind
      redis-server /usr/local/etc/redis/redis.conf
      --bind \${HQ_BIND_HOST:-127.0.0.1}
      --port \${REDIS_PORT:-6379}
      --appendonly yes
      --requirepass \${REDIS_PASSWORD}
      --rename-command REPLICAOF ""
      --rename-command SLAVEOF ""

  frontend:
    <<: *host_net
    environment:
      # prod runs the standalone server.js, which honours HOSTNAME.
      # dev runs \`next dev\`, which does NOT — it only takes -H, passed by
      # Dockerfile.dev's CMD from FRONTEND_BIND_HOST. Both are set so the
      # frontend binds loopback whichever command is in play.
      HOSTNAME: \${HQ_BIND_HOST:-127.0.0.1}
      FRONTEND_BIND_HOST: \${HQ_BIND_HOST:-127.0.0.1}
      PORT: \${FRONTEND_PORT:-3000}

  celery_worker:
    <<: *host_net
    environment: *searxng_url

  celery_worker_processing:
    <<: *host_net
    environment: *searxng_url

  celery_beat:
    <<: *host_net

  # Optional services — only materialize when their profile is active.
  ollama:
    <<: *host_net
    environment:                                      # ollama: OLLAMA_HOST
      OLLAMA_HOST: \${HQ_BIND_HOST:-127.0.0.1}:${ol_port}

  searxng:
    <<: *host_net
    environment:                                      # granian: the server searxng runs on
      <<: *searxng_url
      GRANIAN_HOST: \${HQ_BIND_HOST:-127.0.0.1}
      GRANIAN_PORT: ${sx_port}

  # Garage's binds come from the generated garage.toml (written with
  # HQ_BIND_HOST in host mode), so there is nothing to override here beyond
  # joining the namespace. Listed so the reset of ports:/networks: applies.
  garage:
    <<: *host_net

  # mediagis/nominatim hardcodes \`--bind :8080\` in /app/start.sh — no env var
  # reaches it (GUNICORN_CMD_ARGS loses to the CLI flag, verified). In a shared
  # namespace that is every interface, so the flag is rewritten before the real
  # entrypoint runs. If the upstream line ever moves, this refuses to start
  # rather than quietly binding the wildcard.
  nominatim:
    <<: *host_net
    command:
      - sh
      - -c
      - |
        grep -q -- '--bind :${nm_port}' /app/start.sh || {
          echo "nominatim: expected '--bind :${nm_port}' in /app/start.sh and did not find it."
          echo "Refusing to start: in host network mode that would bind every interface."
          exit 1
        }
        sed -i "s|--bind :${nm_port}|--bind \${HQ_BIND_HOST:-127.0.0.1}:${nm_port}|" /app/start.sh
        exec /app/start.sh

  caddy:
    <<: *host_net
    # Caddy intentionally binds 0.0.0.0:80,443 — the only public surface.
YAML
  } > "$tmp"
  commit_file "$tmp" "$HOST_NET_FRAGMENT" "$HOST_NET_MODE"
  ok "wrote $HOST_NET_FRAGMENT"
}

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    install -m "$ENV_MODE" "$EXAMPLE_FILE" "$ENV_FILE"; ok "created $ENV_FILE from $EXAMPLE_FILE"
  else
    backup_env
  fi
  say "Secrets:"
  ensure_secret SECRET_KEY            gen_secret
  ensure_secret ENCRYPTION_MASTER_KEY gen_fernet
  ensure_postgres_password   # special-cased — see comment in fn for why
  ensure_secret REDIS_PASSWORD        gen_secret

  # Everything non-secret the wizard collected goes to my-hq.yml, never here.
  # ENVIRONMENT / STORAGE_PROVIDER_TYPE / COMPOSE_PROFILES / BACKEND_BIND_HOST
  # are rendered into the generated region by render_env, from the yaml.
  # Superuser identity collected in step 3.
  [[ -n "$SU_EMAIL_OPT"    ]] && set_env FIRST_SUPERUSER          "$SU_EMAIL_OPT"
  [[ -n "$SU_PASSWORD_OPT" ]] && set_env FIRST_SUPERUSER_PASSWORD "$SU_PASSWORD_OPT"
  # Non-interactive fallback for callers that skip the wizard (e.g. -y without --su-email).
  # Password field uses silent read so it isn't echoed to the terminal/scrollback.
  [[ -n "${HQ_SUPERUSER_EMAIL:-}"    ]] && set_env FIRST_SUPERUSER          "$HQ_SUPERUSER_EMAIL"
  [[ -n "${HQ_SUPERUSER_PASSWORD:-}" ]] && set_env FIRST_SUPERUSER_PASSWORD "$HQ_SUPERUSER_PASSWORD"
  for k in FIRST_SUPERUSER FIRST_SUPERUSER_PASSWORD; do
    local cur; cur="$(get_env "$k")"
    if is_placeholder "$cur" && [[ "${ASSUME_YES:-false}" != true ]]; then
      local v
      if [[ "$k" == "FIRST_SUPERUSER_PASSWORD" ]]; then
        read -rsp "  $k: " v; echo
      else
        read -rp  "  $k: " v
      fi
      [[ -n "$v" ]] && set_env "$k" "$v"
    fi
  done
}

summary() {
  say "\n${GREEN}Resolved configuration${NC}"
  local usage
  if   [[ "$FMODE" == dev ]]; then usage="developing (source-bound, hot reload)"
  else
    case "$REACH" in
      public)   usage="running it — published on the internet" ;;
      hardened) usage="running it — just from this computer (hardened)" ;;
      *)        usage="running it — just from this computer" ;;
    esac
  fi
  say "  using:     ${usage}"
  if [[ "$REACH" == public && -n "$DOMAIN_OPT" ]]; then
    local acme_note=""
    [[ -n "$ACME_EMAIL_OPT" ]] && acme_note="  ${DIM}(LE contact: ${ACME_EMAIL_OPT})${NC}"
    say "  reach:     https://${DOMAIN_OPT}${acme_note}"
  elif [[ "$FMODE" == prod ]]; then
    say "  reach:     localhost only (frontend on 127.0.0.1:3000)"
  fi
  say "  network:   ${NETWORK_MODE}$([[ "$NETWORK_MODE" == host ]] && echo '  (loopback-only, no port mappings)' || echo '')"
  say "  storage:   ${STORAGE}"
  say "  profiles:  ${PROFILES:-<none, lean core>}"
  [[ -n "$SU_EMAIL_OPT" ]] && say "  admin:     ${SU_EMAIL_OPT}"
  say "  workers:   backend=${BACKEND_WORKERS:-4} celery=${CELERY_CONCURRENCY:-4}"
  [[ "${ASSUME_YES:-false}" == true ]] && return 0
  # Nothing was asked this run — every value came from a flag or from the
  # existing configuration — so there is nothing here the operator has not
  # already stated. The confirmation exists for the wizard, which makes choices
  # on their behalf; echoing their own command back at them is just friction.
  if $MODE_SET && $USER_SET && $SERVICES_SET && $STORAGE_SET \
     && { [[ "$FMODE" != prod ]] || $REACH_SET; }; then
    return 0
  fi
  read -rp $'\nProceed? [Y/n] ' a; [[ "${a:-Y}" =~ ^[Yy]?$ ]] || die "Aborted."
}

# ── Compose / stack ───────────────────────────────────────────────────────────

# The compose invocation, from the same COMPOSE_FILE a bare `docker compose`
# would read. Deriving it twice is how the script and the user's own command
# end up disagreeing about which files are in play; there is one list now, in
# .env, rendered from the yaml.
compose_cmd() {
  local files; files="$(get_env COMPOSE_FILE)"
  [[ -z "$files" ]] && files="$(derived_compose_file)"
  local f base="docker compose"
  local IFS=:
  for f in $files; do [[ -f "$f" ]] && base="$base -f $f"; done
  echo "$base"
}

# The network mode in effect. An explicit choice made THIS run wins
# (--secure-network, or a --reach that implies it); otherwise the choice
# persisted in setup.conf, because a later invocation — logs, down, the
# dashboard — must address the stack the way it was actually started.
#
# NETWORK_MODE cannot be tested for emptiness here: it is seeded to "bridge" at
# the top of the script, so `${NETWORK_MODE:-$(conf_get ...)}` never consults
# setup.conf at all. That silently handed bridge-mode compose commands to a
# hardened stack, which `docker compose up` then recreates un-hardened.
# The mode my-hq.yml declares — the same value derived_compose_file, render_env
# and write_garage_config read. A wizard run in flight wins, because the yaml
# has not been written yet at that point.
active_network_mode() {
  if [[ "${NET_SET:-false}" == true || "${REACH_SET:-false}" == true ]]; then
    echo "$NETWORK_MODE"
  else
    local m; m="$(yget deployment.network.mode)"
    echo "${m:-bridge}"
  fi
}

active_profiles() { echo "${PROFILES:-$(derived_profiles)}"; }

# After a host-network start, assert that what is ACTUALLY listening matches what
# the fragment declared. Reading the YAML cannot tell you this — a bind knob can
# be inert (searxng listens via granian, which ignores the BIND_ADDRESS this
# script used to write) or simply absent (`next dev` ignores HOSTNAME). Both look
# correct in review and both produce a public port on a machine the operator was
# told is loopback-only. Caddy is the one service expected to bind the wildcard.
#
# The expectation is HQ_BIND_HOST, not a hardcoded 127.0.0.1, so the check
# follows the declaration rather than drifting from it.
verify_loopback_only() {
  command -v ss >/dev/null 2>&1 || { warn "ss unavailable — skipping loopback audit."; return 0; }
  local want; want="$(get_env HQ_BIND_HOST)"; want="${want:-127.0.0.1}"
  local profs; profs="$(effective_profiles)"
  local ours; ours="$(needed_host_ports | sort -u | tr '\n' ' ')"
  local offenders=() addr host port

  # Walk what is actually bound, not what we hoped would be. Column 4 of
  # `ss -ltnH` is Local Address:Port — "127.0.0.1:8022", "*:3000", "[::]:80".
  while read -r _ _ _ addr _; do
    [[ -z "$addr" ]] && continue
    port="${addr##*:}"
    host="${addr%:*}"
    # Only judge ports this deployment claims; the box may run unrelated things.
    [[ " $ours " == *" $port "* ]] || continue
    # Caddy is deliberately public — it is the only front door.
    if [[ ",$profs," == *",caddy,"* ]] && [[ "$port" == 80 || "$port" == 443 ]]; then continue; fi
    [[ "$host" == "$want" ]] || offenders+=("port $port is bound on $host")
  done < <(ss -ltnH 2>/dev/null)

  if [[ ${#offenders[@]} -gt 0 ]]; then
    echo
    warn "Hardened network is NOT holding. These listeners are not on $want:"
    for addr in "${offenders[@]}"; do echo "    $addr"; done
    echo
    say "  Each is a service whose bind setting did not take effect. Identify it with:"
    say "    ${DIM}sudo ss -ltnp | grep ':<port>'${NC}"
    say "  Re-check with: ${BOLD}./setup.sh audit${NC}"
    return 1
  fi
  ok "loopback audit passed — every HQ listener is on $want."
  return 0
}

# All stack ops follow the same pattern: leave the dashboard's alt-screen
# buffer (if active) so docker compose's progress writer doesn't overdraw
# the menu, run the command, show the result, pause for keypress, restore
# alt-screen. Outside the dashboard (e.g. fresh-clone wizard, CLI init)
# alt-screen is off and the pause/restore steps are no-ops.

# Modes are declared next to the paths; this applies them to whatever is already
# on disk. A file written before the modes were stated — or by an older setup.sh —
# keeps its old bits until something rewrites it, and .env backups are the case
# that matters: they are full copies of .env.
enforce_modes() {
  local spec f m
  for spec in "$ENV_FILE|$ENV_MODE" "$CONF_FILE|$CONF_MODE" \
              "$SETUP_CONF|$SETUP_CONF_MODE" "$HOST_NET_FRAGMENT|$HOST_NET_MODE" \
              "$GARAGE_CONFIG|$GARAGE_CONFIG_MODE"; do
    f="${spec%|*}"; m="${spec##*|}"
    [[ -e "$f" ]] && chmod "$m" "$f"
  done
  if [[ -d "$ENV_BACKUP_DIR" ]]; then
    chmod "$ENV_BACKUP_DIR_MODE" "$ENV_BACKUP_DIR"
    find "$ENV_BACKUP_DIR" -maxdepth 1 -type f -name '.env.bak.*' -exec chmod "$ENV_MODE" {} +
  fi
  return 0
}

# Everything derived from my-hq.yml, regenerated. No prompts, no dashboard, safe
# to run at any time — this is the half of setup.sh that is not a wizard, and
# `./setup.sh render && docker compose up -d` is a complete story without it.
do_render() {
  ensure_conf
  enforce_modes
  check_network_coherence
  ensure_store_dirs
  ensure_local_fs_path
  if yon foundation.run.garage || [[ "$(yget deployment.storage.use)" == s3 ]]; then
    ensure_s3_secrets
  fi
  yon foundation.run.garage && write_garage_config
  if [[ "$(active_network_mode)" == host ]]; then
    write_host_net_fragment
  else
    rm -f "$HOST_NET_FRAGMENT"
  fi
  prune_env
  render_env
  return 0
}

# .env's generated region is derived from my-hq.yml; if the yaml moved since, the
# derived files are stale and compose would run on the old ones. Regenerate
# rather than refuse: the inputs are all on disk, so there is nothing to ask.
ensure_derived_current() {
  [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || return 0
  local want have
  want="$(conf_sha)"; have="$(get_env HQ_CONFIG_SHA)"
  [[ "$want" == "$have" ]] && return 0
  say "${DIM}$CONF_FILE changed since .env was rendered — re-rendering.${NC}"
  do_render
  return 0
}

stack_up() {                       # stack_up [strict]
  local strict="${1:-}"
  # compose.yml must never bind the wildcard outside caddy. Cheap, and the
  # guarantee it protects is one we make on every start, not only on init.
  assert_no_stray_public_binds
  ensure_derived_current
  local was_alt="${ALT_SCREEN_ON:-false}"
  [[ "$was_alt" == "true" ]] && leave_alt_screen
  # Precheck runs AFTER alt-screen leave so its output / conflict prompt
  # lands on the normal terminal, not overlaid on the dashboard.
  [[ -f "$ENV_FILE" ]] && precheck_ports

  local c rc=0; c="$(compose_cmd)"

  # First attempt — tee output so we can both show the user AND scan for
  # post-bind port conflicts that the precheck might have missed (orphan
  # containers in other compose projects, race conditions, etc.).
  local logfile; logfile="$(mktemp)"
  say "\n${DIM}$c up --build -d${NC}"
  set +e
  COMPOSE_PROFILES="$(active_profiles)" $c up --build -d 2>&1 | tee "$logfile"
  rc=${PIPESTATUS[0]}
  set -e

  # Fallback: if compose failed with "address already in use" on a movable
  # port, bump it and retry ONCE. Don't loop — second failure usually means
  # something fixed (caddy 80, ollama 11434) is conflicting, which the user
  # needs to resolve themselves.
  if [[ $rc -ne 0 ]] && grep -q "address already in use" "$logfile"; then
    local stuck_port var
    stuck_port="$(grep -oE "127\.0\.0\.1:[0-9]+" "$logfile" | head -1 | cut -d: -f2)"
    [[ -z "$stuck_port" ]] && stuck_port="$(grep -oE '"[0-9]+:[0-9]+"' "$logfile" | head -1 | cut -d: -f1 | tr -d '"')"
    var="$(port_to_env_var "$stuck_port")"
    if [[ -n "$var" ]]; then
      local new; new="$(next_free_port "$stuck_port")"
      echo
      warn "Compose failed on port $stuck_port (precheck missed it — likely an orphan container in another compose project)."
      warn "Bumping $var: $stuck_port → $new and retrying once."
      backup_env; set_env "$var" "$new"
      say "\n${DIM}$c up --build -d   (retry)${NC}"
      set +e
      COMPOSE_PROFILES="$(active_profiles)" $c up --build -d 2>&1 | tee "$logfile"
      rc=${PIPESTATUS[0]}
      set -e
    fi
  fi
  rm -f "$logfile"

  if [[ $rc -eq 0 ]]; then
    ok "Up. Open: $(login_url)"
    # Compose saying "up" only means the containers started — the backend can
    # still restart-loop on a config error (usually a postgres password that
    # doesn't match the data volume). Poll briefly, diagnose if bad.
    # Whether the superuser can actually log in is the user's to check; the
    # script has no business holding up the start to try it for them.
    verify_backend_started || rc=1
    # Garage serves nothing until a layout and bucket exist. Idempotent, so
    # running it on every start is simpler than tracking whether it ran.
    if [[ $rc -eq 0 ]] && yon foundation.run.garage; then
      garage_bootstrap
    fi
    # Hardening is a claim until something checks it. Only meaningful in host
    # mode — in bridge mode docker's port publishing decides the bind address.
    if [[ "$(active_network_mode)" == host ]] && ! verify_loopback_only; then
      # The stack IS up; only the claim failed. A CLI run must refuse to report
      # success. The dashboard must not: "Start failed" would be false, and the
      # finding is on screen for the user to act on.
      [[ "$strict" == strict ]] && die "Refusing to report a hardened stack that is publicly bound."
    fi
  else
    warn "Start failed (exit $rc). See output above for the failing service."
  fi
  if [[ "$was_alt" == "true" ]]; then pause; enter_alt_screen; fi
  return $rc
}

# Poll backend status post-up. Returns 0 on healthy, non-zero if backend is
# clearly broken (restart-looping / exited) and we couldn't auto-recover.
# Times out at ~24s — fast path bails as soon as backend is "Up".
verify_backend_started() {
  local c; c="$(compose_cmd)"
  local profs; profs="$(active_profiles)"
  say "${DIM}verifying backend started cleanly…${NC}"
  local i status
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 2
    status="$(COMPOSE_PROFILES="$profs" $c ps backend --format '{{.Status}}' 2>/dev/null)"
    case "$status" in
      Up*)            ok "  backend healthy"; return 0 ;;
      Restarting*|Exited*)
        # Bad state — look at logs for known signatures we can auto-fix.
        local logs
        logs="$(COMPOSE_PROFILES="$profs" $c logs --tail 100 backend 2>/dev/null)"
        if echo "$logs" | grep -q "password authentication failed for user"; then
          handle_postgres_password_mismatch
          return $?
        fi
        echo
        warn "Backend is in a bad state ($status) but the failure isn't a"
        warn "recognized pattern. Recent logs:"
        echo "$logs" | tail -20 | sed 's/^/  /'
        return 1
        ;;
    esac
  done
  warn "Backend didn't reach 'Up' within 24s. Check: $c logs backend"
  return 1
}



# Postgres password in .env doesn't match what's in the data volume — most
# often because .env was hand-edited or restored from a backup. Offer the
# in-place fix (wipe volume + generate matching password + restart).
handle_postgres_password_mismatch() {
  echo
  warn "Backend can't authenticate with postgres — password mismatch."
  warn "POSTGRES_PASSWORD in .env doesn't match the password baked into"
  warn "the postgres data volume on its first init."
  echo
  say "  ${BOLD}1${NC}  Wipe the postgres volume + generate a fresh matching password"
  say "      ${DIM}(deletes all postgres data — annotations, schemas, etc.)${NC}"
  say "  ${BOLD}2${NC}  Cancel — I'll edit .env myself to restore the right password"
  echo
  if [[ "${ASSUME_YES:-false}" == true ]]; then
    warn "Auto-yes mode refuses to silently destroy data. Re-run interactively."
    return 1
  fi
  local choice; read -rp "  Your choice [1/2]: " choice
  case "$choice" in
    1)
      local c; c="$(compose_cmd)"
      local profs; profs="$(active_profiles)"
      say "${DIM}stopping stack…${NC}"
      COMPOSE_PROFILES="$profs" $c down >/dev/null 2>&1 || true
      local v removed=0
      while IFS= read -r v; do
        [[ -z "$v" ]] && continue
        docker volume rm "$v" >/dev/null 2>&1 && removed=$((removed + 1))
      done < <(docker volume ls --format '{{.Name}}' | grep -Fx "$(project_volume app-db-data)")
      if [[ "$removed" -eq 0 ]]; then
        warn "Could not remove the postgres volume. Run manually:"
        warn "    $c down  &&  docker volume rm <volume-name>"
        return 1
      fi
      backup_env
      set_env POSTGRES_PASSWORD "$(gen_secret)"
      ok "wiped postgres volume + generated fresh POSTGRES_PASSWORD"
      say "${DIM}restarting…${NC}"
      COMPOSE_PROFILES="$profs" $c up -d
      local rc=$?
      [[ $rc -eq 0 ]] && ok "Backend should now connect cleanly." \
                     || warn "Restart failed — see output above."
      return $rc ;;
    *)
      warn "OK — restore the right POSTGRES_PASSWORD in .env, then restart with:"
      warn "    $(compose_cmd) restart backend celery_worker celery_beat"
      return 1 ;;
  esac
}

stack_down() {
  local was_alt="${ALT_SCREEN_ON:-false}"
  [[ "$was_alt" == "true" ]] && leave_alt_screen
  local c rc=0; c="$(compose_cmd)"
  say "\n${DIM}$c down${NC}  ${DIM}(data volumes preserved — never 'down -v')${NC}"
  COMPOSE_PROFILES="$(active_profiles)" $c down || rc=$?
  if [[ $rc -eq 0 ]]; then ok "Stopped."
  else warn "Stop failed (exit $rc)."; fi
  if [[ "$was_alt" == "true" ]]; then pause; enter_alt_screen; fi
  return $rc
}

stack_restart() {
  local was_alt="${ALT_SCREEN_ON:-false}"
  [[ "$was_alt" == "true" ]] && leave_alt_screen
  local c rc=0; c="$(compose_cmd)"
  say "\n${DIM}$c restart${NC}"
  COMPOSE_PROFILES="$(active_profiles)" $c restart || rc=$?
  if [[ $rc -eq 0 ]]; then ok "Restarted."
  else warn "Restart failed (exit $rc)."; fi
  if [[ "$was_alt" == "true" ]]; then pause; enter_alt_screen; fi
  return $rc
}

stack_logs() {
  local c; c="$(compose_cmd)"
  clear 2>/dev/null || true
  say "${GREEN}╭─ Live logs ─────────────────────────────────────────────────────────────╮${NC}"
  say "${GREEN}│${NC}  To leave the logs and return to the dashboard:"
  say "${GREEN}│${NC}    ${BOLD}press ${YELLOW}Ctrl-C${NC}${BOLD}${NC}  ${DIM}(hold the Control key and press C)${NC}"
  say "${GREEN}│${NC}"
  say "${GREEN}│${NC}  ${DIM}Closing the terminal is also safe — your stack stays running.${NC}"
  say "${GREEN}╰─────────────────────────────────────────────────────────────────────────╯${NC}"
  echo
  # Trap SIGINT just for this call so the script doesn't propagate the exit;
  # docker exits cleanly on Ctrl-C, then we restore the normal handler.
  trap ':' INT
  COMPOSE_PROFILES="$(active_profiles)" $c logs -f --tail=100 || true
  trap '__cleanup; exit 130' INT
  echo
  ok "Left the logs. Returning to the dashboard…"
  sleep 1
}

# A CLI invocation against an already-configured deployment is a CHANGE, not a
# setup. `./setup.sh dev secure` means "apply these two words and start" — it
# has no business re-interrogating the operator about an account that already
# works or services already chosen. Whatever is genuinely absent is still asked
# for; whatever exists is inherited.
#
# Inheriting is not a convenience, it is required for correctness: PROFILES
# drives foundation.run, so skipping the optionals step with PROFILES empty
# would turn off every optional service the deployment had.
#
# Called only from the CLI dispatch path. The bare-command wizard and the
# dashboard's "re-run setup" both deliberately want every question asked, and
# they reach do_init without passing through here.
inherit_existing_config() {
  [[ -f "$ENV_FILE" ]] || return 0

  local email pw
  email="$(get_env FIRST_SUPERUSER)"
  pw="$(get_env FIRST_SUPERUSER_PASSWORD)"
  if ! is_placeholder "$email" && ! is_placeholder "$pw"; then
    USER_SET=true
  fi

  # Both come from my-hq.yml now, not from a comma string in .env.
  if ! $SERVICES_SET; then
    PROFILES="$(derived_profiles)"
    SERVICES_SET=true
  fi

  if ! $STORAGE_SET; then
    local st; st="$(yget deployment.storage.use)"
    if [[ -n "$st" ]]; then STORAGE="$st"; STORAGE_SET=true; fi
  fi
}

do_init() {
  ensure_conf              # the wizard reads its defaults from it
  $MODE_SET     || choose_usage_interactive
  if [[ "$FMODE" == prod ]] && ! $REACH_SET; then
    choose_reach_interactive
  fi
  $USER_SET     || choose_user_interactive
  $SERVICES_SET || choose_optionals_interactive
  # Sensible default when storage wasn't set (interactively or via CLI):
  # local files by default; object storage is opt-in. Keeps `-y`
  # from silently leaving prod on local_fs.
  if ! $STORAGE_SET; then
    apply_storage local_fs
  fi
  apply_wizard_to_conf     # the wizard's choices land in the yaml…
  ensure_env               # …secrets land in .env…
  do_render                # …and everything derived is regenerated from both
  summary
  # strict: a CLI run must refuse to report success on a hardened stack that is
  # publicly bound. The dashboard passes no flag and keeps the finding on screen.
  stack_up strict
  echo
  say "${DIM}You can manage the stack directly with:${NC}"
  say "  ${BOLD}$(compose_cmd) up -d${NC}     ${DIM}# start / restart${NC}"
  say "  ${BOLD}$(compose_cmd) logs -f${NC}   ${DIM}# tail logs${NC}"
  say "  ${BOLD}$(compose_cmd) down${NC}      ${DIM}# stop (data volumes preserved)${NC}"
  say "${DIM}(or run ./setup.sh anytime for the dashboard)${NC}"
  # Remember for next run — UX state lives in setup.conf, not .env.
  conf_set last_mode "$([[ "$FMODE" == dev ]] && echo dev || echo running)"
  conf_set last_reach "$REACH"
  conf_set setup_completed_at "$(date +%Y-%m-%dT%H:%M:%S)"
}

# ── Rotate ────────────────────────────────────────────────────────────────────

rotate_restart() {
  local c; c="$(compose_cmd)"
  COMPOSE_PROFILES="$(get_env COMPOSE_PROFILES)" $c up -d --force-recreate --no-deps \
    backend celery_worker celery_beat "$@"
}

rotate_fernet() {
  local old new c; c="$(compose_cmd)"
  old="$(get_env ENCRYPTION_MASTER_KEY)"
  [[ -n "$old" ]] || die "ENCRYPTION_MASTER_KEY is empty — nothing to rotate from."
  new="$(gen_fernet)"
  backup_env
  local fb; fb="$(get_env ENCRYPTION_MASTER_KEY_FALLBACKS)"
  set_env ENCRYPTION_MASTER_KEY_FALLBACKS "${fb:+$fb,}$old"
  set_env ENCRYPTION_MASTER_KEY "$new"
  warn "New primary key set; old key retained as decrypt-only fallback."
  rotate_restart
  $c exec -T backend python -m app.cli.rotate_credentials --yes \
    || die "Re-encryption failed. Old key still a fallback — investigate, then re-run."
  if [[ "${ASSUME_YES:-false}" != true ]]; then
    read -rp "Re-encryption verified. Clear the old fallback key now? [y/N] " a
    [[ "$a" =~ ^[Yy]$ ]] || { warn "Fallback kept. Clear ENCRYPTION_MASTER_KEY_FALLBACKS and re-run rotate when ready."; return 0; }
  fi
  set_env ENCRYPTION_MASTER_KEY_FALLBACKS ""
  rotate_restart
  ok "Fernet rotation complete. Old key retired."
}

rotate_postgres() {
  local user new c; c="$(compose_cmd)"
  user="$(get_env POSTGRES_USER)"; new="$(gen_secret)"
  backup_env
  warn "Altering Postgres password for role '$user' (db container stays up, volume untouched)."
  echo "ALTER USER \"$user\" WITH PASSWORD '$new';" \
    | $c exec -T db psql -U "$user" -d "$(yget deployment.services.database.name)" \
    || die "ALTER USER failed; .env NOT changed (backup kept)."
  set_env POSTGRES_PASSWORD "$new"
  rotate_restart
  ok "Postgres password rotated."
}

# The S3 key is a garage key, so rotating it means re-importing it there —
# .env and the node have to agree or every upload 403s.
rotate_s3() {
  backup_env
  set_env S3_SECRET_ACCESS_KEY "$(openssl rand -hex 32)"
  local c; c="$(compose_cmd)"
  if yon foundation.run.garage; then
    COMPOSE_PROFILES="$(active_profiles)" $c exec -T garage /garage key import --yes \
      -n hq "$(get_env S3_ACCESS_KEY_ID)" "$(get_env S3_SECRET_ACCESS_KEY)" \
      || die "Could not re-import the key into garage. .env now holds a secret the
node does not — restore from $ENV_BACKUP_DIR before starting anything."
  else
    warn "storage is external S3 — update the key at your provider to match .env."
  fi
  rotate_restart
  ok "S3 secret rotated."
}

rotate_redis() {
  local rp; rp="$(gen_secret)"
  backup_env
  set_env REDIS_PASSWORD "$rp"
  warn "Recreating redis (redis_data volume preserved); in-flight tasks may redeliver."
  rotate_restart redis
  ok "Redis password rotated."
}

rotate_secret_key() {
  backup_env
  set_env SECRET_KEY "$(gen_secret)"
  rotate_restart
  warn "SECRET_KEY rotated — all users must re-login (JWTs invalidated). No data migrated."
}

do_rotate() {
  [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || die "No $CONF_FILE / $ENV_FILE — run ./setup.sh first."
  local did=false
  for a in "${ROTATE_TARGETS[@]}"; do
    case "$a" in
      --fernet)     rotate_fernet; did=true ;;
      --postgres)   rotate_postgres; did=true ;;
      --s3|--minio) rotate_s3; did=true ;;
      --redis)      rotate_redis; did=true ;;
      --secret-key) rotate_secret_key; did=true ;;
      --all)        rotate_postgres; rotate_s3; rotate_redis; rotate_secret_key; rotate_fernet; did=true ;;
      *) die "Unknown rotate target: $a" ;;
    esac
  done
  [[ "$did" == true ]] || die "Specify what to rotate (see --help)."
}

# ── State helpers ─────────────────────────────────────────────────────────────

# `docker compose version` round-trips to the daemon (~150ms). Memoize the
# answer for the script lifetime — docker doesn't get installed mid-run.
__DOCKER_OK_CACHED=""
docker_ok() {
  if [[ -z "$__DOCKER_OK_CACHED" ]]; then
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
      __DOCKER_OK_CACHED=yes
    else
      __DOCKER_OK_CACHED=no
    fi
  fi
  [[ "$__DOCKER_OK_CACHED" == "yes" ]]
}

# `docker compose ps` is the only slow op in this script (~250-500ms per call,
# round-trip to the Docker daemon). A single dashboard render previously fired
# it 10+ times via the various helpers — visible as a ~1-2s pause between the
# header appearing and the menu rendering. We cache the running-services list
# once per dashboard iteration; the loop primes the cache at the top and
# invalidates before dispatching actions (so an action sees fresh state).
__PS_CACHE=""
__PS_CACHE_VALID=false

prime_ps_cache() {
  __PS_CACHE_VALID=false
  if docker_ok; then
    __PS_CACHE="$({ COMPOSE_PROFILES="$(active_profiles)" $(compose_cmd) ps --status running \
      --format '{{.Service}}' 2>/dev/null | sort | tr '\n' ' '; } || echo "")"
  else
    __PS_CACHE=""
  fi
  __PS_CACHE_VALID=true
}

invalidate_ps_cache() { __PS_CACHE_VALID=false; __PS_CACHE=""; }

running_services() {
  if $__PS_CACHE_VALID; then echo "$__PS_CACHE"; return 0; fi
  docker_ok || return 0
  { COMPOSE_PROFILES="$(active_profiles)" $(compose_cmd) ps --status running \
    --format '{{.Service}}' 2>/dev/null | sort | tr '\n' ' '; } || true
}

backend_running() {
  # Route through running_services so the cache is used when primed.
  local svcs; svcs="$(running_services)"
  [[ " $svcs " == *" backend "* ]]
}

stack_is_running() { backend_running; }

# True if any project container exists in any state (including restarting,
# exited, paused). Used to distinguish "fully stopped" from "degraded".
stack_has_any_container() {
  docker_ok || return 1
  COMPOSE_PROFILES="$(active_profiles)" $(compose_cmd) ps -a \
    --format '{{.Service}}' 2>/dev/null | grep -q .
}

placeholder_secrets() {
  local k out=""
  for k in SECRET_KEY ENCRYPTION_MASTER_KEY POSTGRES_PASSWORD REDIS_PASSWORD FIRST_SUPERUSER_PASSWORD; do
    is_placeholder "$(get_env "$k")" && out="${out:+$out, }$k"
  done
  echo "$out"
}

service_label() {  # combined display — used by the dashboard's optional-features table + drift checks
  printf "%s (%s)" "$(service_name "$1")" "$(service_desc "$1")"
}

service_name() {
  case "$1" in
    db) echo "Postgres" ;; backend) echo "Backend API" ;; frontend) echo "Frontend UI" ;;
    redis) echo "Redis" ;; celery_worker) echo "Celery worker" ;; celery_beat) echo "Celery scheduler" ;;
    garage) echo "Garage" ;;
    ollama) echo "Ollama" ;; searxng) echo "SearXNG" ;;
    nominatim) echo "Nominatim" ;; caddy) echo "Caddy" ;;
    *) echo "$1" ;;
  esac
}

service_desc() {
  case "$1" in
    db) echo "database" ;; redis) echo "queue + cache" ;;
    garage) echo "object storage (S3)" ;;
    ollama) echo "local LLM + embeddings" ;;
    searxng) echo "web search" ;; nominatim) echo "geocoder" ;;
    caddy) echo "HTTPS reverse proxy + auto-TLS" ;;
    *) echo "" ;;
  esac
}

bool_show() { local v; v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"; [[ "$v" == "true" || "$v" == "1" || "$v" == "yes" ]] && echo "yes" || echo "no"; }
is_dev_mode() { [[ "$(yget stack.environment)" != "production" ]]; }

mode_display() {
  if is_dev_mode; then
    echo "dev (live reload, single backend worker)"
  else
    local bw cc extra=""
    bw="$(get_env BACKEND_WORKERS)"; bw="${bw:-4}"
    cc="$(get_env CELERY_CONCURRENCY)"; cc="${cc:-4}"
    profile_active caddy && extra=", behind Caddy + TLS"
    echo "production (${bw} backend workers, ${cc} celery tasks${extra})"
  fi
}

email_line() {
  local host port from
  host="$(yget deployment.email.host)"; port="$(yget deployment.email.port)"; from="$(yget deployment.email.from_email)"
  if [[ -z "$host" ]]; then echo "${DIM}not configured${NC}"
  else echo "${host}:${port:-587}  ${DIM}sends as ${from:-<unset>}${NC}"; fi
}

signup_display() {
  local r v rs vs
  r="$(bool_show "$(yget deployment.users.open_registration)")"
  v="$(bool_show "$(yget deployment.users.require_email_verification)")"
  [[ "$r" == "yes" ]] && rs="open" || rs="closed"
  [[ "$v" == "yes" ]] && vs="email verification required" || vs="no email verification"
  echo "${rs}  ${DIM}·${NC}  ${vs}"
}

profile_active() { yon "foundation.run.$1"; }

add_profile_persist() { yset "foundation.run.$1" true; render_env; }

remove_profile_persist() { yset "foundation.run.$1" false; render_env; }

# ── Capability / provider toggle (the single source of truth) ─────────────────
# Every menu path that enables or disables a provider goes through these — so
# the grant + compose profile + system default + container state stay aligned.
# Caller is responsible for backup_env before invoking + restart prompt after.

# True when PROVIDER is the active default for some *other* capability — i.e.
# turning it off here must not yank the compose profile from another menu.
provider_other_grants_present() {  # CAP PROVIDER
  local cap="$1" prov="$2" other v
  for other in $(printf '%s\n' "$PROVIDERS_FOR" | awk '{print $1}'); do
    [[ -z "$other" || "$other" == "$cap" ]] && continue   # only OTHER capabilities
    providers_for_cap "$other" | grep -qFx "$prov" || continue
    v="$(yget "foundation.access.$other.$prov")"
    [[ -n "$v" && "$v" != "none" ]] && return 0
  done
  return 1
}

# Conservative replacement when the active *_PROVIDER_TYPE is being disabled.
# Prefers a still-active provider for the same capability; falls back to the
# canonical "always works" choice if nothing else is on.
cap_fallback_provider() {  # CAP [EXCLUDE_PROVIDER]
  local cap="$1" exclude="${2:-}" prov
  for prov in $(providers_for_cap "$cap"); do
    [[ "$prov" == "$exclude" ]] && continue
    provider_active "$cap" "$prov" || continue
    echo "$prov"; return 0
  done
  # Static fallbacks for capabilities that need a default to function.
  case "$cap" in
    ocr)       echo "tesseract"   ;;     # built-in, no setup
    storage)   echo "local_fs"    ;;     # built-in, always available
    geocoding) echo "nominatim_api" ;;   # free public API, keyless
    scraping)  echo "newspaper4k" ;;     # built-in
    *)         echo "" ;;                # language/embedding/web_search: empty is OK
  esac
}

# Enable a provider for a capability. Persists to .env. Does NOT restart the
# stack — caller decides when (so toggling several providers in one screen
# only triggers one restart).
provider_enable() {  # CAP PROVIDER
  local cap="$1" prov="$2"
  local kind prof
  kind="$(prov_field "$cap" "$prov" kind)"
  prof="$(prov_field "$cap" "$prov" profile)"

  # Compose profile for container-kind providers.
  if [[ "$kind" == "container" && -n "$prof" ]]; then
    add_profile_persist "$prof"
    # On-disk pre-reqs that the wizard's ensure_store_dirs handles for new
    # installs but that a dashboard-driven enable also needs.
    case "$prof" in
      garage)
        [[ -d ./.store/garage ]] || { mkdir -p ./.store/garage/meta ./.store/garage/data; chmod -R 700 ./.store/garage; }
        ensure_s3_secrets; write_garage_config ;;
      nominatim)
        [[ -d ./.store/nominatim ]] || { mkdir -p ./.store/nominatim; chmod 755 ./.store/nominatim; } ;;
    esac
  fi

  # Access grant: share the deployment-level provider with everyone by default.
  # Sharing menus can narrow this to admins-only or back to blocked.
  prov_set_grant "$cap" "$prov" "all"

  # System default for capabilities that pick one provider at resolve time.
  # Only set if currently unset — never overwrite an operator's explicit choice.
  if cap_has_default "$cap"; then
    local cur; cur="$(cap_default "$cap")"
    [[ -z "$cur" ]] && cap_set_default "$cap" "$prov"
  fi
  render_env
}

# Disable a provider for a capability. Removes the grant; removes the profile
# (and stops the running container) only when no other capability references
# the same container.
provider_disable() {  # CAP PROVIDER
  local cap="$1" prov="$2"
  local kind prof
  kind="$(prov_field "$cap" "$prov" kind)"
  prof="$(prov_field "$cap" "$prov" profile)"

  prov_set_grant "$cap" "$prov" "none"

  # If this provider was the system default, hand it off to a safe fallback
  # before anything else picks it up. Pass `$prov` as the exclude so the
  # fallback search doesn't recommend the very provider we're disabling
  # (its compose profile is still active for one more step).
  if cap_has_default "$cap" && [[ "$(cap_default "$cap")" == "$prov" ]]; then
    cap_set_default "$cap" "$(cap_fallback_provider "$cap" "$prov")"
  fi
  render_env

  # Compose profile — keep it on if another capability still wants this
  # container. Stop + remove the container otherwise so docker actually
  # releases ports / RAM / disk.
  if [[ "$kind" == "container" && -n "$prof" ]]; then
    if provider_other_grants_present "$cap" "$prov"; then
      return 0
    fi
    remove_profile_persist "$prof"
    if docker_ok; then
      local c; c="$(compose_cmd)"
      $c stop "$prof"  >/dev/null 2>&1 || true
      $c rm -f "$prof" >/dev/null 2>&1 || true
    fi
  fi
}

# Drift: what's running vs what's configured.
configured_profiles() {
  derived_profiles | tr ',' '\n' | grep -v '^$' | sort -u
}
running_optional() {
  docker_ok || return 0
  local running; running="$(running_services)"
  local svc
  for svc in "${OPTIONAL_SERVICES[@]}"; do
    [[ " $running " == *" $svc "* ]] && echo "$svc"
  done
}
drift_extras()  { comm -23 <(running_optional) <(configured_profiles); }
drift_missing() { comm -13 <(running_optional) <(configured_profiles); }
has_drift() {
  stack_is_running || return 1
  local e m; e="$(drift_extras)"; m="$(drift_missing)"
  [[ -n "$e" || -n "$m" ]]
}

frontend_url() {
  local d port; d="$(get_env DOMAIN)"; port="$(get_env FRONTEND_PORT)"; port="${port:-3000}"
  if [[ "$(yget stack.environment)" == "production" && -n "$d" && "$d" != "localhost" ]]; then
    echo "https://$d"
  else
    echo "http://localhost:${port}"
  fi
}

# Where a freshly-booted user actually wants to land: the login page.
# Anything behind the UI requires auth anyway, so deep-linking past the
# marketing/landing route saves a click on every fresh boot.
login_url() { echo "$(frontend_url)/accounts/login"; }

backend_url() {
  local d port; d="$(get_env DOMAIN)"; port="$(get_env BACKEND_PORT)"; port="${port:-8022}"
  if [[ "$(yget stack.environment)" == "production" && -n "$d" && "$d" != "localhost" ]]; then
    echo "https://$d/api"
  else
    echo "http://localhost:${port}"
  fi
}

email_status() {  # one-line, used in submenus
  local host port from
  host="$(yget deployment.email.host)"; port="$(yget deployment.email.port)"; from="$(yget deployment.email.from_email)"
  if [[ -z "$host" ]]; then echo "not configured"
  else echo "${host}:${port:-587} from <${from:-?}>"; fi
}

storage_status() {
  local t; t="$(yget deployment.storage.use)"
  case "$t" in
    local_fs) local h; h="$(get_env LOCAL_STORAGE_HOST_PATH)"; echo "local files at ${h:-./.store/local_fs}" ;;
    minio)    echo "MinIO at $(get_env MINIO_ENDPOINT)" ;;
    s3)       echo "external S3 ($(get_env S3_BUCKET_NAME))" ;;
    *)        echo "$t" ;;
  esac
}

mask() {
  local v="$1"
  [[ -z "$v" ]] && { echo "not set"; return; }
  local n=${#v}
  if (( n <= 6 )); then echo "set"
  else echo "${v:0:3}…${v:n-2}"; fi
}

# ── UI primitives ─────────────────────────────────────────────────────────────

confirm()   { local a; read -rp "$(echo -e "${YELLOW}$1 [y/N] ${NC}")" a; [[ "$a" =~ ^[Yy]$ ]]; }
confirm_y() { local a; read -rp "$(echo -e "${YELLOW}$1 [Y/n] ${NC}")" a; [[ "${a:-Y}" =~ ^[Yy]$ ]]; }
pause()     { read -rp "$(echo -e "${DIM}— press Enter to continue —${NC}")" _; }

# Submenu single-key picker — one keystroke + a newline for clean prompt flow.
# Echoes the pressed key so the user sees what they typed (unlike the
# dashboard which uses `read -s` for silent live-refresh dispatch).
pick_menu() { # pick_menu VAR
  printf '\n%bPick: %b' "$YELLOW" "$NC"
  read -n 1 "$1"
  echo
}

prompt_set() {           # a secret, or anything else whose home is .env
  local cur new
  cur="$(get_env "$1")"
  read -rp "  $2 [${cur:-empty}]: " new
  if [[ -n "$new" ]]; then backup_env; set_env "$1" "$new"; ok "  $1 set."; fi
}

prompt_yset() {          # prompt_yset yaml.path "Label"  — config, so it goes to the yaml
  local cur new
  cur="$(yget "$1")"
  read -rp "  $2 [${cur:-empty}]: " new
  if [[ -n "$new" ]]; then yset "$1" "$new"; render_env; ok "  $1 set."; fi
}

prompt_set_password() {
  local new
  read -rsp "  $2 (hidden): " new; echo
  if [[ -n "$new" ]]; then backup_env; set_env "$1" "$new"; ok "  $1 set."; fi
}

toggle_bool() {          # toggle_bool yaml.path
  local key="$1" cur new lc; cur="$(yget "$key")"
  lc="$(printf '%s' "$cur" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in true|1|yes) new=false ;; *) new=true ;; esac
  yset "$key" "$new"; render_env
  ok "  $key = $new"
  if confirm "Restart backend to apply?"; then
    docker_ok && ( $(compose_cmd) restart backend ) || warn "Restart skipped."
  fi
  pause
}

edit_value() {
  read -rp "  Key (e.g. POSTGRES_PORT): " k
  [[ -z "$k" ]] && return
  local cur; cur="$(get_env "$k")"
  read -rp "  New value [${cur:-empty}]: " v
  [[ -z "$v" ]] && { warn "  no change"; pause; return; }
  backup_env; set_env "$k" "$v"
  ok "  $k = $v"
  pause
}

open_browser() {
  local url; url="$(login_url)"
  if   command -v xdg-open >/dev/null 2>&1; then ( xdg-open "$url" >/dev/null 2>&1 & )
  elif command -v open     >/dev/null 2>&1; then ( open     "$url" >/dev/null 2>&1 & )
  fi
  say "  ${BOLD}$url${NC}"
  pause
}

# fzf_pick — fuzzy-search picker when fzf is installed, numbered fallback when
# not. Stdin: one option per line. Args: prompt label, header text.
# Echoes the selected line (empty on cancel). Exit code 0 on selection, 1 cancel.
fzf_pick() { # fzf_pick "Pick:" "Header"
  local prompt="${1:-Pick:}" header="${2:-}"
  if $HAS_FZF; then
    fzf --prompt="$prompt " --header="$header" --height=40% --reverse --no-multi --no-info 2>/dev/null
    return $?
  fi
  # Numbered fallback (preserves stdin → array)
  local -a opts=(); local line
  while IFS= read -r line; do opts+=("$line"); done
  [[ -n "$header" ]] && say "  ${BOLD}$header${NC}"
  local i=0
  for line in "${opts[@]}"; do
    i=$((i+1)); printf "    ${GREEN}%d${NC} %s\n" "$i" "$line"
  done
  printf "    ${GREEN}0${NC} Cancel\n"
  local r
  read -rp "  $prompt " r
  [[ "$r" =~ ^[1-9][0-9]*$ && "$r" -le "${#opts[@]}" ]] || return 1
  printf '%s\n' "${opts[$((r-1))]}"
}

# ── Dashboard render ──────────────────────────────────────────────────────────

print_state() {
  # Inside the dashboard's alt-screen we use cursor_home + clear_below so the
  # full screen isn't wiped (no flicker). Outside the dashboard (e.g. summary)
  # we fall back to a plain clear.
  if $ALT_SCREEN_ON; then cursor_home; else clear 2>/dev/null || true; fi

  local heading_color heading_text running drift_n=0
  if [[ ! -f "$ENV_FILE" ]]; then
    heading_color="$YELLOW"; heading_text="not configured yet"
  elif stack_is_running; then
    heading_color="$GREEN"; heading_text="running"
  elif stack_has_any_container; then
    heading_color="$YELLOW"; heading_text="degraded (a container is failing — see logs)"
  else
    heading_color="$DIM"; heading_text="stopped"
  fi
  running="$(running_services)"

  # Header box with rounded corners — width fixed to 73 cols (fits 80-col terms)
  local hdr_w=73 fe_url
  fe_url="$(frontend_url)"
  say "${GREEN}╭─────────────────────────────────────────────────────────────────────────╮${NC}"
  if [[ "$heading_text" == "running" ]]; then
    printf "${GREEN}│${NC}  ${BOLD}HQ — %b%s%b${NC}%*s${BOLD}%s${NC}  ${GREEN}│${NC}\n" \
      "$heading_color" "$heading_text" "$NC" \
      $((hdr_w - 9 - ${#heading_text} - ${#fe_url})) "" \
      "$fe_url"
  else
    printf "${GREEN}│${NC}  ${BOLD}HQ — %b%s%b${NC}%*s  ${GREEN}│${NC}\n" \
      "$heading_color" "$heading_text" "$NC" \
      $((hdr_w - 7 - ${#heading_text})) ""
  fi
  say "${GREEN}╰─────────────────────────────────────────────────────────────────────────╯${NC}"

  if [[ ! -f "$ENV_FILE" ]]; then
    warn "  No .env yet. Pick option 1 below to set HQ up."
    echo; return
  fi

  printf "  %-12s %s\n" "Mode"      "$(mode_display)"
  local net; net="$(active_network_mode)"
  if [[ "$net" == host ]]; then
    printf "  %-12s ${YELLOW}%s${NC}  ${DIM}%s${NC}\n" "Network" "$net" "(loopback-only, no port mappings)"
  else
    printf "  %-12s %s\n" "Network" "$net"
  fi
  printf "  %-12s %s\n" "Storage"   "$(storage_status)"
  printf "  %-12s %s\n" "Superuser" "$(get_env FIRST_SUPERUSER)"
  printf "  %-12s %b\n" "Email"     "$(email_line)"
  printf "  %-12s %b\n" "Sign-ups"  "$(signup_display)"
  printf "  %-12s %s\n" "Domain"    "$(get_env DOMAIN)"
  echo

  say "  ${BOLD}Optional features${NC}"
  printf "    %-12s %-7s %-9s %s\n" "feature" "config" "running" "description"
  say "    ${DIM}───────────────────────────────────────────────────────────────${NC}"
  local p cfg_text cfg_color run_text run_color warn_str is_on is_run
  for p in "${OPTIONAL_SERVICES[@]}"; do
    if profile_active "$p"; then is_on=true;  cfg_text="on";  cfg_color="$GREEN"
    else                          is_on=false; cfg_text="off"; cfg_color="$DIM"; fi
    # ASCII status for clean column alignment (bytes==visible chars).
    if [[ " $running " == *" $p "* ]]; then is_run=true;  run_text="running"; run_color="$GREEN"
    else                                     is_run=false; run_text="-";       run_color="$DIM"; fi
    warn_str=""
    if   $is_on && ! $is_run && stack_is_running; then warn_str="   ${YELLOW}⚠ drift${NC}"; drift_n=$((drift_n+1))
    elif ! $is_on &&   $is_run;                   then warn_str="   ${YELLOW}⚠ drift${NC}"; drift_n=$((drift_n+1)); fi
    # Width specifiers go on plain text; color wraps OUTSIDE so columns stay aligned.
    printf "    %-12s %b%-7s%b %b%-9s%b %s%b\n" \
      "$(service_name "$p")" \
      "$cfg_color" "$cfg_text" "$NC" \
      "$run_color" "$run_text" "$NC" \
      "$(service_desc "$p")" "$warn_str"
  done

  if (( drift_n > 0 )); then
    echo
    warn "  ⚠ ${drift_n} feature(s) drift between saved config and running state."
    say "    ${DIM}→ option 7 below lets you reconcile (either direction).${NC}"
  fi

  local ph; ph="$(placeholder_secrets)"
  if [[ -n "$ph" ]]; then
    echo
    say "  ${RED}⚠ Unset / placeholder secrets:${NC} $ph"
    say "    ${DIM}→ open Settings (6) → Superuser to set FIRST_SUPERUSER_PASSWORD.${NC}"
  fi
  echo
}

# ── Sync features (drift reconciliation) ──────────────────────────────────────

sync_features() {
  if ! stack_is_running; then
    warn "HQ is stopped — start it first to inspect / reconcile drift."
    pause; return
  fi
  if ! has_drift; then
    ok "No drift — saved config and running state match."
    pause; return
  fi
  clear 2>/dev/null || true
  say "${GREEN}Sync services${NC}"
  echo
  printf "  Saved config:        %s\n" "$(get_env COMPOSE_PROFILES)"
  printf "  Currently running:   %s\n" "$(running_optional | tr '\n' ' ')"
  local extras missing
  extras="$(drift_extras | tr '\n' ' ')"
  missing="$(drift_missing | tr '\n' ' ')"
  [[ -n "${extras// /}" ]] && printf "  ${YELLOW}Running but not configured:${NC} %s\n" "$extras"
  [[ -n "${missing// /}" ]] && printf "  ${YELLOW}Configured but not running:${NC} %s\n" "$missing"
  echo
  say "  Which side wins?"
  say "    ${GREEN}1${NC}  Save what's running into my config  ${DIM}(record current state in COMPOSE_PROFILES)${NC}"
  say "    ${GREEN}2${NC}  Restart to match saved config       ${DIM}(stop extras, start anything missing)${NC}"
  say "    ${GREEN}0${NC}  Cancel"
  pick_menu r
  case "$r" in
    1) backup_env
       local new="" svc
       for svc in $(running_optional); do new="${new:+$new,}$svc"; done
       # foundation.run is the truth; COMPOSE_PROFILES is rendered from it.
       for svc in $(ykeys foundation.run); do
         [[ ",$new," == *",$svc,"* ]] && yset "foundation.run.$svc" true || yset "foundation.run.$svc" false
       done
       render_env
       ok "Saved: running services recorded in $CONF_FILE"
       pause
       ;;
    2) confirm_y "Stop [${extras:-<none>}] and start [${missing:-<none>}]?" || { warn "Cancelled."; pause; return; }
       local c svc; c="$(compose_cmd)"
       for svc in $extras; do
         say "${DIM}stopping $svc…${NC}"
         $c stop "$svc" >/dev/null 2>&1 || true
         $c rm -f "$svc" >/dev/null 2>&1 || true
       done
       if [[ -n "${missing// /}" ]]; then
         COMPOSE_PROFILES="$(get_env COMPOSE_PROFILES)" $c up -d $missing
       fi
       ok "Done."
       pause
       ;;
    0|"") return 0 ;;
    *) warn "Invalid."; pause ;;
  esac
}

# ── Capability-first foundation menus ─────────────────────────────────────────
# The foundation menu is the umbrella for everything HQ talks to: local
# containers (Ollama, Garage, SearXNG, Nominatim) and cloud APIs (OpenAI,
# Anthropic, …). It's structured by *capability* rather than by implementation
# (container-vs-cloud) so the user thinks in terms of "I want chat models",
# not "I want to flip a docker profile and also paste an API key over there".
#
# Per-capability menus integrate both axes — local container toggle, cloud
# keys, sharing — in one screen, and route every state change through
# provider_enable / provider_disable so grants, profiles, and system defaults
# stay aligned.

foundation_menu() {
  [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || { warn "Run setup first."; pause; return; }
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Foundation service providers${NC}"
    echo
    say "${DIM}  HQ uses pluggable providers for each capability — chat models,${NC}"
    say "${DIM}  embeddings, storage, OCR, geocoding, web search, scraping.${NC}"
    say "${DIM}  For each, you can run a local container, paste a cloud API key,${NC}"
    say "${DIM}  or both. Users pick which to use at runtime.${NC}"
    echo
    local i=0 row cap_key cap_label_v cap_desc_v
    for row in "${CAPABILITY_LIST[@]}"; do
      i=$((i+1))
      IFS='|' read -r cap_key cap_label_v cap_desc_v _ <<< "$row"
      printf "  ${GREEN}%d${NC}  %-18s %b\n" "$i" "$cap_label_v" "$(capability_status_line "$cap_key")"
      printf "     ${DIM}%s${NC}\n" "$cap_desc_v"
    done
    echo
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    if [[ "$r" =~ ^[1-9][0-9]*$ && "$r" -le "${#CAPABILITY_LIST[@]}" ]]; then
      IFS='|' read -r cap_key _ _ _ <<< "${CAPABILITY_LIST[$((r-1))]}"
      capability_menu "$cap_key"
    else
      case "$r" in 0|"") return 0 ;; *) warn "Invalid."; pause ;; esac
    fi
  done
}

# Dispatch: storage is exclusive (one provider serves all assets), scraping
# has only one provider today, everything else lets multiple providers be
# active concurrently.
capability_menu() {  # CAP
  case "$1" in
    storage)  cap_menu_storage ;;
    scraping) cap_menu_single "$1" ;;
    *)        cap_menu_multi "$1" ;;
  esac
}

# Generic per-capability screen for multi-provider capabilities (language,
# embedding, ocr, geocoding, web_search).
cap_menu_multi() {  # CAP
  local cap="$1" cap_label_v cap_desc_v
  cap_label_v="$(cap_field "$cap" label)"
  cap_desc_v="$(cap_field "$cap" desc)"
  local need_restart=false

  while true; do
    clear 2>/dev/null || true
    say "${GREEN}${cap_label_v}${NC}  ${DIM}${cap_desc_v}${NC}"
    if cap_has_default "$cap"; then
      local cur_type; cur_type="$(cap_default "$cap")"
      printf "  ${DIM}default provider when none specified: %s${NC}\n" "${cur_type:-<unset>}"
    fi
    echo
    printf "  ${BOLD}%-22s %-12s %s${NC}\n" "provider" "kind" "status"
    say "  ${DIM}─────────────────────────────────────────────────────────────────${NC}"

    # Build menu rows. Each row maps a number to a (kind, provider) tuple so
    # the action dispatcher can do the right thing without re-parsing labels.
    local -a row_kind=() row_prov=()
    local i=0 prov kind kenv
    for prov in $(providers_for_cap "$cap"); do
      i=$((i+1))
      kind="$(prov_field "$cap" "$prov" kind)"
      row_kind+=("$kind"); row_prov+=("$prov")
      local kind_label
      case "$kind" in
        container) kind_label="local container" ;;
        cloud)     kind_label="cloud API" ;;
        builtin)   kind_label="built-in" ;;
      esac
      printf "  ${GREEN}%d${NC} %-20s %-12s %b\n" "$i" "$(prov_field "$cap" "$prov" label)" "$kind_label" "$(provider_status_token "$cap" "$prov")"
      local notes; notes="$(prov_field "$cap" "$prov" notes)"
      [[ -n "$notes" ]] && printf "    ${DIM}%s${NC}\n" "$notes"
    done

    echo
    say "  Pick a number to ${BOLD}configure${NC} that provider."
    # Surface Ollama model management once at the bottom when Ollama is on
    # for this capability — it's a common follow-up after enabling.
    local ollama_on=false
    if profile_active ollama && [[ "$cap" == "language" || "$cap" == "embedding" || "$cap" == "ocr" ]]; then
      ollama_on=true
      say "  ${GREEN}m${NC}  Pull / manage Ollama models"
    fi
    $need_restart && say "  ${GREEN}a${NC}  Apply changes (restart stack)"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r

    case "$r" in
      0|"") $need_restart && _maybe_restart_for_changes; return 0 ;;
      m|M)  $ollama_on && { cap_ollama_pull_prompt "$cap"; pause; } || { warn "Ollama isn't enabled for this capability yet."; pause; } ;;
      a|A)  $need_restart && { _maybe_restart_for_changes; need_restart=false; } ;;
      *)
        if [[ "$r" =~ ^[1-9][0-9]*$ && "$r" -le "${#row_prov[@]}" ]]; then
          local k="${row_kind[$((r-1))]}" p="${row_prov[$((r-1))]}"
          case "$k" in
            container) cap_action_container "$cap" "$p" && need_restart=true ;;
            cloud)     cap_action_cloud     "$cap" "$p" ;;
            builtin)   cap_action_builtin   "$cap" "$p" ;;
          esac
        else
          warn "Invalid."; pause
        fi
        ;;
    esac
  done
}

# Storage: exclusive (one provider per deployment). Switching guards against
# silent data loss — uploaded files don't migrate automatically.
cap_menu_storage() {
  local cap=storage
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}File storage${NC}  ${DIM}uploads, dataset blobs, exports${NC}"
    local cur; cur="$(yget deployment.storage.use)"
    printf "  current provider: ${BOLD}%s${NC}\n" "${cur:-<unset>}"
    say "  ${DIM}Storage is one-at-a-time — all assets live in the active provider.${NC}"
    say "  ${DIM}Switching does not move existing files.${NC}"
    echo

    local -a opts_prov=()
    local i=0 prov mark
    for prov in $(providers_for_cap "$cap"); do
      i=$((i+1))
      opts_prov+=("$prov")
      if [[ "$cur" == "$prov" ]]; then mark="${GREEN}● active${NC}"
      else mark="${DIM}○${NC}"; fi
      printf "  ${GREEN}%d${NC} %b  %-22s ${DIM}%s${NC}\n" "$i" "$mark" "$(prov_field "$cap" "$prov" label)" "$(prov_field "$cap" "$prov" notes)"
    done

    echo
    say "  ${GREEN}p${NC}  Change local_fs host path  ${DIM}(where files live on disk)${NC}"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r

    case "$r" in
      0|"") return 0 ;;
      p|P)  prompt_yset deployment.storage.user_uploads.host_path "Local storage host path (default ./.store/local_fs)"; pause ;;
      *)
        if [[ "$r" =~ ^[1-9][0-9]*$ && "$r" -le "${#opts_prov[@]}" ]]; then
          local new="${opts_prov[$((r-1))]}"
          if [[ "$new" == "$cur" ]]; then
            warn "Already on $new."; pause
          else
            storage_switch_safe "$cur" "$new" || true
          fi
        else
          warn "Invalid."; pause
        fi
        ;;
    esac
  done
}

# Single-provider capability (scraping today) — informational, no choices.
cap_menu_single() {  # CAP
  local cap="$1" cap_label_v cap_desc_v prov
  cap_label_v="$(cap_field "$cap" label)"
  cap_desc_v="$(cap_field "$cap" desc)"
  prov="$(providers_for_cap "$cap" | head -1)"

  clear 2>/dev/null || true
  say "${GREEN}${cap_label_v}${NC}  ${DIM}${cap_desc_v}${NC}"
  echo
  say "  Provider: ${BOLD}$(prov_field "$cap" "$prov" label)${NC}  ${DIM}($(prov_field "$cap" "$prov" notes))${NC}"
  echo
  say "  ${DIM}No setup required — built into the backend.${NC}"
  echo
  pause
}

# ── Per-capability actions ────────────────────────────────────────────────────

# Toggle a local-container provider on or off for a capability. Returns true
# on a state change (caller should arm the restart prompt).
cap_action_container() {  # CAP PROVIDER  → 0 if changed, 1 otherwise
  local cap="$1" prov="$2" label
  label="$(prov_field "$cap" "$prov" label)"
  if provider_active "$cap" "$prov"; then
    confirm "Turn $label off for $(cap_field "$cap" label)?" || return 1
    backup_env
    provider_disable "$cap" "$prov"
    ok "$label disabled for $(cap_field "$cap" label)."
    pause; return 0
  else
    if [[ "$prov" == "local" && "$cap" == "geocoding" ]]; then
      warn "Heads up: local Nominatim downloads ~5GB OSM data and takes ~2h on first start."
    fi
    confirm "Enable $label for $(cap_field "$cap" label)?" || return 1
    backup_env
    provider_enable "$cap" "$prov"
    ok "$label enabled for $(cap_field "$cap" label)."
    if [[ "$prov" == "ollama" ]]; then
      say "${DIM}  After restart, pull a model from this menu's 'm' option.${NC}"
    fi
    pause; return 0
  fi
}

# Cloud provider actions: set/change key, sharing, clear.
cap_action_cloud() {  # CAP PROVIDER
  local cap="$1" prov="$2" label kenv
  label="$(prov_field "$cap" "$prov" label)"
  kenv="$(prov_field "$cap" "$prov" key_env)"

  clear 2>/dev/null || true
  say "${GREEN}${label}${NC}  ${DIM}cloud provider for $(cap_field "$cap" label)${NC}"
  if [[ -n "$kenv" ]]; then
    printf "  current key: %s\n" "$(mask "$(get_env "$kenv")")"
  else
    say "  ${DIM}no API key needed — keyless public endpoint${NC}"
  fi
  printf "  shared with: %b\n" "$(grant_pretty "$(prov_grant "$cap" "$prov")")"
  echo

  local actions_label="" set_clear_visible=false
  if [[ -n "$kenv" ]]; then
    set_clear_visible=true
    say "  ${GREEN}1${NC}  Set / change API key"
    say "  ${GREEN}2${NC}  Change sharing  ${DIM}(who on this HQ can use the deployment key)${NC}"
    say "  ${GREEN}3${NC}  Clear API key"
  else
    say "  ${GREEN}2${NC}  Change sharing  ${DIM}(or block this provider entirely)${NC}"
  fi
  say "  ${GREEN}0${NC}  Back"
  pick_menu r

  case "$r" in
    1) $set_clear_visible && { backup_env; prompt_set_password "$kenv" "${label} API key"; pause; } ;;
    2) cap_set_sharing "$cap" "$prov"; pause ;;
    3) $set_clear_visible && { if confirm "Clear $label key?"; then backup_env; set_env "$kenv" ""; ok "Cleared."; fi; pause; } ;;
    0|"") return 0 ;;
    *) warn "Invalid."; pause ;;
  esac
}

# Built-in actions: usually nothing to configure. For OCR (where multiple
# built-ins compete with containerized alternatives) offer to make this the
# default explicitly.
cap_action_builtin() {  # CAP PROVIDER
  local cap="$1" prov="$2" label
  label="$(prov_field "$cap" "$prov" label)"

  clear 2>/dev/null || true
  say "${GREEN}${label}${NC}  ${DIM}built-in for $(cap_field "$cap" label)${NC}"
  say "  ${DIM}$(prov_field "$cap" "$prov" notes)${NC}"
  echo

  if cap_has_default "$cap"; then
    local cur; cur="$(cap_default "$cap")"
    if [[ "$cur" == "$prov" ]]; then
      ok "Already the default for this capability."
    elif confirm "Make $label the default for $(cap_field "$cap" label)?"; then
      backup_env; cap_set_default "$cap" "$prov"; render_env
      ok "Default set to $label."
    fi
  else
    say "  ${DIM}Always available — no toggle needed.${NC}"
  fi
  pause
}

# Sharing — wraps the existing explainer + level picker for one specific
# (capability, provider) pair so the user doesn't have to fuzzy-pick a row.
cap_set_sharing() {  # CAP PROVIDER
  local cap="$1" prov="$2" label
  label="$(prov_field "$cap" "$prov" label)"

  clear 2>/dev/null || true
  sharing_explainer
  say "  ${BOLD}Sharing level for ${label} (${cap}):${NC}"
  local level
  level="$(printf '%s\n' \
    "Everyone     — any signed-in user" \
    "Admins only  — superusers" \
    "Blocked      — no one on this HQ can use this provider" \
    "Bring your own — usable, but our key is never handed over" \
    | fzf_pick "Level:" "What level should the deployment-level key be shared at?")" || return 0
  [[ -z "$level" ]] && return 0
  local val
  case "$level" in
    Everyone*)    val=all ;;
    Admins*)      val=superuser ;;
    Blocked*)     val=none ;;
    # Was an empty value, which now means the opposite: an unlisted keyed
    # provider is denied, so "users bring their own" has to say so.
    Bring*)       val=byok ;;
    *)            return 0 ;;
  esac
  backup_env; prov_set_grant "$cap" "$prov" "$val"; render_env
  ok "  ${label} → $(grant_pretty "$val")"
}

# ── Safe storage switch ───────────────────────────────────────────────────────
# Storage providers don't migrate data automatically. Switching while there
# are uploaded files means HQ loses access to them (they still live on disk
# but the backend points elsewhere). Warn explicitly + opt-in.

storage_data_summary() {  # PROVIDER  → echoes a one-line description of existing data, or empty
  case "$1" in
    local_fs)
      local path; path="$(get_env LOCAL_STORAGE_HOST_PATH)"
      path="${path:-./.store/local_fs}"
      [[ -d "$path" ]] || { echo ""; return; }
      local n; n="$(find "$path" -type f 2>/dev/null | wc -l | tr -d ' ')"
      [[ "$n" -gt 0 ]] && echo "$n file(s) under $path"
      ;;
    s3)
      # Objects live inside garage's own store, not as browsable files, so
      # there is no count to give — only whether a node has data at all.
      [[ -d ./.store/garage ]] || { echo ""; return; }
      local n; n="$(du -sh ./.store/garage 2>/dev/null | cut -f1)"
      [[ -n "$n" ]] && echo "$n in ./.store/garage (garage store)"
      ;;
  esac
}

storage_switch_safe() {  # OLD_PROVIDER NEW_PROVIDER
  local old="$1" new="$2"
  clear 2>/dev/null || true
  say "${BOLD}Switch file storage:${NC}  ${old:-<none>}  →  ${new}"
  echo

  local old_data; old_data="$(storage_data_summary "$old")"
  if [[ -n "$old_data" ]]; then
    say "${YELLOW}┌─ Heads up ──────────────────────────────────────────────────────────${NC}"
    say "${YELLOW}│${NC}  ${old_data} are currently stored under ${BOLD}${old}${NC}."
    say "${YELLOW}│${NC}  Switching to ${BOLD}${new}${NC} won't move them — they stay on disk but"
    say "${YELLOW}│${NC}  the backend will look at the new provider, so existing asset URLs"
    say "${YELLOW}│${NC}  will not resolve. You can switch back any time to access them again."
    say "${YELLOW}└─────────────────────────────────────────────────────────────────────${NC}"
    echo
  fi

  case "$new" in
    local_fs)
      say "  Files will live under ${BOLD}$(get_env LOCAL_STORAGE_HOST_PATH || echo './.store/local_fs')${NC}." ;;
    s3)
      if yon foundation.run.garage; then
        say "  Garage runs as a container, its store under ${BOLD}./.store/garage${NC}."
      else
        say "  Point ${BOLD}deployment.services.s3${NC} at your bucket, keys go in .env."
      fi ;;
  esac
  echo
  confirm "Switch storage to ${new}?" || { warn "Cancelled."; pause; return 1; }

  backup_env
  # First: stop and remove the OLD provider's container if it had one. Doing
  # this BEFORE switching the env vars means the running container still sees
  # consistent credentials during shutdown.
  if [[ "$old" == "s3" ]] && profile_active garage; then
    say "${DIM}stopping garage container…${NC}"
    if docker_ok; then
      local c; c="$(compose_cmd)"
      $c stop garage  >/dev/null 2>&1 || true
      $c rm -f garage >/dev/null 2>&1 || true
    fi
    remove_profile_persist garage
  fi

  # Now flip to the new provider via the canonical helper.
  provider_enable storage "$new"
  yset deployment.storage.use "$new"     # provider_enable only sets when unset

  # New provider-specific follow-ups.
  case "$new" in
    s3)
      prompt_yset deployment.services.s3.bucket "S3 bucket"
      prompt_yset deployment.services.s3.region "Region"
      prompt_set S3_ACCESS_KEY_ID "Access key id"
      prompt_set_password S3_SECRET_ACCESS_KEY "Secret access key" ;;
  esac

  ok "Storage = $new"
  if docker_ok && stack_is_running; then
    confirm_y "Restart stack to apply?" && { ( stack_restart ) || warn "Restart failed."; }
  fi
  pause
}

# ── Ollama model pull ─────────────────────────────────────────────────────────
# Common follow-up after enabling Ollama. Offers a curated list per capability
# plus a free-form prompt for advanced users.

cap_ollama_pull_prompt() {  # CAP
  local cap="$1"
  clear 2>/dev/null || true
  say "${GREEN}Ollama models${NC}  ${DIM}pulled into the local container${NC}"
  echo

  if ! profile_active ollama; then
    warn "Ollama isn't enabled. Turn it on first."; return
  fi
  if ! docker_ok; then
    warn "Docker isn't reachable. Start the stack first."; return
  fi

  local c; c="$(compose_cmd)"
  if $c ps ollama 2>/dev/null | grep -q "Up"; then
    say "  Already pulled:"
    $c exec -T ollama ollama list 2>/dev/null | sed 's/^/    /' || say "    ${DIM}(could not list — Ollama may still be starting)${NC}"
    echo
  else
    warn "Ollama container isn't running yet. Start / restart the stack and try again."
    return
  fi

  # Per-capability curated picks. Names are valid Ollama tags as of 2026.
  local -a picks=()
  case "$cap" in
    language)
      picks=(
        "llama3.1:8b           general LLM, ~5GB"
        "qwen2.5:7b            strong tool use, ~5GB"
        "gemma2:2b             small/fast, ~2GB"
        "phi3.5:3.8b           small, agentic, ~2.5GB"
      ) ;;
    embedding)
      picks=(
        "nomic-embed-text      general purpose, 274MB"
        "mxbai-embed-large     high quality, 670MB"
        "snowflake-arctic-embed  strong retrieval, 670MB"
      ) ;;
    ocr)
      picks=(
        "llava:7b              vision LLM for OCR, ~5GB"
        "llava:13b             higher quality OCR, ~8GB"
        "bakllava:7b           alternative vision LLM, ~5GB"
      ) ;;
  esac

  if (( ${#picks[@]} > 0 )); then
    say "  Suggested models:"
    local i=0 line
    for line in "${picks[@]}"; do
      i=$((i+1))
      printf "    ${GREEN}%d${NC}  %s\n" "$i" "$line"
    done
    echo
  fi
  say "  ${GREEN}c${NC}  Custom — type any Ollama tag"
  say "  ${GREEN}0${NC}  Back"
  pick_menu r

  local target=""
  if [[ "$r" =~ ^[1-9][0-9]*$ && "$r" -le "${#picks[@]}" ]]; then
    target="${picks[$((r-1))]%% *}"
  elif [[ "$r" == "c" || "$r" == "C" ]]; then
    read -rp "  Model tag (e.g. llama3.1:8b): " target
  else
    return 0
  fi
  [[ -z "$target" ]] && return 0

  say "${DIM}pulling $target — this can take a while…${NC}"
  if $c exec -T ollama ollama pull "$target"; then
    ok "$target ready."
  else
    warn "Pull failed. Check the model name and your internet connection."
  fi
}

# Helper used by cap_menu_multi when an action set need_restart=true.
_maybe_restart_for_changes() {
  if docker_ok && stack_is_running; then
    confirm_y "Apply changes — restart stack now?" && { ( stack_restart ) || warn "Restart failed."; }
  fi
}

# ── Identity ──────────────────────────────────────────────────────────────────

identity_menu() {
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Superuser${NC}"
    say "  current email: $(get_env FIRST_SUPERUSER)"
    echo
    say "  ${GREEN}1${NC}  Change superuser email"
    say "  ${GREEN}2${NC}  Change superuser password"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) change_superuser_email; pause ;;
      2) change_superuser_password; pause ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
}

change_superuser_email() {
  local cur new c; cur="$(get_env FIRST_SUPERUSER)"; c="$(compose_cmd)"
  read -rp "  New superuser email [${cur}]: " new
  [[ -z "$new" || "$new" == "$cur" ]] && { warn "  no change"; return; }
  if backend_running; then
    if $c exec -T backend python -m app.cli.set_superuser --identify "$cur" --email "$new"; then
      backup_env; set_env FIRST_SUPERUSER "$new"; ok "  email updated in DB and .env."
    else
      warn "  DB update failed; .env left unchanged."
    fi
  else
    backup_env; set_env FIRST_SUPERUSER "$new"
    warn "  Backend not running — .env updated. The change takes effect on first init only; for an existing user, start backend and re-run."
  fi
}

change_superuser_password() {
  local pw email c; email="$(get_env FIRST_SUPERUSER)"; c="$(compose_cmd)"
  read -rsp "  New password (hidden): " pw; echo
  [[ -z "$pw" ]] && { warn "  no change"; return; }
  backup_env; set_env FIRST_SUPERUSER_PASSWORD "$pw"
  if backend_running; then
    if $c exec -T backend python -m app.cli.set_superuser --identify "$email" --password "$pw"; then
      ok "  password updated in DB and .env."
    else
      warn "  DB update failed (user may not exist yet); .env updated for next init."
    fi
  else
    warn "  Backend not running — .env updated. If user already exists, start backend and re-run."
  fi
}

# ── Email ─────────────────────────────────────────────────────────────────────

email_menu() {
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Email${NC}"
    printf "  smtp:      %s\n" "$(email_status)"
    printf "  tls=%s   ssl=%s\n" "$(bool_show "$(yget deployment.email.tls)")" "$(bool_show "$(yget deployment.email.ssl)")"
    printf "  from:      %s <%s>\n" "$(yget deployment.email.from_name)" "$(yget deployment.email.from_email)"
    printf "  verify:    %s\n" "$(bool_show "$(yget deployment.users.require_email_verification)")"
    printf "  open reg:  %s\n" "$(bool_show "$(yget deployment.users.open_registration)")"
    echo
    say "  ${GREEN}1${NC}  Configure SMTP (host, port, user, password, tls/ssl)"
    say "  ${GREEN}2${NC}  From name & address"
    say "  ${GREEN}3${NC}  Toggle 'require email verification'"
    say "  ${GREEN}4${NC}  Toggle 'open user registration'"
    say "  ${GREEN}5${NC}  Clear all SMTP settings"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) configure_smtp ;;
      2) backup_env
         prompt_yset deployment.email.from_name  "Sender name (e.g. \"Open Politics\")"
         prompt_yset deployment.email.from_email "Sender email"
         confirm "Restart backend?" && { docker_ok && ( $(compose_cmd) restart backend ) || warn "Skipped."; }
         pause ;;
      3) toggle_bool deployment.users.require_email_verification ;;
      4) toggle_bool deployment.users.open_registration ;;
      5) if confirm "Clear all SMTP settings?"; then
           backup_env
           local k
           for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_TLS SMTP_SSL EMAILS_FROM_EMAIL EMAILS_FROM_NAME; do
             set_env "$k" ""
           done
           ok "Cleared."
         fi
         pause ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
}

configure_smtp() {
  backup_env
  prompt_yset deployment.email.host "SMTP host (e.g. smtp.protonmail.ch)"
  prompt_yset deployment.email.port "SMTP port (587 STARTTLS / 465 SSL)"
  prompt_yset deployment.email.user "SMTP user"
  prompt_set_password SMTP_PASSWORD "SMTP password"
  local r
  read -rp "  Use STARTTLS (TLS)? [Y/n] " r; [[ "${r:-Y}" =~ ^[Yy]$ ]] && yset deployment.email.tls true || yset deployment.email.tls false
  read -rp "  Use SSL (port 465)? [y/N] " r; [[ "$r" =~ ^[Yy]$ ]] && yset deployment.email.ssl true || yset deployment.email.ssl false
  ok "SMTP configured."
  confirm "Restart backend to apply?" && { docker_ok && ( $(compose_cmd) restart backend ) || warn "Skipped."; }
  pause
}

# ── Sharing primitives (used by the capability sub-menus) ─────────────────────

grant_pretty() {  # grant_pretty VALUE  -> human-readable label
  case "${1:-}" in
    all)       echo "everyone" ;;
    superuser) echo "admins only" ;;
    none)      echo "${RED}blocked${NC}" ;;
    "")        echo "${DIM}not shared (users bring own)${NC}" ;;
    *)         echo "$1" ;;
  esac
}

# Boxed explainer printed once when opening the sharing prompt — telling the
# user what an access grant actually does, in plain language.
sharing_explainer() {
  say "${BLUE}┌─ About sharing ─────────────────────────────────────────────────────${NC}"
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}  By default, the API keys you set here are ${BOLD}not${NC} shared with users."
  say "${BLUE}│${NC}  Anyone wanting to use OpenAI, Anthropic, etc. must put in their"
  say "${BLUE}│${NC}  own key from their profile."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}  Sharing lets users on this HQ use ${BOLD}this deployment's${NC} key as if"
  say "${BLUE}│${NC}  it were theirs — useful when you've paid for the API and want"
  say "${BLUE}│${NC}  your team to share that budget."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    ${BOLD}everyone${NC}     any signed-in user can use the deployment's key"
  say "${BLUE}│${NC}    ${BOLD}admins only${NC}  only HQ admins (superusers) can use it"
  say "${BLUE}│${NC}    ${BOLD}blocked${NC}      ${RED}block this provider entirely${NC} (even users with"
  say "${BLUE}│${NC}                 their own key cannot use it on this HQ)"
  say "${BLUE}│${NC}    ${BOLD}not shared${NC}   default — users bring their own key"
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}  Users with their own stored key always use their own; sharing"
  say "${BLUE}│${NC}  only governs the deployment-level key."
  say "${BLUE}└─────────────────────────────────────────────────────────────────────${NC}"
  echo
}

# ── Workers / Domain / Reconfigure ────────────────────────────────────────────

workers_prompt() {
  clear 2>/dev/null || true
  say "${GREEN}Workers${NC}"
  printf "  current:  backend=%s  celery=%s\n\n" "$(get_env BACKEND_WORKERS)" "$(get_env CELERY_CONCURRENCY)"
  if is_dev_mode; then
    warn "  In dev mode, the backend runs as a single uvicorn process via start-reload.sh."
    warn "  BACKEND_WORKERS only takes effect under ENVIRONMENT=production."
  fi
  prompt_yset deployment.services.backend.workers "Backend uvicorn workers (number, or auto)"
  prompt_yset deployment.services.celery.workers  "Celery prefork concurrency (number, or auto)"
  if confirm "Restart stack to apply?"; then
    docker_ok && ( stack_restart ) || warn "Restart skipped."
  fi
  pause
}

domain_prompt() {
  clear 2>/dev/null || true
  say "${GREEN}Domain${NC}"
  printf "  current:  %s\n\n" "$(get_env DOMAIN)"
  prompt_yset deployment.network.domain "Domain (e.g. open-politics.org or localhost)"
  if profile_active caddy; then
    warn "  Caddy is active — restart to pick up the new domain."
    confirm "Restart caddy now?" && { docker_ok && ( $(compose_cmd) up -d --force-recreate --no-deps caddy ) || warn "Skipped."; }
  fi
  pause
}

# ── Settings ──────────────────────────────────────────────────────────────────

settings_menu() {
  [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || { warn "Run setup first."; pause; return; }
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Settings${NC}"
    printf "  superuser:  %s\n" "$(get_env FIRST_SUPERUSER)"
    printf "  email:      %s\n" "$(email_status)"
    printf "  storage:    %s\n" "$(storage_status)"
    printf "  workers:    backend=%s  celery=%s\n" "$(get_env BACKEND_WORKERS)" "$(get_env CELERY_CONCURRENCY)"
    printf "  domain:     %s\n" "$(get_env DOMAIN)"
    printf "  network:    %s\n" "$(active_network_mode)"
    echo
    say "  ${GREEN}1${NC}  Superuser            ${DIM}email and password${NC}"
    say "  ${GREEN}2${NC}  Email                ${DIM}SMTP, from address, verification, open registration${NC}"
    say "  ${GREEN}3${NC}  Storage              ${DIM}provider and local_fs path${NC}"
    say "  ${GREEN}4${NC}  Workers              ${DIM}backend and celery counts${NC}"
    say "  ${GREEN}5${NC}  Domain"
    say "  ${GREEN}6${NC}  Network mode         ${DIM}host (default) ↔ bridge (cross-platform)${NC}"
    say "  ${GREEN}7${NC}  Re-run setup wizard"
    say "  ${GREEN}8${NC}  Edit any single .env value"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) identity_menu ;;
      2) email_menu ;;
      3) cap_menu_storage ;;
      4) workers_prompt ;;
      5) domain_prompt ;;
      6) network_mode_menu ;;
      7) ( PROFILES=""; QUEUED_GRANTS=""; QUEUED_DEFAULTS=""; FMODE="dev"; DOMAIN_OPT=""; ACME_EMAIL_OPT=""; \
           SU_EMAIL_OPT=""; SU_PASSWORD_OPT=""; REACH=local; NETWORK_MODE=host; \
           MODE_SET=false; REACH_SET=false; NET_SET=false; SERVICES_SET=false; STORAGE_SET=false; USER_SET=false; \
           LANG_LOCAL=false; EMB_LOCAL=false; do_init ) || warn "Wizard did not complete."; pause ;;
      8) edit_value ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
}

network_mode_menu() {
  local cur; cur="$(active_network_mode)"
  clear 2>/dev/null || true
  say "${GREEN}Network mode${NC}"
  printf "  current:  ${BOLD}%s${NC}\n\n" "$cur"
  say "  ${BOLD}bridge${NC}   ${DIM}(the opt-out — cross-platform)${NC}"
  say "           Standard docker network. Frontend on 127.0.0.1:3000, every"
  say "           other service docker-internal. Nothing exposed to the network."
  say
  say "  ${BOLD}host${NC}     ${DIM}(default — no port mappings)${NC}"
  say "           Containers share the host network namespace; every service"
  say "           binds 127.0.0.1 on the host directly. No \`ports:\` mappings"
  say "           anywhere, so accidental exposure is structurally impossible."
  say "           Mac/Windows require Docker Desktop's host networking feature"
  say "           (Settings → Resources → Network)."
  say
  local target; read -rp "  Switch to [bridge/host], or empty to cancel: " target
  target="$(echo "$target" | tr '[:upper:]' '[:lower:]')"
  case "$target" in
    bridge)
      [[ "$cur" == bridge ]] && { say "Already bridge."; pause; return; }
      NETWORK_MODE=bridge
      backup_env
      yset deployment.network.mode bridge
      rm -f "$HOST_NET_FRAGMENT"
      yon foundation.run.garage && write_garage_config
      render_env
      ok "Switched to bridge."
      # Network topology change — needs down + up, not restart. Down releases
      # the old ports so the up's port precheck sees the real free/busy state.
      # stack_down/stack_up each pause internally when alt-screen is active.
      if confirm "Apply now? (stops + restarts the stack)"; then
        ( stack_down ) || warn "Stop failed."
        ( stack_up )   || warn "Start failed."
      else
        pause   # let user see the "Switched to bridge" line
      fi ;;
    host)
      [[ "$cur" == host ]] && { say "Already host."; pause; return; }
      NETWORK_MODE=host
      backup_env
      yset deployment.network.mode host
      write_host_net_fragment
      yon foundation.run.garage && write_garage_config
      render_env
      ok "Switched to host (hardened)."
      warn "Mac/Windows: enable Docker Desktop's host networking feature first."
      if confirm "Apply now? (stops + restarts the stack)"; then
        ( stack_down ) || warn "Stop failed."
        ( stack_up )   || warn "Start failed."
      else
        pause
      fi ;;
    "") return 0 ;;
    *) warn "Invalid choice."; pause ;;
  esac
}

# ── Rotate submenu ────────────────────────────────────────────────────────────

rotate_menu() {
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Rotate passwords & keys${NC}  ${DIM}(.env backed up; data volumes preserved)${NC}"
    say "  ${GREEN}1${NC}  Encryption key (Fernet)   ${DIM}re-encrypts all stored credentials${NC}"
    say "  ${GREEN}2${NC}  Postgres password"
    say "  ${GREEN}3${NC}  S3 / garage secret"
    say "  ${GREEN}4${NC}  Redis password"
    say "  ${GREEN}5${NC}  JWT SECRET_KEY            ${DIM}(forces re-login)${NC}"
    say "  ${GREEN}6${NC}  ALL of the above"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) confirm "Rotate the encryption key now?"        && { ( rotate_fernet )      || warn "Rotation aborted."; } ;;
      2) confirm "Rotate the Postgres password now?"     && { ( rotate_postgres )    || warn "Rotation aborted."; } ;;
      3) confirm "Rotate the S3 secret now?"             && { ( rotate_s3 )         || warn "Rotation aborted."; } ;;
      4) confirm "Rotate the Redis password now?"        && { ( rotate_redis )       || warn "Rotation aborted."; } ;;
      5) confirm "Rotate SECRET_KEY (logs everyone out)?" && { ( rotate_secret_key ) || warn "Rotation aborted."; } ;;
      6) confirm "Rotate ALL secrets now?"               && { ( rotate_postgres; rotate_s3; rotate_redis; rotate_secret_key; rotate_fernet ) || warn "Rotation aborted."; } ;;
      0|"") return 0 ;;
      *) warn "Invalid." ;;
    esac
    pause
  done
}

# ── Publish to a public domain ────────────────────────────────────────────────

detect_public_ip() {
  curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null \
    || curl -fsS --max-time 3 https://ifconfig.me 2>/dev/null \
    || echo "(could not detect)"
}

deploy_wizard() {
  [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || { warn "Run setup first — $CONF_FILE and .env must exist."; pause; return; }
  clear 2>/dev/null || true
  say "${BLUE}┌─ Publish to a public domain ────────────────────────────────────────${NC}"
  say "${BLUE}│${NC}  Switches HQ to production mode and adds Caddy in front for HTTPS."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}  • ENVIRONMENT becomes ${BOLD}production${NC} (real images + commands)"
  say "${BLUE}│${NC}  • Caddy listens on 80/443 and proxies to backend + frontend"
  say "${BLUE}│${NC}  • Caddy obtains a Let's Encrypt cert automatically"
  say "${BLUE}│${NC}"
  local pubip; pubip="$(detect_public_ip)"
  say "${BLUE}│${NC}  Detected public IP:  ${GREEN}${pubip}${NC}"
  say "${BLUE}│${NC}  Set a DNS A-record:  ${BOLD}<your-domain>${NC}  →  ${pubip}"
  say "${BLUE}└─────────────────────────────────────────────────────────────────────${NC}"
  echo
  confirm_y "Continue?" || { warn "Cancelled."; pause; return; }

  local domain acme
  while true; do
    read -rp "  Domain (e.g. hq.open-politics.org): " domain
    [[ "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && break
    warn "  That doesn't look like a domain."
  done
  while true; do
    read -rp "  ACME contact email (required by the certificate authority): " acme
    [[ "$acme" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]] && break
    warn "  Caddy will not start without a valid contact address."
  done

  warn "  Make sure A-record for ${BOLD}${domain}${NC} points to ${BOLD}${pubip}${NC}."
  warn "  Caddy will fail to obtain a certificate if DNS hasn't propagated."
  confirm_y "DNS is set and you're ready?" || { warn "Cancelled — re-run when DNS is ready."; pause; return; }

  backup_env
  yset deployment.network.domain "$domain"
  yset deployment.network.acme_email "$acme"
  yset deployment.network.reach public
  yset stack.environment production
  # Storage is deliberately NOT changed here. Switching local_fs -> s3 as a side
  # effect of adding TLS orphans every upload the deployment already has; that
  # move belongs to the storage menu, which knows how to migrate.
  local _store; _store="$(yget deployment.storage.use)"
  say "  ${DIM}storage stays ${_store} — change it under Foundation → File storage.${NC}"
  local cors; cors="$(yget deployment.network.cors.origins)"
  if [[ ",$cors," != *",https://$domain,"* ]]; then
    yset_list deployment.network.cors.origins "${cors:+$cors,}https://$domain"
  fi
  check_network_coherence
  do_render
  ok "  $CONF_FILE updated: production + caddy."

  FMODE="prod"
  if confirm_y "Bring the stack up now (this builds prod images)?"; then
    ( stack_up ) || { warn "Bring-up failed. Inspect: $(compose_cmd) logs caddy"; pause; return; }
    say
    ok "Deployed. https://${domain} should respond once Caddy obtains the certificate (usually <60s)."
    say "${DIM}If certs fail, check: $(compose_cmd) logs caddy${NC}"
  fi
  pause
}

# ── Dashboard menu (the centerpiece) ──────────────────────────────────────────

primary_action_label() {
  if [[ ! -f "$ENV_FILE" ]]; then echo "Start fresh setup"
  elif ! stack_is_running && stack_has_any_container; then echo "View logs (a container is failing)"
  elif ! stack_is_running; then echo "Start HQ"
  else echo "Open HQ in your browser"; fi
}

suggested_action() {
  if [[ ! -f "$ENV_FILE" ]]; then echo 1; return; fi
  if has_drift; then echo 7; return; fi
  if [[ -n "$(placeholder_secrets)" ]]; then echo 6; return; fi
  # Degraded stack → logs (option 4), not Start (running `up` won't fix
  # a restart-looping container that's failing for a config reason).
  if ! stack_is_running && stack_has_any_container; then echo 4; return; fi
  if ! stack_is_running; then echo 1; return; fi
  echo ""
}

dashed() { say "    ${DIM}─────${NC}"; }
sug_marker() { local self="$1" cur="$2"; [[ "$self" == "$cur" ]] && echo "  ${YELLOW}← suggested${NC}" || echo ""; }

draw_menu() {
  local sug primary running_now
  sug="$(suggested_action)"
  running_now=false; stack_is_running && running_now=true
  primary="$(primary_action_label)"

  say "  ${BOLD}What do you want to do?${NC}"
  say "    ${GREEN}1${NC}  ${primary}$(sug_marker 1 "$sug")"
  if $running_now; then
    say "    ${GREEN}2${NC}  Restart / refresh"
    say "    ${GREEN}3${NC}  Stop everything                ${DIM}(data is kept)${NC}"
    say "    ${GREEN}4${NC}  Live logs                      ${DIM}(Ctrl-C to return)${NC}"
  else
    say "    ${DIM}2  Restart                        (HQ is stopped — pick 1 to start)${NC}"
    say "    ${DIM}3  Stop                           (already stopped)${NC}"
    say "    ${DIM}4  Live logs                      (HQ is stopped)${NC}"
  fi
  dashed
  say "    ${GREEN}5${NC}  Foundation service providers   ${DIM}chat · embeddings · storage · search · geocoding · OCR${NC}"
  say "    ${GREEN}6${NC}  Settings                       ${DIM}superuser · email · storage · workers · domain${NC}$(sug_marker 6 "$sug")"
  if has_drift; then
    say "    ${GREEN}7${NC}  Sync services                  ${DIM}reconcile saved config with what's running${NC}$(sug_marker 7 "$sug")"
  fi
  dashed
  say "    ${GREEN}8${NC}  Publish to a public domain     ${DIM}VPS launcher · Caddy · auto-TLS${NC}"
  say "    ${GREEN}9${NC}  Rotate passwords & keys"
}

draw_footer() {
  echo
  printf "  ${DIM}[q] quit   [?] help${NC}\n"
}

show_help_overlay() {
  cursor_home; clear_below
  say "${GREEN}╭─ Keyboard reference ────────────────────────────────────────────────────╮${NC}"
  say "${GREEN}│${NC}"
  say "${GREEN}│${NC}  ${BOLD}Navigation${NC}"
  say "${GREEN}│${NC}    ${GREEN}1${NC}–${GREEN}9${NC}      Pick the corresponding menu item"
  say "${GREEN}│${NC}    ${GREEN}r${NC}        Refresh state now"
  say "${GREEN}│${NC}    ${GREEN}?${NC}        Show this help"
  say "${GREEN}│${NC}    ${GREEN}q${NC}        Quit and restore your shell"
  say "${GREEN}│${NC}"
  say "${GREEN}│${NC}  ${BOLD}About the dashboard${NC}"
  say "${GREEN}│${NC}    The state at the top updates by itself — you don't need to refresh."
  say "${GREEN}│${NC}    Suggested next action gets a ${YELLOW}← suggested${NC} marker."
  say "${GREEN}│${NC}    Drift between saved config and what's actually running is${NC}"
  say "${GREEN}│${NC}    flagged with ${YELLOW}⚠${NC} on the affected feature line.${NC}"
  say "${GREEN}│${NC}"
  if $HAS_FZF; then
    say "${GREEN}│${NC}  ${DIM}fzf detected — pickers will support fuzzy search.${NC}"
  else
    say "${GREEN}│${NC}  ${DIM}Install fzf for fuzzy-search pickers (optional).${NC}"
  fi
  say "${GREEN}╰─────────────────────────────────────────────────────────────────────────╯${NC}"
  echo
  printf "  ${DIM}— press any key to return —${NC}"
  local _; pick_key _
}

dashboard() {
  # Non-interactive (CI / piped): print state once and return.
  if ! $INTERACTIVE_TTY; then
    prime_ps_cache
    print_state
    draw_menu
    echo
    say "${DIM}(non-interactive shell — run from a terminal for the live dashboard)${NC}"
    invalidate_ps_cache
    return
  fi

  enter_alt_screen

  local key running_now
  while true; do
    # One docker call per iteration; print_state, draw_menu, and the helpers
    # all read from this cache instead of re-querying the daemon.
    prime_ps_cache

    print_state
    draw_menu
    draw_footer
    clear_below
    TUI_TICK=$((TUI_TICK + 1))
    running_now=false; stack_is_running && running_now=true

    key=""
    pick_key key "$TUI_REFRESH_SECONDS" || true   # `|| true` because timeout returns nonzero
    # Actions may mutate state; let them see live data, not a stale cache.
    invalidate_ps_cache

    case "$key" in
      q|$'\033') break ;;                                         # q or Esc
      r|"")       continue ;;                                     # explicit refresh OR timeout tick
      "?")        show_help_overlay ;;
      1) if [[ ! -f "$ENV_FILE" ]]; then
           leave_alt_screen
           ( PROFILES=""; QUEUED_GRANTS=""; QUEUED_DEFAULTS=""; FMODE="dev"; DOMAIN_OPT=""; ACME_EMAIL_OPT=""; \
             SU_EMAIL_OPT=""; SU_PASSWORD_OPT=""; REACH=local; NETWORK_MODE=host; \
             MODE_SET=false; REACH_SET=false; NET_SET=false; SERVICES_SET=false; STORAGE_SET=false; USER_SET=false; \
             LANG_LOCAL=false; EMB_LOCAL=false; do_init ) || warn "Setup did not complete."
           pause
           enter_alt_screen
         elif ! $running_now && stack_has_any_container; then
           # Degraded: go straight to logs so user sees what's failing.
           leave_alt_screen; stack_logs; enter_alt_screen
         elif ! $running_now; then
           ( stack_up ) || warn "Start failed."
         else
           open_browser
         fi
         ;;
      2) if $running_now; then ( stack_restart ) || warn "Restart failed."; fi ;;
      3) if $running_now; then ( stack_down ) || warn "Stop failed."; fi ;;
      4) if $running_now; then leave_alt_screen; stack_logs; enter_alt_screen; fi ;;
      5) foundation_menu ;;
      6) settings_menu ;;
      7) if has_drift; then sync_features; fi ;;
      8) deploy_wizard ;;
      9) if [[ -f "$ENV_FILE" ]]; then rotate_menu; fi ;;
    esac
  done

  leave_alt_screen
  say "Bye."
}

# ── audit ─────────────────────────────────────────────────────────────────────
# Read-only. Prints what IS beside what was promised, and exits 1 on any
# difference. Names, modes, ports and bind addresses only — never a value, not
# even a masked one: mask() shows a secret's first three and last two
# characters, which is fine in a menu and wrong in output whose purpose is being
# pasted into a bug report.
AUDIT_FINDINGS=0

file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || echo "?"; }

# Colour wraps OUTSIDE the width specifier so padding counts visible characters.
audit_row() {  # audit_row NAME ACTUAL [WANT]
  local name="$1" actual="$2" want="${3:-}"
  if [[ -z "$want" || "$actual" == "$want" ]]; then
    printf "  %-34s %-10s ${GREEN}ok${NC}\n" "$name" "$actual"
  else
    printf "  %-34s %-10s want %-8s ${RED}FAIL${NC}\n" "$name" "$actual" "$want"
    AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1))
  fi
}

audit_files() {
  say "${BOLD}FILES${NC}"
  local spec f want
  for spec in "$ENV_FILE|$ENV_MODE" "$CONF_FILE|$CONF_MODE" \
              "$SETUP_CONF|$SETUP_CONF_MODE" "$HOST_NET_FRAGMENT|$HOST_NET_MODE" \
              "$GARAGE_CONFIG|$GARAGE_CONFIG_MODE"; do
    f="${spec%|*}"; want="${spec##*|}"
    if [[ ! -e "$f" ]]; then printf "  %-34s ${DIM}%s${NC}\n" "$f" "absent"; continue; fi
    audit_row "$f" "$(file_mode "$f")" "$want"
  done
  if [[ -d "$ENV_BACKUP_DIR" ]]; then
    audit_row "$ENV_BACKUP_DIR/" "$(file_mode "$ENV_BACKUP_DIR")" "$ENV_BACKUP_DIR_MODE"
    local b
    while IFS= read -r b; do
      [[ -n "$b" ]] || continue
      audit_row "  $(basename "$b")" "$(file_mode "$b")" "$ENV_MODE"
    done < <(find "$ENV_BACKUP_DIR" -maxdepth 1 -type f -name '.env.bak.*' 2>/dev/null | sort)
  fi
  return 0
}

audit_config() {
  say "${BOLD}CONFIG${NC}"
  local want have
  want="$(conf_sha)"; have="$(get_env HQ_CONFIG_SHA)"
  if [[ "$want" == "$have" ]]; then
    printf "  %-34s %-10s ${GREEN}ok${NC}\n" ".env matches $CONF_FILE" "$want"
  else
    printf "  %-34s %-10s want %-8s ${RED}FAIL${NC}\n" ".env matches $CONF_FILE" "${have:-unset}" "$want"
    say "    ${DIM}run: ./setup.sh render${NC}"
    AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1))
  fi
  # A declared storage backend whose mount is missing loses every upload.
  if [[ "$(yget deployment.storage.use)" == local_fs ]]; then
    local base; base="$(yget deployment.storage.user_uploads.base_path)"
    if $(compose_cmd) config 2>/dev/null | grep -q "target: ${base:-/data/storage}"; then
      printf "  %-34s %-10s ${GREEN}ok${NC}\n" "local_fs mounted" "${base:-/data/storage}"
    else
      printf "  %-34s %-10s ${RED}FAIL${NC}\n" "local_fs mounted" "missing"
      AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1))
    fi
  fi
  return 0
}

audit_ports() {
  say "${BOLD}PORTS${NC}"
  command -v ss >/dev/null 2>&1 || { printf "  ${DIM}%s${NC}\n" "(ss unavailable — skipped)"; return 0; }
  local ports want profs p got
  ports="$(needed_host_ports | sort -u)"
  [[ -n "$ports" ]] || { printf "  ${DIM}%s${NC}\n" "(no host ports claimed)"; return 0; }
  want="$(get_env HQ_BIND_HOST)"; want="${want:-127.0.0.1}"
  profs="$(effective_profiles)"
  local snapshot; snapshot="$(ss -ltnH 2>/dev/null | awk '{print $4}')"
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    local expect="$want"
    [[ ",$profs," == *",caddy,"* ]] && [[ "$p" == 80 || "$p" == 443 ]] && expect="0.0.0.0"
    got="$(printf '%s\n' "$snapshot" | awk -F: -v k="$p" '$NF==k{ sub(/:[^:]*$/,"",$0); print }' \
           | sed 's/^\[//; s/\]$//' | sort -u | tr '\n' ' ')"
    got="${got% }"
    case "$got" in '*'|'0.0.0.0'|'::') got=0.0.0.0 ;; esac
    if   [[ -z "$got"          ]]; then printf "  %-6s %-24s ${DIM}not listening${NC}\n" "$p" "-"
    elif [[ "$got" == "$expect" ]]; then printf "  %-6s %-24s ${GREEN}ok${NC}\n" "$p" "$got"
    else printf "  %-6s %-24s want %-10s ${RED}FAIL${NC}\n" "$p" "$got" "$expect"
         AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1))
    fi
  done <<< "$ports"
  return 0
}

audit_secrets() {
  say "${BOLD}SECRETS${NC}"
  local k keys=(SECRET_KEY ENCRYPTION_MASTER_KEY POSTGRES_PASSWORD REDIS_PASSWORD
                FIRST_SUPERUSER FIRST_SUPERUSER_PASSWORD)
  yon foundation.run.garage && keys+=(S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN)
  for k in "${keys[@]}"; do
    if is_placeholder "$(get_env "$k")"; then
      printf "  %-34s ${RED}%s${NC}\n" "$k" "placeholder"
      AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1))
    else
      printf "  %-34s ${GREEN}%s${NC}\n" "$k" "set"
    fi
  done
  return 0
}

audit_grants() {
  say "${BOLD}GRANTS${NC}  ${DIM}who may spend this deployment's keys${NC}"
  local cap prov lvl any=false
  for cap in $(ykeys foundation.access); do
    for prov in $(ykeys "foundation.access.$cap"); do
      lvl="$(yget "foundation.access.$cap.$prov")"
      any=true
      case "$lvl" in
        all|superuser) printf "  %-34s ${YELLOW}%s${NC}\n" "$cap/$prov" "$lvl" ;;
        byok)          printf "  %-34s ${DIM}%s${NC}\n"    "$cap/$prov" "$lvl" ;;
        none)          printf "  %-34s ${DIM}%s${NC}\n"    "$cap/$prov" "blocked" ;;
        *)             printf "  %-34s %-10s ${RED}FAIL${NC}  %s\n" "$cap/$prov" "$lvl" "not all|superuser|byok|none"
                       AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1)) ;;
      esac
    done
  done
  $any || printf "  ${DIM}%s${NC}\n" "(no grants — every keyed provider is BYOK)"
  return 0
}

# Proves the addresses instead of trusting them. foundation.providers.searxng
# said :8080 while searxng listens on :8888 — every declaration coherent, the
# service unreachable, and web search silently dead for weeks. Only a probe from
# inside the network the backend actually uses can tell the difference.
#
# Containers we run, and nothing else: an audit must not call OpenAI, spend a
# token, or announce this deployment to a third party.
audit_providers() {
  say "${BOLD}PROVIDERS${NC}  ${DIM}base_url reachable from the backend${NC}"
  local cmd; cmd="$(compose_cmd)"
  if ! docker_ok || ! $cmd ps --format '{{.Service}}' 2>/dev/null | grep -qx backend; then
    say "  ${DIM}backend not running — skipped${NC}"
    return 0
  fi
  local prov url code probed=0
  for prov in $(ykeys foundation.providers); do
    url="$(yget "foundation.providers.$prov.base_url")"
    [[ -z "$url" ]] && continue
    local host; host="$(prov_profile "$prov")"
    [[ -z "$host" ]] && continue
    # A container this deployment does not start is not a finding — that is a
    # declaration the coherence gate already speaks to. Probe what should be up.
    yon "foundation.run.$host" || continue
    probed=$((probed + 1))
    # curl writes %{http_code} even when it cannot connect ("000") and exits
    # non-zero; `|| true` keeps that value instead of appending a second one.
    code="$($cmd exec -T backend curl -s -o /dev/null -w '%{http_code}' \
            --max-time 5 "$url" 2>/dev/null || true)"
    # Any HTTP reply proves the address resolves and something answers there;
    # only a connection failure is a finding.
    if [[ "$code" == 000 || -z "$code" ]]; then
      printf "  %-34s %-10s ${RED}unreachable${NC}\n" "$prov" "$url"
      AUDIT_FINDINGS=$((AUDIT_FINDINGS + 1))
    else
      printf "  %-34s %-10s ${GREEN}ok${NC} ${DIM}(%s)${NC}\n" "$prov" "$url" "$code"
    fi
  done
  [[ "$probed" -eq 0 ]] && say "  ${DIM}no container-backed providers configured${NC}"
  return 0
}

do_audit() {
  AUDIT_FINDINGS=0
  [[ -f "$ENV_FILE" ]] || warn "No $ENV_FILE — reporting what exists on a bare checkout."
  audit_files;   echo
  [[ -f "$CONF_FILE" ]] && { audit_config; echo; audit_grants; echo; }
  audit_ports;   echo
  [[ -f "$CONF_FILE" ]] && { audit_providers; echo; }
  [[ -f "$ENV_FILE" ]] && { audit_secrets; echo; }
  if [[ "$AUDIT_FINDINGS" -eq 0 ]]; then ok "0 findings"; return 0; fi
  warn "${AUDIT_FINDINGS} finding(s) → exit 1"
  return 1
}

# ── usage / arg parsing ───────────────────────────────────────────────────────

usage() {
  cat <<EOF
HQ setup & operations.

  ./setup.sh                 dashboard — state, start/stop, logs, settings, secrets
  ./setup.sh dev secure      dev mode, host network. the one shortcut worth having
  ./setup.sh -y              unattended: take every default, ask nothing
  ./setup.sh render          regenerate .env / garage.toml / host-net from my-hq.yml
  ./setup.sh audit           read-only check: file modes, bind addresses, secrets
  ./setup.sh logs [service]  tail the running stack (or: watch)
  ./setup.sh rotate          interactive rotate menu
  ./setup.sh rotate <target> --fernet | --postgres | --redis | --secret-key | --all

Configuration is my-hq.yml, not flags. Edit it and re-run, or use the dashboard.
Secrets are .env. Both are written for you on first run.

Unattended (-y) takes HQ_SUPERUSER_EMAIL and HQ_SUPERUSER_PASSWORD from the
environment; without them the placeholder check refuses to start, by design.

After editing my-hq.yml by hand:  ./setup.sh render && docker compose up -d
`render` is non-interactive and idempotent. The dashboard's start does it for
you; a bare `docker compose up -d` does not, which is what the backend's
"config changed" refusal is telling you.

`audit` writes nothing and prints no secret value — only `set` or `placeholder`.
Safe against a live deployment, safe to paste into a bug report, safe in CI.
Exits 1 if anything is off.

Once set up, plain docker compose works — COMPOSE_FILE, COMPOSE_PROFILES and
COMPOSE_PROJECT_NAME are written into .env, so a bare \`docker compose up -d\`
picks up the same files, profiles and network mode as ./setup.sh would.
EOF
}

if [[ $# -eq 0 ]]; then
  migrate_old_env_backups
  if [[ ! -f "$ENV_FILE" ]]; then
    say "\n${BOLD}Welcome to HQ.${NC}"
    say "${DIM}First-time setup. We'll ask which foundation services you want, a${NC}"
    say "${DIM}superuser email + password, then start HQ. Everything else is${NC}"
    say "${DIM}auto-generated — no API keys required for the local-only flavors.${NC}\n"
    ( PROFILES=""; QUEUED_GRANTS=""; QUEUED_DEFAULTS=""; FMODE="dev"; DOMAIN_OPT=""; ACME_EMAIL_OPT=""; \
      SU_EMAIL_OPT=""; SU_PASSWORD_OPT=""; REACH=local; NETWORK_MODE=host; \
      MODE_SET=false; REACH_SET=false; NET_SET=false; SERVICES_SET=false; STORAGE_SET=false; USER_SET=false; \
      LANG_LOCAL=false; EMB_LOCAL=false; do_init ) \
      || { warn "Setup did not complete."; exit 1; }
    pause
  fi
  dashboard
  exit 0
fi

case "${1:-}" in
  rotate)      SUBCMD=rotate; shift ;;
  logs|watch)  SUBCMD=logs;   shift ;;
  render)      SUBCMD=render; shift ;;
  audit)       SUBCMD=audit;  shift ;;
  *)           SUBCMD=init ;;
esac

# Both sit above the argument loop and above the init branch, so there is no
# path from either to the wizard. That audit mutates nothing is structural.
if [[ "$SUBCMD" == "render" ]]; then
  [[ $# -eq 0 ]] || die "render takes no arguments."
  [[ -f "$ENV_FILE" ]] || die "No $ENV_FILE — run ./setup.sh first."
  do_render
  ok "rendered from $CONF_FILE"
  exit 0
fi

if [[ "$SUBCMD" == "audit" ]]; then
  [[ $# -eq 0 ]] || die "audit takes no arguments."
  audit_rc=0
  do_audit || audit_rc=$?
  exit "$audit_rc"
fi

# logs — everything after it is a service name, so this runs before the parser.
# compose_cmd matters here: a bare `docker compose logs` omits the hardened
# fragment, and a later bare `up` would then recreate everything in bridge mode.
if [[ "$SUBCMD" == "logs" ]]; then
  [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || die "No $CONF_FILE / $ENV_FILE — run ./setup.sh first."
  _c="$(compose_cmd)"
  say "${DIM}${_c} logs -f${NC}"
  say "${DIM}Ctrl-C stops watching — the stack keeps running.${NC}\n"
  COMPOSE_PROFILES="$(active_profiles)" exec $_c logs -f --tail="${LOG_TAIL:-200}" "$@"
fi

ROTATE_TARGETS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -y|--yes)  ASSUME_YES=true; shift ;;
    --fernet|--postgres|--redis|--secret-key|--all) ROTATE_TARGETS+=("$1"); shift ;;
    # The one shortcut. Everything else lives in my-hq.yml.
    dev|development)          CLI_ENVIRONMENT=local;      shift ;;
    prod|production|running)  CLI_ENVIRONMENT=production; shift ;;
    secure|secure-network)    CLI_NETWORK_MODE=host;      shift ;;
    *) die "Unknown argument: $1. Configuration lives in $CONF_FILE — see ./setup.sh --help" ;;
  esac
done

if [[ "$SUBCMD" == "rotate" ]]; then
  if [[ ${#ROTATE_TARGETS[@]} -eq 0 ]]; then
    [[ -f "$CONF_FILE" && -f "$ENV_FILE" ]] || die "No $CONF_FILE / $ENV_FILE — run ./setup.sh first."
    rotate_menu
  else
    do_rotate
  fi
else
  ensure_conf
  # Go through apply_mode, not a bare yset: the wizard's step 1 runs whenever
  # MODE_SET is false and apply_wizard_to_conf then writes FMODE over whatever
  # the flag just set — so `./setup.sh dev` silently produced production.
  [[ "${CLI_ENVIRONMENT:-}" == local      ]] && apply_mode dev
  [[ "${CLI_ENVIRONMENT:-}" == production ]] && apply_mode production
  if [[ -n "${CLI_NETWORK_MODE:-}" ]]; then
    NETWORK_MODE="$CLI_NETWORK_MODE"; NET_SET=true
  fi
  inherit_existing_config
  do_init
fi
