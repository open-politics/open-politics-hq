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

# ── Constants ─────────────────────────────────────────────────────────────────

# ANSI-C quoting so the bytes are real ESC (works through `printf %s`).
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'
DIM=$'\033[2m';   BOLD=$'\033[1m';     NC=$'\033[0m'

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"
SETUP_CONF=".config/hq/setup.conf"
ENV_BACKUP_DIR=".config/hq/backups/env_files"
PLACEHOLDERS="|changeThis|changethis|app_user|app_user_password|"
OPTIONAL_SERVICES=(minio ollama searxng nominatim caddy)

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

# ── .env IO ───────────────────────────────────────────────────────────────────

backup_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  mkdir -p "$ENV_BACKUP_DIR"
  local b="${ENV_BACKUP_DIR}/.env.bak.$(date +%Y%m%d%H%M%S)"
  cp "$ENV_FILE" "$b"; say "${DIM}backed up $ENV_FILE → $b${NC}"
}

# One-time migration: move legacy .env.bak.* files out of the repo root.
migrate_old_env_backups() {
  shopt -s nullglob
  local f moved=0
  for f in .env.bak.*; do
    mkdir -p "$ENV_BACKUP_DIR"
    mv "$f" "$ENV_BACKUP_DIR/" && moved=$((moved+1))
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

set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if [[ -f "$ENV_FILE" ]] && grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="}
      $1==k {print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
  else
    [[ -f "$ENV_FILE" ]] && cat "$ENV_FILE" > "$tmp" || true
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
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

# ── .config/hq/setup.conf (UX state, not deployment config) ───────────────────

conf_get() {
  [[ -f "$SETUP_CONF" ]] || { echo "${2:-}"; return; }
  local v
  v="$(awk -F= -v k="$1" '$1==k{print substr($0, length($1)+2); exit}' "$SETUP_CONF")"
  [[ -z "$v" ]] && v="${2:-}"
  echo "$v"
}

conf_set() {
  mkdir -p "$(dirname "$SETUP_CONF")"
  local tmp; tmp="$(mktemp)"
  if [[ -f "$SETUP_CONF" ]] && grep -qE "^$1=" "$SETUP_CONF"; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k"="v;next}{print}' "$SETUP_CONF" > "$tmp"
  else
    [[ -f "$SETUP_CONF" ]] && cat "$SETUP_CONF" > "$tmp"
    printf '%s=%s\n' "$1" "$2" >> "$tmp"
  fi
  mv "$tmp" "$SETUP_CONF"
}

# ── Preset matrix ─────────────────────────────────────────────────────────────

declare -a SEL_PRESETS=()
PROFILES=""; PA_GRANTS=""; ENVIRONMENT="local"; STORAGE="local_fs"; FMODE="dev"

add_profile() { [[ ",$PROFILES," == *",$1,"* ]] || PROFILES="${PROFILES:+$PROFILES,}$1"; }
add_grant()   { PA_GRANTS="${PA_GRANTS}${1}\n"; }

apply_preset() {
  case "$1" in
    production)
      ENVIRONMENT="production"; FMODE="prod"; STORAGE="minio"
      add_profile minio; add_profile searxng ;;
    dev)
      add_grant "PROVIDER_ACCESS_STORAGE_local_fs=all" ;;
    local-ollama)
      add_profile ollama
      add_grant "PROVIDER_ACCESS_LANGUAGE_ollama=all"
      add_grant "PROVIDER_ACCESS_EMBEDDING_ollama=all"
      add_grant "PROVIDER_ACCESS_STORAGE_local_fs=all" ;;
    local-geocoder)
      add_profile nominatim
      add_grant "PROVIDER_ACCESS_GEOCODING_local=all"
      add_grant "PROVIDER_ACCESS_STORAGE_local_fs=all" ;;
    searxng)
      add_profile searxng ;;
    *) die "Unknown preset: $1 (production|dev|local-ollama|local-geocoder|searxng)" ;;
  esac
}

# Boxed wizard step framing — clearly distinct from the main dashboard.
wizard_step() {
  local step="$1" total="$2" title="$3"
  clear 2>/dev/null || true
  say "${BLUE}┌─ Setup wizard · Step ${step} of ${total} · ${title}${NC}"
  say "${BLUE}│${NC}"
}
wizard_end() { say "${BLUE}└─────────────────────────────────────────────────────────────────────${NC}"; }

choose_preset_interactive() {
  local default; default="$(conf_get last_preset dev)"
  wizard_step 1 3 "How do you want to use HQ?"
  say "${BLUE}│${NC}  Pick a starting point. You can change everything later from the"
  say "${BLUE}│${NC}  'Foundation service providers' menu — this isn't a one-way door."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}    1) ${BOLD}dev${NC}             Just the core. Smallest footprint."
  say "${BLUE}│${NC}    2) ${BOLD}production${NC}      MinIO + SearXNG + production images & commands."
  say "${BLUE}│${NC}    3) ${BOLD}local-ollama${NC}    Adds Ollama for local LLM + embeddings."
  say "${BLUE}│${NC}    4) ${BOLD}local-geocoder${NC}  Adds Nominatim for local geocoding (heavy import)."
  say "${BLUE}│${NC}    5) ${BOLD}searxng${NC}         Adds local web search."
  say "${BLUE}│${NC}"
  say "${BLUE}│${NC}  Combine with commas — e.g. '2,3' = production + ollama."
  say "${BLUE}│${NC}  Type names ('dev', 'production') or numbers."
  wizard_end
  read -rp "  Your choice [press Enter for: ${BOLD}${default}${NC}]: " sel; sel="${sel:-$default}"

  local map=(_ dev production local-ollama local-geocoder searxng)
  IFS=',' read -ra picks <<< "$sel"
  local p
  for p in "${picks[@]}"; do
    p="$(echo "$p" | tr -d ' ')"
    [[ -z "$p" ]] && continue
    if [[ "$p" =~ ^[1-5]$ ]]; then
      SEL_PRESETS+=("${map[$p]}")
    elif [[ " dev production local-ollama local-geocoder searxng " == *" $p "* ]]; then
      SEL_PRESETS+=("$p")
    else
      die "Unknown choice: '$p' (use 1-5 or a preset name)"
    fi
  done
}

# ── Filesystem setup ──────────────────────────────────────────────────────────

ensure_store_dirs() {
  mkdir -p ./.store ./.config
  if [[ ",$PROFILES," == *",minio,"* ]]; then
    if [[ -d ./.store/minio ]]; then
      say "${DIM}keeping existing minio data ($(find ./.store/minio -maxdepth 1 | wc -l) entries)${NC}"
    else
      mkdir -p ./.store/minio; chmod 700 ./.store/minio; ok "created ./.store/minio (0700)"
    fi
  fi
  if [[ ",$PROFILES," == *",nominatim,"* ]]; then
    [[ -d ./.store/nominatim ]] || { mkdir -p ./.store/nominatim; chmod 755 ./.store/nominatim; ok "created ./.store/nominatim"; }
  fi
  if [[ ",$PROFILES," == *",caddy,"* ]]; then
    [[ -f ./.config/caddy/Caddyfile ]] || die ".config/caddy/Caddyfile missing — repo state is inconsistent."
  fi
}

ensure_local_fs_path() {
  [[ "$STORAGE" == "local_fs" ]] || return 0
  local lfs; lfs="$(get_env LOCAL_STORAGE_BASE_PATH)"; lfs="${lfs:-/data/storage}"
  if [[ ! -d "$lfs" ]]; then
    mkdir -p "$lfs" 2>/dev/null \
      || die "$lfs does not exist and is not creatable. Run: sudo mkdir -p $lfs && sudo chown $(id -u) $lfs"
    ok "created local_fs path $lfs"
  elif [[ ! -w "$lfs" ]]; then
    die "$lfs exists but is not writable by $(id -un). Fix ownership and re-run."
  else
    say "${DIM}local_fs path $lfs ok${NC}"
  fi
}

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"; ok "created $ENV_FILE from $EXAMPLE_FILE"
  else
    backup_env
  fi
  say "Secrets:"
  ensure_secret SECRET_KEY            gen_secret
  ensure_secret ENCRYPTION_MASTER_KEY gen_fernet
  ensure_secret POSTGRES_PASSWORD     gen_secret
  ensure_secret REDIS_PASSWORD        gen_secret
  local mu mp
  mu="$(get_env MINIO_ROOT_USER)"; mp="$(get_env MINIO_ROOT_PASSWORD)"
  if [[ "${REGEN:-false}" == true ]] || is_placeholder "$mu" || is_placeholder "$mp"; then
    mu="hq_minio_$(openssl rand -hex 3)"; mp="$(gen_secret)"
    set_env MINIO_ROOT_USER "$mu"; set_env MINIO_ROOT_PASSWORD "$mp"
    say "  generated MINIO_ROOT_USER / MINIO_ROOT_PASSWORD"
  else
    say "${DIM}  kept existing MINIO_ROOT_USER / MINIO_ROOT_PASSWORD${NC}"
  fi
  set_env MINIO_ACCESS_KEY "$mu"; set_env MINIO_SECRET_KEY "$mp"

  set_env ENVIRONMENT "$ENVIRONMENT"
  set_env STORAGE_PROVIDER_TYPE "$STORAGE"
  set_env COMPOSE_PROFILES "$PROFILES"
  set_env BACKEND_WORKERS "${BACKEND_WORKERS:-4}"
  set_env CELERY_CONCURRENCY "${CELERY_CONCURRENCY:-4}"
  for k in FIRST_SUPERUSER FIRST_SUPERUSER_PASSWORD DOMAIN; do
    local cur; cur="$(get_env "$k")"
    if is_placeholder "$cur" && [[ "${ASSUME_YES:-false}" != true ]]; then
      read -rp "  $k: " v; [[ -n "$v" ]] && set_env "$k" "$v"
    fi
  done
  if [[ -n "$PA_GRANTS" ]]; then
    while IFS='=' read -r gk gv; do
      [[ -z "$gk" ]] && continue
      set_env "$gk" "$gv"
    done < <(echo -e "$PA_GRANTS")
  fi
}

summary() {
  say "\n${GREEN}Resolved configuration${NC}"
  say "  presets:   ${SEL_PRESETS[*]:-<none>}"
  say "  profiles:  ${PROFILES:-<none, lean core>}"
  say "  env:       $ENVIRONMENT   storage: $STORAGE   mode: $FMODE"
  say "  workers:   backend=${BACKEND_WORKERS:-4} celery=${CELERY_CONCURRENCY:-4}"
  [[ "${ASSUME_YES:-false}" == true ]] && return 0
  read -rp $'\nProceed? [Y/n] ' a; [[ "${a:-Y}" =~ ^[Yy]?$ ]] || die "Aborted."
}

# ── Compose / stack ───────────────────────────────────────────────────────────

compose_cmd() {
  local mode="${FMODE:-}"
  if [[ -z "$mode" ]]; then
    [[ "$(get_env ENVIRONMENT)" == "production" ]] && mode=prod || mode=dev
  fi
  if [[ "$mode" == "prod" ]]; then echo "docker compose -f compose.yml"; else echo "docker compose"; fi
}

active_profiles() { echo "${PROFILES:-$(get_env COMPOSE_PROFILES)}"; }

stack_up() {
  [[ "${NO_UP:-false}" == true ]] && { warn "--no-up: configuration written, stack not started."; return 0; }
  local c; c="$(compose_cmd)"
  say "\n${DIM}$c up --build -d${NC}"
  COMPOSE_PROFILES="$(active_profiles)" $c up --build -d
  ok "\nUp. Frontend: $(frontend_url)"
}

stack_down() {
  local c; c="$(compose_cmd)"
  warn "Stopping stack (data volumes are preserved — never 'down -v')."
  COMPOSE_PROFILES="$(active_profiles)" $c down
  ok "Stopped."
}

stack_restart() {
  local c; c="$(compose_cmd)"
  COMPOSE_PROFILES="$(active_profiles)" $c restart
  ok "Restarted."
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

do_init() {
  [[ ${#SEL_PRESETS[@]} -gt 0 ]] || choose_preset_interactive
  for p in "${SEL_PRESETS[@]}"; do apply_preset "$p"; done
  ensure_store_dirs
  ensure_local_fs_path
  ensure_env
  summary
  stack_up
  # Remember for next run — UX state lives in setup.conf, not .env.
  conf_set last_preset "$(IFS=','; echo "${SEL_PRESETS[*]}")"
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
    | $c exec -T db psql -U "$user" -d "$(get_env POSTGRES_DB)" \
    || die "ALTER USER failed; .env NOT changed (backup kept)."
  set_env POSTGRES_PASSWORD "$new"
  rotate_restart
  ok "Postgres password rotated."
}

rotate_minio() {
  local mp; mp="$(gen_secret)"
  backup_env
  set_env MINIO_ROOT_PASSWORD "$mp"; set_env MINIO_SECRET_KEY "$mp"
  warn "Recreating minio (data in ./.store/minio is bind-mounted and preserved)."
  rotate_restart minio
  ok "MinIO secret rotated."
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
  [[ -f "$ENV_FILE" ]] || die "No $ENV_FILE — run ./setup.sh first."
  local did=false
  for a in "${ROTATE_TARGETS[@]}"; do
    case "$a" in
      --fernet)     rotate_fernet; did=true ;;
      --postgres)   rotate_postgres; did=true ;;
      --minio)      rotate_minio; did=true ;;
      --redis)      rotate_redis; did=true ;;
      --secret-key) rotate_secret_key; did=true ;;
      --all)        rotate_postgres; rotate_minio; rotate_redis; rotate_secret_key; rotate_fernet; did=true ;;
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

placeholder_secrets() {
  local k out=""
  for k in SECRET_KEY ENCRYPTION_MASTER_KEY POSTGRES_PASSWORD REDIS_PASSWORD FIRST_SUPERUSER_PASSWORD; do
    is_placeholder "$(get_env "$k")" && out="${out:+$out, }$k"
  done
  echo "$out"
}

service_label() {  # legacy combined (used by Services toggle menu)
  printf "%s (%s)" "$(service_name "$1")" "$(service_desc "$1")"
}

service_name() {
  case "$1" in
    db) echo "Postgres" ;; backend) echo "Backend API" ;; frontend) echo "Frontend UI" ;;
    redis) echo "Redis" ;; celery_worker) echo "Celery worker" ;; celery_beat) echo "Celery scheduler" ;;
    minio) echo "MinIO" ;; ollama) echo "Ollama" ;; searxng) echo "SearXNG" ;;
    nominatim) echo "Nominatim" ;; caddy) echo "Caddy" ;;
    *) echo "$1" ;;
  esac
}

service_desc() {
  case "$1" in
    db) echo "database" ;; redis) echo "queue + cache" ;;
    minio) echo "object storage" ;; ollama) echo "local LLM + embeddings" ;;
    searxng) echo "web search" ;; nominatim) echo "geocoder" ;;
    caddy) echo "HTTPS reverse proxy + auto-TLS" ;;
    *) echo "" ;;
  esac
}

bool_show() { local v="${1,,}"; [[ "$v" == "true" || "$v" == "1" || "$v" == "yes" ]] && echo "yes" || echo "no"; }
is_dev_mode() { [[ "$(get_env ENVIRONMENT)" != "production" ]]; }

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
  host="$(get_env SMTP_HOST)"; port="$(get_env SMTP_PORT)"; from="$(get_env EMAILS_FROM_EMAIL)"
  if [[ -z "$host" ]]; then echo "${DIM}not configured${NC}"
  else echo "${host}:${port:-587}  ${DIM}sends as ${from:-<unset>}${NC}"; fi
}

signup_display() {
  local r v rs vs
  r="$(bool_show "$(get_env USERS_OPEN_REGISTRATION)")"
  v="$(bool_show "$(get_env REQUIRE_EMAIL_VERIFICATION)")"
  [[ "$r" == "yes" ]] && rs="open" || rs="closed"
  [[ "$v" == "yes" ]] && vs="email verification required" || vs="no email verification"
  echo "${rs}  ${DIM}·${NC}  ${vs}"
}

profile_active() { [[ ",$(get_env COMPOSE_PROFILES)," == *",$1,"* ]]; }

add_profile_persist() {
  local cur; cur="$(get_env COMPOSE_PROFILES)"
  [[ ",$cur," == *",$1,"* ]] && return 0
  set_env COMPOSE_PROFILES "${cur:+$cur,}$1"
}

remove_profile_persist() {
  local cur new=""; cur="$(get_env COMPOSE_PROFILES)"
  IFS=, read -ra a <<< "$cur"
  for p in "${a[@]}"; do
    [[ -z "$p" || "$p" == "$1" ]] && continue
    new="${new:+$new,}$p"
  done
  set_env COMPOSE_PROFILES "$new"
}

# Drift: what's running vs what's configured.
configured_profiles() {
  echo "$(get_env COMPOSE_PROFILES)" | tr ',' '\n' | grep -v '^$' | sort -u
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
  local d; d="$(get_env DOMAIN)"
  if [[ "$(get_env ENVIRONMENT)" == "production" && -n "$d" && "$d" != "localhost" ]]; then
    echo "https://$d"
  else
    echo "http://localhost:3000"
  fi
}

backend_url() {
  local d port; d="$(get_env DOMAIN)"; port="$(get_env BACKEND_PORT)"; port="${port:-8022}"
  if [[ "$(get_env ENVIRONMENT)" == "production" && -n "$d" && "$d" != "localhost" ]]; then
    echo "https://$d/api"
  else
    echo "http://localhost:${port}"
  fi
}

email_status() {  # one-line, used in submenus
  local host port from
  host="$(get_env SMTP_HOST)"; port="$(get_env SMTP_PORT)"; from="$(get_env EMAILS_FROM_EMAIL)"
  if [[ -z "$host" ]]; then echo "not configured"
  else echo "${host}:${port:-587} from <${from:-?}>"; fi
}

storage_status() {
  local t; t="$(get_env STORAGE_PROVIDER_TYPE)"
  case "$t" in
    local_fs) echo "local files at $(get_env LOCAL_STORAGE_BASE_PATH)" ;;
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

prompt_set() {
  local cur new
  cur="$(get_env "$1")"
  read -rp "  $2 [${cur:-empty}]: " new
  if [[ -n "$new" ]]; then backup_env; set_env "$1" "$new"; ok "  $1 set."; fi
}

prompt_set_password() {
  local new
  read -rsp "  $2 (hidden): " new; echo
  if [[ -n "$new" ]]; then backup_env; set_env "$1" "$new"; ok "  $1 set."; fi
}

toggle_bool() {
  local key="$1" cur new; cur="$(get_env "$key")"
  case "${cur,,}" in true|1|yes) new=false ;; *) new=true ;; esac
  backup_env; set_env "$key" "$new"
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
  local url; url="$(frontend_url)"
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
       local new=""
       local svc
       for svc in $(running_optional); do new="${new:+$new,}$svc"; done
       set_env COMPOSE_PROFILES "$new"
       ok "Saved: COMPOSE_PROFILES=${new:-<empty>}"
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

# ── Features (toggle optional services) ───────────────────────────────────────

services_menu() {
  [[ -f "$ENV_FILE" ]] || { warn "Run setup first."; pause; return; }
  local new; new="$(get_env COMPOSE_PROFILES)"
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Local services${NC}  ${DIM}toggle, then 'Save & apply'${NC}"
    say "  current: ${new:-<lean core only>}"
    echo
    local i=0 p mark
    for p in "${OPTIONAL_SERVICES[@]}"; do
      i=$((i+1))
      if [[ ",$new," == *",$p,"* ]]; then mark="${GREEN}[on]${NC} "
      else mark="${DIM}[off]${NC}"; fi
      printf "  ${GREEN}%d${NC}  %b %-10s %s\n" "$i" "$mark" "$p" "$(service_label "$p")"
    done
    echo
    say "  ${GREEN}s${NC}  Save & apply"
    say "  ${GREEN}0${NC}  Cancel (discard changes)"
    pick_menu r
    case "$r" in
      1|2|3|4|5)
        local svc="${OPTIONAL_SERVICES[$((r-1))]}"
        if [[ ",$new," == *",$svc,"* ]]; then
          local out=""
          IFS=, read -ra a <<< "$new"
          for x in "${a[@]}"; do
            [[ -z "$x" || "$x" == "$svc" ]] && continue
            out="${out:+$out,}$x"
          done
          new="$out"
        else
          if [[ "$svc" == "caddy" ]] && is_placeholder "$(get_env DOMAIN)"; then
            warn "DOMAIN is not set. Caddy needs a real domain — use 'Publish to a public domain' instead."
            pause; continue
          fi
          new="${new:+$new,}$svc"
        fi
        ;;
      s|S)
        backup_env; set_env COMPOSE_PROFILES "$new"
        [[ ",$new," == *",minio,"* && ! -d ./.store/minio ]]         && { mkdir -p ./.store/minio; chmod 700 ./.store/minio; }
        [[ ",$new," == *",nominatim,"* && ! -d ./.store/nominatim ]] && { mkdir -p ./.store/nominatim; chmod 755 ./.store/nominatim; }
        ok "Saved: ${new:-<lean core>}"
        if docker_ok && confirm_y "Restart stack now with the new feature set?"; then
          ( stack_up ) || warn "Restart failed."
        fi
        pause; return 0
        ;;
      0|"") return 0 ;;
      *) warn "Invalid."; sleep 1 ;;
    esac
  done
}

# ── Foundation service providers (umbrella menu) ──────────────────────────────
# Architecturally everything HQ talks to is a "foundation service provider":
# local container services (Ollama, MinIO, SearXNG, Nominatim, Caddy) AND cloud
# APIs (OpenAI, Anthropic, …). This is the single entry point for both.

foundation_menu() {
  [[ -f "$ENV_FILE" ]] || { warn "Run setup first."; pause; return; }
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Foundation service providers${NC}"
    echo
    say "${DIM}  HQ talks to pluggable providers for each capability — language,${NC}"
    say "${DIM}  embedding, storage, OCR, geocoding, web search, scraping. Some run${NC}"
    say "${DIM}  as local containers; others are cloud APIs that need a key.${NC}"
    echo
    say "  ${GREEN}1${NC}  Local services       ${DIM}MinIO · Ollama · SearXNG · Nominatim · Caddy${NC}"
    say "  ${GREEN}2${NC}  API providers        ${DIM}OpenAI · Anthropic · Google · Jina · Tavily · Mapbox${NC}"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) services_menu ;;
      2) api_providers_menu ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
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
    printf "  tls=%s   ssl=%s\n" "$(bool_show "$(get_env SMTP_TLS)")" "$(bool_show "$(get_env SMTP_SSL)")"
    printf "  from:      %s <%s>\n" "$(get_env EMAILS_FROM_NAME)" "$(get_env EMAILS_FROM_EMAIL)"
    printf "  verify:    %s\n" "$(bool_show "$(get_env REQUIRE_EMAIL_VERIFICATION)")"
    printf "  open reg:  %s\n" "$(bool_show "$(get_env USERS_OPEN_REGISTRATION)")"
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
         prompt_set EMAILS_FROM_NAME "Sender name (e.g. \"Open Politics\")"
         prompt_set EMAILS_FROM_EMAIL "Sender email"
         confirm "Restart backend?" && { docker_ok && ( $(compose_cmd) restart backend ) || warn "Skipped."; }
         pause ;;
      3) toggle_bool REQUIRE_EMAIL_VERIFICATION ;;
      4) toggle_bool USERS_OPEN_REGISTRATION ;;
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
  prompt_set SMTP_HOST "SMTP host (e.g. smtp.protonmail.ch)"
  prompt_set SMTP_PORT "SMTP port (587 STARTTLS / 465 SSL)"
  prompt_set SMTP_USER "SMTP user"
  prompt_set_password SMTP_PASSWORD "SMTP password"
  local r
  read -rp "  Use STARTTLS (TLS)? [Y/n] " r; [[ "${r:-Y}" =~ ^[Yy]$ ]] && set_env SMTP_TLS true || set_env SMTP_TLS false
  read -rp "  Use SSL (port 465)? [y/N] " r; [[ "$r" =~ ^[Yy]$ ]] && set_env SMTP_SSL true || set_env SMTP_SSL false
  ok "SMTP configured."
  confirm "Restart backend to apply?" && { docker_ok && ( $(compose_cmd) restart backend ) || warn "Skipped."; }
  pause
}

# ── Storage ───────────────────────────────────────────────────────────────────

storage_menu() {
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Storage${NC}"
    printf "  current:  %s\n\n" "$(storage_status)"
    say "  ${GREEN}1${NC}  Local filesystem"
    say "  ${GREEN}2${NC}  MinIO (S3-compatible container)"
    say "  ${GREEN}3${NC}  External S3"
    say "  ${GREEN}4${NC}  Change local_fs base path"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) backup_env; set_env STORAGE_PROVIDER_TYPE local_fs; remove_profile_persist minio
         set_env PROVIDER_ACCESS_STORAGE_local_fs all
         ok "Storage = local_fs"; pause ;;
      2) backup_env; set_env STORAGE_PROVIDER_TYPE minio; add_profile_persist minio
         [[ -d ./.store/minio ]] || { mkdir -p ./.store/minio; chmod 700 ./.store/minio; }
         ok "Storage = minio"; pause ;;
      3) backup_env; set_env STORAGE_PROVIDER_TYPE s3
         prompt_set S3_BUCKET_NAME "S3 bucket"
         prompt_set S3_REGION "Region"
         prompt_set S3_ACCESS_KEY_ID "Access key id"
         prompt_set_password S3_SECRET_ACCESS_KEY "Secret access key"
         ok "Storage = s3"; pause ;;
      4) prompt_set LOCAL_STORAGE_BASE_PATH "Local storage path"; pause ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
}

# ── Providers ─────────────────────────────────────────────────────────────────

# API providers (cloud) — keys + sharing.
#
# Each row pairs an env var holding the key with the grant env var that
# controls who can use the deployment-level key. Format:
#   "ProviderLabel|KEY_ENV|GRANT_ENV|covers"
#
# A single provider may show up multiple times (OpenAI does both language and
# embedding) — each row is one capability/provider pair the user can grant.
declare -a API_PROVIDERS=(
  "OpenAI    (language)|OPENAI_API_KEY|PROVIDER_ACCESS_LANGUAGE_openai|language"
  "OpenAI    (embedding)|OPENAI_API_KEY|PROVIDER_ACCESS_EMBEDDING_openai|embedding"
  "Anthropic (language)|ANTHROPIC_API_KEY|PROVIDER_ACCESS_LANGUAGE_anthropic|language"
  "Google    (language)|GOOGLE_API_KEY|PROVIDER_ACCESS_LANGUAGE_google|language"
  "Mistral   (language)|MISTRAL_API_KEY|PROVIDER_ACCESS_LANGUAGE_mistral|language"
  "Jina      (embedding)|JINA_API_KEY|PROVIDER_ACCESS_EMBEDDING_jina|embedding"
  "Voyage    (embedding)|VOYAGE_API_KEY|PROVIDER_ACCESS_EMBEDDING_voyage|embedding"
  "Tavily    (web search)|TAVILY_API_KEY|PROVIDER_ACCESS_WEB_SEARCH_tavily|web search"
  "Mapbox    (geocoding)|MAPBOX_ACCESS_TOKEN||geocoding"
)

grant_pretty() {  # grant_pretty VALUE  -> human-readable label
  case "${1:-}" in
    all)       echo "everyone" ;;
    superuser) echo "admins only" ;;
    none)      echo "${RED}blocked${NC}" ;;
    "")        echo "${DIM}not shared (users bring own)${NC}" ;;
    *)         echo "$1" ;;
  esac
}

api_providers_menu() {
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}API providers${NC}  ${DIM}cloud foundation services (OpenAI, Anthropic, …)${NC}"
    echo
    printf "  ${BOLD}%-22s %-13s %s${NC}\n" "provider" "key" "shared with"
    say "  ${DIM}───────────────────────────────────────────────────────────────${NC}"
    local row label key_env grant_env covers
    for row in "${API_PROVIDERS[@]}"; do
      IFS='|' read -r label key_env grant_env covers <<< "$row"
      printf "  %-22s %-13s %b\n" \
        "$label" \
        "$(mask "$(get_env "$key_env")")" \
        "$(grant_pretty "$(get_env "$grant_env")")"
    done
    echo
    say "  ${GREEN}1${NC}  Set or change an API key"
    say "  ${GREEN}2${NC}  Change sharing — who on this HQ can use a deployment-level key"
    say "  ${GREEN}3${NC}  Clear a key"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) set_api_key_prompt; pause ;;
      2) set_sharing_prompt; pause ;;
      3) clear_api_key_prompt; pause ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
}

# Unique providers (dedup by KEY_ENV) for the "set a key" picker.
unique_api_key_envs() {
  local row key_env seen=""
  for row in "${API_PROVIDERS[@]}"; do
    IFS='|' read -r _ key_env _ _ <<< "$row"
    [[ ",$seen," == *",$key_env,"* ]] && continue
    seen="${seen:+$seen,}$key_env"
    echo "$key_env"
  done
}

api_key_label() {
  case "$1" in
    OPENAI_API_KEY)      echo "OpenAI" ;;
    ANTHROPIC_API_KEY)   echo "Anthropic" ;;
    GOOGLE_API_KEY)      echo "Google" ;;
    MISTRAL_API_KEY)     echo "Mistral" ;;
    JINA_API_KEY)        echo "Jina" ;;
    VOYAGE_API_KEY)      echo "Voyage" ;;
    TAVILY_API_KEY)      echo "Tavily" ;;
    MAPBOX_ACCESS_TOKEN) echo "Mapbox" ;;
    *)                   echo "$1" ;;
  esac
}

set_api_key_prompt() {
  # Build "Label — KEY_ENV — current" lines; fzf shows them, we strip back to env name.
  local picked label key_env
  picked="$(
    while IFS= read -r key_env; do
      printf '%-12s  %s\n' "$(api_key_label "$key_env")" "$key_env"
    done < <(unique_api_key_envs) | fzf_pick "API key:" "Which provider's key to set or change?"
  )" || return 0
  [[ -z "$picked" ]] && return 0
  # picked looks like "OpenAI       OPENAI_API_KEY"
  key_env="${picked##* }"
  label="$(api_key_label "$key_env")"
  prompt_set_password "$key_env" "$label API key"
}

clear_api_key_prompt() {
  say "  Which provider's key to clear?"
  local keys=() label
  local i=0 key_env
  while IFS= read -r key_env; do
    keys+=("$key_env"); i=$((i+1))
    printf "    ${GREEN}%d${NC} %s  ${DIM}%s${NC}\n" "$i" "$key_env" "$(mask "$(get_env "$key_env")")"
  done < <(unique_api_key_envs)
  say "    ${GREEN}0${NC} Cancel"
  pick_menu r
  [[ "$r" =~ ^[1-9][0-9]*$ && "$r" -le "${#keys[@]}" ]] || return 0
  if confirm "Clear ${keys[$((r-1))]}?"; then
    backup_env; set_env "${keys[$((r-1))]}" ""
    ok "  cleared"
  fi
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

set_sharing_prompt() {
  clear 2>/dev/null || true
  sharing_explainer

  # Each line = "Label   current  →  GRANT_ENV" so fzf shows it nicely and we
  # strip the env var name back out by splitting on the last whitespace.
  local picked grant_env label row key_env covers
  picked="$(
    for row in "${API_PROVIDERS[@]}"; do
      IFS='|' read -r label key_env grant_env covers <<< "$row"
      [[ -z "$grant_env" ]] && continue
      printf '%-22s  current: %-32s  %s\n' \
        "$label" \
        "$(grant_pretty "$(get_env "$grant_env")")" \
        "$grant_env"
    done | fzf_pick "Provider:" "Pick a provider/capability to set sharing for"
  )" || return 0
  [[ -z "$picked" ]] && return 0
  grant_env="${picked##* }"
  # Re-derive the label from the leading 22-char column.
  label="$(awk '{print $1 " " $2}' <<< "$picked" | sed 's/[[:space:]]*$//')"

  echo
  say "  ${BOLD}Sharing level for ${label}:${NC}"
  local level
  level="$(printf '%s\n' \
    "Everyone     — any signed-in user" \
    "Admins only  — superusers" \
    "Blocked      — no one on this HQ can use this provider" \
    "Not shared   — default; users bring their own key" \
    | fzf_pick "Level:" "What level should the deployment-level key be shared at?")" || return 0
  [[ -z "$level" ]] && return 0
  local val
  case "$level" in
    Everyone*)    val=all ;;
    Admins*)      val=superuser ;;
    Blocked*)     val=none ;;
    Not\ shared*) val="" ;;
    *)            return 0 ;;
  esac
  backup_env; set_env "$grant_env" "$val"
  ok "  ${label} → $(grant_pretty "$val")"
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
  prompt_set BACKEND_WORKERS  "Backend uvicorn workers (prod only)"
  prompt_set CELERY_CONCURRENCY "Celery prefork concurrency"
  if confirm "Restart stack to apply?"; then
    docker_ok && ( stack_restart ) || warn "Restart skipped."
  fi
  pause
}

domain_prompt() {
  clear 2>/dev/null || true
  say "${GREEN}Domain${NC}"
  printf "  current:  %s\n\n" "$(get_env DOMAIN)"
  prompt_set DOMAIN "Domain (e.g. open-politics.org or localhost)"
  if profile_active caddy; then
    warn "  Caddy is active — restart to pick up the new domain."
    confirm "Restart caddy now?" && { docker_ok && ( $(compose_cmd) up -d --force-recreate --no-deps caddy ) || warn "Skipped."; }
  fi
  pause
}

# ── Settings ──────────────────────────────────────────────────────────────────

settings_menu() {
  [[ -f "$ENV_FILE" ]] || { warn "Run setup first."; pause; return; }
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Settings${NC}"
    printf "  superuser:  %s\n" "$(get_env FIRST_SUPERUSER)"
    printf "  email:      %s\n" "$(email_status)"
    printf "  storage:    %s\n" "$(storage_status)"
    printf "  workers:    backend=%s  celery=%s\n" "$(get_env BACKEND_WORKERS)" "$(get_env CELERY_CONCURRENCY)"
    printf "  domain:     %s\n" "$(get_env DOMAIN)"
    echo
    say "  ${GREEN}1${NC}  Superuser            ${DIM}email and password${NC}"
    say "  ${GREEN}2${NC}  Email                ${DIM}SMTP, from address, verification, open registration${NC}"
    say "  ${GREEN}3${NC}  Storage              ${DIM}provider and local_fs path${NC}"
    say "  ${GREEN}4${NC}  Workers              ${DIM}backend and celery counts${NC}"
    say "  ${GREEN}5${NC}  Domain"
    say "  ${GREEN}6${NC}  Re-run setup wizard"
    say "  ${GREEN}7${NC}  Edit any single .env value"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) identity_menu ;;
      2) email_menu ;;
      3) storage_menu ;;
      4) workers_prompt ;;
      5) domain_prompt ;;
      6) ( SEL_PRESETS=(); PROFILES=""; PA_GRANTS=""; FMODE="dev"; do_init ) || warn "Wizard did not complete."; pause ;;
      7) edit_value ;;
      0|"") return 0 ;;
      *) warn "Invalid."; pause ;;
    esac
  done
}

# ── Rotate submenu ────────────────────────────────────────────────────────────

rotate_menu() {
  while true; do
    clear 2>/dev/null || true
    say "${GREEN}Rotate passwords & keys${NC}  ${DIM}(.env backed up; data volumes preserved)${NC}"
    say "  ${GREEN}1${NC}  Encryption key (Fernet)   ${DIM}re-encrypts all stored credentials${NC}"
    say "  ${GREEN}2${NC}  Postgres password"
    say "  ${GREEN}3${NC}  MinIO secret"
    say "  ${GREEN}4${NC}  Redis password"
    say "  ${GREEN}5${NC}  JWT SECRET_KEY            ${DIM}(forces re-login)${NC}"
    say "  ${GREEN}6${NC}  ALL of the above"
    say "  ${GREEN}0${NC}  Back"
    pick_menu r
    case "$r" in
      1) confirm "Rotate the encryption key now?"        && { ( rotate_fernet )      || warn "Rotation aborted."; } ;;
      2) confirm "Rotate the Postgres password now?"     && { ( rotate_postgres )    || warn "Rotation aborted."; } ;;
      3) confirm "Rotate the MinIO secret now?"          && { ( rotate_minio )       || warn "Rotation aborted."; } ;;
      4) confirm "Rotate the Redis password now?"        && { ( rotate_redis )       || warn "Rotation aborted."; } ;;
      5) confirm "Rotate SECRET_KEY (logs everyone out)?" && { ( rotate_secret_key ) || warn "Rotation aborted."; } ;;
      6) confirm "Rotate ALL secrets now?"               && { ( rotate_postgres; rotate_minio; rotate_redis; rotate_secret_key; rotate_fernet ) || warn "Rotation aborted."; } ;;
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
  [[ -f "$ENV_FILE" ]] || { warn "Run setup first — .env must exist."; pause; return; }
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
  read -rp "  ACME contact email (for Let's Encrypt expiry notices): " acme

  warn "  Make sure A-record for ${BOLD}${domain}${NC} points to ${BOLD}${pubip}${NC}."
  warn "  Caddy will fail to obtain a certificate if DNS hasn't propagated."
  confirm_y "DNS is set and you're ready?" || { warn "Cancelled — re-run when DNS is ready."; pause; return; }

  backup_env
  set_env DOMAIN "$domain"
  set_env ACME_EMAIL "$acme"
  set_env ENVIRONMENT "production"
  set_env STORAGE_PROVIDER_TYPE "minio"
  add_profile_persist minio
  add_profile_persist searxng
  add_profile_persist caddy
  local cors; cors="$(get_env BACKEND_CORS_ORIGINS)"
  if [[ ",$cors," != *",https://$domain,"* ]]; then
    set_env BACKEND_CORS_ORIGINS "${cors:+$cors,}https://$domain"
  fi
  ok "  .env updated: production + caddy + minio + searxng."

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
  elif ! stack_is_running; then echo "Start HQ"
  else echo "Open HQ in your browser"; fi
}

suggested_action() {
  if [[ ! -f "$ENV_FILE" ]]; then echo 1; return; fi
  if has_drift; then echo 7; return; fi
  if [[ -n "$(placeholder_secrets)" ]]; then echo 6; return; fi
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
  say "    ${GREEN}5${NC}  Foundation service providers   ${DIM}local services · cloud API providers${NC}"
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
           ( SEL_PRESETS=(); PROFILES=""; PA_GRANTS=""; FMODE="dev"; do_init ) || warn "Setup did not complete."
           pause
           enter_alt_screen
         elif ! $running_now; then
           ( stack_up ) || warn "Start failed."; pause
         else
           open_browser
         fi
         ;;
      2) if $running_now; then ( stack_restart ) || warn "Restart failed."; pause; fi ;;
      3) if $running_now; then ( stack_down ) || warn "Stop failed."; pause; fi ;;
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

# ── usage / arg parsing ───────────────────────────────────────────────────────

usage() {
  cat <<EOF
HQ setup & operations.

Usage:
  ./setup.sh                       interactive TUI dashboard (default)
  ./setup.sh rotate                interactive rotate menu
  ./setup.sh [init] [options]      non-interactive: configure and start
  ./setup.sh rotate <targets>      non-interactive: rotate specific secrets

The bare command opens a dashboard showing current state and offers menu
options to start/stop, configure foundation service providers (local
container services + cloud API providers), edit settings, publish to a
public domain (Caddy + auto-TLS), and rotate secrets — no flags needed.
UX state lives in .config/hq/setup.conf; deployment config lives in .env.

init options:
  --preset NAME          production | dev | local-ollama | local-geocoder | searxng
                         (repeatable; additive)
  --profiles LIST        explicit comma profile list (overrides preset profiles)
  --backend-workers N    uvicorn workers in prod (default 4)
  --celery-concurrency N celery prefork concurrency (default 4)
  --regenerate-secrets   force-regenerate ALL secrets
  --no-up                write config only, do not start the stack
  -y, --yes              non-interactive
  -h, --help

rotate targets:
  --fernet  --postgres  --minio  --redis  --secret-key  --all
EOF
}

if [[ $# -eq 0 ]]; then
  migrate_old_env_backups
  # Fresh clone → go straight into the wizard so the user isn't bounced
  # through a dashboard that says "not configured yet."
  if [[ ! -f "$ENV_FILE" ]]; then
    say "\n${BOLD}Welcome to HQ.${NC}"
    say "${DIM}First-time setup. We'll ask which foundation services you want, a${NC}"
    say "${DIM}superuser email + password, then start HQ. Everything else is${NC}"
    say "${DIM}auto-generated — no API keys required for the local-only flavors.${NC}\n"
    ( SEL_PRESETS=(); PROFILES=""; PA_GRANTS=""; FMODE="dev"; do_init ) \
      || { warn "Setup did not complete."; exit 1; }
    pause
  fi
  dashboard
  exit 0
fi

[[ "$1" == "rotate" ]] && { SUBCMD=rotate; shift; } || SUBCMD=init
[[ "${1:-}" == "init" ]] && shift

ROTATE_TARGETS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --preset) SEL_PRESETS+=("$2"); shift 2 ;;
    --profiles) PROFILES="$2"; shift 2 ;;
    --backend-workers) BACKEND_WORKERS="$2"; shift 2 ;;
    --celery-concurrency) CELERY_CONCURRENCY="$2"; shift 2 ;;
    --regenerate-secrets) REGEN=true; shift ;;
    --no-up) NO_UP=true; shift ;;
    -y|--yes) ASSUME_YES=true; shift ;;
    --fernet|--postgres|--minio|--redis|--secret-key|--all) ROTATE_TARGETS+=("$1"); shift ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

if [[ "$SUBCMD" == "rotate" ]]; then
  if [[ ${#ROTATE_TARGETS[@]} -eq 0 ]]; then
    [[ -f "$ENV_FILE" ]] || die "No $ENV_FILE — run ./setup.sh first."
    rotate_menu
  else
    do_rotate
  fi
else
  do_init
fi
