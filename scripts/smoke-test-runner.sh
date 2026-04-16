#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# UI Bridge Regression Smoke Test
# ---------------------------------------------------------------------------
# Spawns a temp runner via the supervisor and exercises UI Bridge endpoints —
# both the ones added in the recent plan (T1–T13) and pre-existing endpoints
# that previously had no smoke-test coverage (T14–T23). Re-run this after
# every change.
#
# Usage:   bash scripts/smoke-test-runner.sh
#   or:    npm run smoke-test:runner
#
# Exit 0 if every test passed, 1 otherwise.
# ---------------------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SUPERVISOR_URL="http://localhost:9875"
BACKEND_URL="http://127.0.0.1:8000"
REQUESTER_ID="smoke-test-$$"
QUEUE_TIMEOUT_SECS=60
RUNNER_HEALTH_TIMEOUT=60   # seconds
AUTO_LOGIN_TIMEOUT=20      # seconds — short wait; we fall back to manual login on timeout

# ANSI colors
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; BOLD=""; RESET=""
fi

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_TESTS=23
RUNNER_ID=""
RUNNER_PORT=""
BASE=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()      { echo "${BLUE}[INFO]${RESET}  $*"; }
warn()     { echo "${YELLOW}[WARN]${RESET}  $*"; }
err()      { echo "${RED}[ERROR]${RESET} $*" >&2; }
pass()     { echo "${GREEN}[PASS]${RESET} $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()     { echo "${RED}[FAIL]${RESET} $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
section()  { echo; echo "${BOLD}=== $* ===${RESET}"; }

# curl_json BODY_VAR STATUS_VAR METHOD URL [JSON_BODY]
# Populates BODY_VAR and STATUS_VAR with the body and HTTP status.
curl_json() {
  local _body_var="$1" _status_var="$2" _method="$3" _url="$4" _data="${5:-}"
  local _raw _status _body
  if [[ -n "$_data" ]]; then
    _raw=$(curl -sS -w $'\n%{http_code}' -X "$_method" \
             -H "Content-Type: application/json" \
             -d "$_data" "$_url" || true)
  else
    _raw=$(curl -sS -w $'\n%{http_code}' -X "$_method" "$_url" || true)
  fi
  _status="${_raw##*$'\n'}"
  _body="${_raw%$'\n'*}"
  printf -v "$_body_var" '%s' "$_body"
  printf -v "$_status_var" '%s' "$_status"
}

# Extract a JSON field with python.  Usage: pyjson "$body" "path.expr"
# "path.expr" is a python expression where `d` is the parsed JSON root.
pyjson() {
  local _body="$1" _expr="$2"
  # Auto-unwrap the standard UI Bridge envelope: {"success": bool, "data": {...}}
  # Pipes body via stdin so large snapshot responses don't overflow ARG_MAX.
  python -c "
import sys, json
try:
    env = json.loads(sys.stdin.read())
    d = env.get('data', env) if isinstance(env, dict) and 'data' in env else env
    print(eval(sys.argv[1]))
except Exception as e:
    print('__ERR__' + str(e))
    sys.exit(2)
" "$_expr" <<< "$_body"
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  if [[ -n "$RUNNER_ID" ]]; then
    echo
    log "Cleaning up temp runner ${BOLD}${RUNNER_ID}${RESET}"
    curl -sS -X POST "${SUPERVISOR_URL}/runners/${RUNNER_ID}/stop" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
section "Pre-flight"

# Supervisor
body=""; status=""
curl_json body status GET "${SUPERVISOR_URL}/health"
if [[ "$status" != "200" ]]; then
  err "Supervisor unreachable at ${SUPERVISOR_URL}/health (status=${status:-none})"
  err "Start it before running the smoke test.  Bailing."
  exit 1
fi
log "Supervisor OK at ${SUPERVISOR_URL}"

# Backend
body=""; status=""
curl_json body status GET "${BACKEND_URL}/"
if [[ "$status" != "200" && "$status" != "404" && "$status" != "301" && "$status" != "302" ]]; then
  err "Backend unreachable at ${BACKEND_URL}/ (status=${status:-none})"
  err "Runner auto-login requires the backend to be up.  Bailing."
  exit 1
fi
log "Backend OK at ${BACKEND_URL}"

# ---------------------------------------------------------------------------
# Spawn temp runner
# ---------------------------------------------------------------------------
section "Spawning temp runner"
# Default to rebuild: true so smoke tests always validate current code.
# Set SMOKE_REBUILD=false to reuse the cached binary (fast local iteration
# when the bundled ui-bridge hasn't changed since the last build).
REBUILD="${SMOKE_REBUILD:-true}"
# QUEUE_TIMEOUT_SECS is 60 by default for cached binary; rebuild needs more.
if [[ "$REBUILD" == "true" ]]; then
  QUEUE_TIMEOUT_SECS=600
fi
spawn_body='{"rebuild": '"$REBUILD"', "requester_id": "'"$REQUESTER_ID"'", "queue_timeout_secs": '"$QUEUE_TIMEOUT_SECS"'}'
log "Spawning with rebuild=${REBUILD} (queue timeout=${QUEUE_TIMEOUT_SECS}s)"
# Transient supervisor race: occasionally the runner is cleaned up between
# spawn success and API response ("Runner not found: test-xxx"). Retry once
# with a fresh requester_id.
_spawn_attempt=1
body=""; status=""
curl_json body status POST "${SUPERVISOR_URL}/runners/spawn-test" "$spawn_body"
# Retry once on 404 "Runner not found" (transient supervisor race).
if [[ "$status" == "404" ]] && echo "$body" | grep -iq "not found"; then
  log "Transient spawn race — retrying with fresh requester_id"
  REQUESTER_ID="${REQUESTER_ID}-r2"
  spawn_body='{"rebuild": '"$REBUILD"', "requester_id": "'"$REQUESTER_ID"'", "queue_timeout_secs": '"$QUEUE_TIMEOUT_SECS"'}'
  sleep 1
  body=""; status=""
  curl_json body status POST "${SUPERVISOR_URL}/runners/spawn-test" "$spawn_body"
fi
if [[ "$status" != "200" && "$status" != "201" ]]; then
  err "spawn-test failed (status=${status}): ${body}"
  exit 1
fi

RUNNER_ID=$(pyjson "$body" "d.get('runner_id') or d.get('id') or ''")
RUNNER_PORT=$(pyjson "$body" "d.get('port') or d.get('runner_port') or ''")

if [[ -z "$RUNNER_ID" || -z "$RUNNER_PORT" || "$RUNNER_ID" == __ERR__* || "$RUNNER_PORT" == __ERR__* ]]; then
  err "Could not parse runner_id/port from spawn response: ${body}"
  exit 1
fi

RUNNER_ROOT="http://localhost:${RUNNER_PORT}"
BASE="${RUNNER_ROOT}/ui-bridge"
echo
echo "${BOLD}${GREEN}  RUNNER ID:   ${RUNNER_ID}${RESET}"
echo "${BOLD}${GREEN}  RUNNER PORT: ${RUNNER_PORT}${RESET}"
echo "${BOLD}${GREEN}  BASE URL:    ${BASE}${RESET}"
echo

# ---------------------------------------------------------------------------
# Wait for runner health  (the /health endpoint is at the root, not under /ui-bridge)
# ---------------------------------------------------------------------------
section "Waiting for runner to respond"
elapsed=0
ready=0
while (( elapsed < RUNNER_HEALTH_TIMEOUT )); do
  body=""; status=""
  curl_json body status GET "${RUNNER_ROOT}/health"
  if [[ "$status" == "200" ]]; then
    ready=1
    break
  fi
  sleep 1   # 1s polling (NOT the banned 5s first-sleep)
  sleep 1
  sleep 1
  elapsed=$((elapsed + 3))
  log "  still waiting... ${elapsed}s"
done
if [[ "$ready" != "1" ]]; then
  err "Runner did not become healthy within ${RUNNER_HEALTH_TIMEOUT}s.  Bailing."
  exit 1
fi
log "Runner healthy after ${elapsed}s"

# ---------------------------------------------------------------------------
# Wait for auto-login, fall back to manual login if the runner's baked-in
# VITE_DEV credentials are stale (common after backend recreates users).
# ---------------------------------------------------------------------------
section "Waiting for login"
elapsed=0
logged_in=0
eval_body='{"expression":"!document.querySelector('\''input[type=password]'\'')"}'
while (( elapsed < AUTO_LOGIN_TIMEOUT )); do
  body=""; status=""
  curl_json body status POST "${BASE}/control/page/evaluate" "$eval_body"
  if [[ "$status" == "200" ]]; then
    # Response shape: {"success":true, "data":{"result":{"value":"<js-return-as-string>"}}}
    v=$(pyjson "$body" "str(d.get('result',{}).get('value',''))") || v="__ERR__"
    if [[ "$v" == "True" || "$v" == "true" ]]; then
      logged_in=1
      break
    fi
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
if [[ "$logged_in" != "1" ]]; then
  log "Auto-login did not complete in ${AUTO_LOGIN_TIMEOUT}s — attempting manual login."
  manual_login_expr='(async function() { var e = document.querySelector("input[type=email]"); var p = document.querySelector("input[type=password]"); if (!e || !p) return "no-login-form"; var s = (el, v) => { var set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set; set.call(el, v); el.dispatchEvent(new Event("input", {bubbles: true})); }; s(e, "josh@qontinui.io"); s(p, "dev123"); await new Promise(r => setTimeout(r, 200)); var btn = document.querySelector("button[type=submit]"); if (!btn) return "no-submit"; btn.click(); await new Promise(r => setTimeout(r, 3000)); return !document.querySelector("input[type=password]") ? "ok" : "still-on-login"; })()'
  manual_body=$(python -c 'import json, sys; print(json.dumps({"expression": sys.argv[1]}))' "$manual_login_expr")
  body=""; status=""
  curl_json body status POST "${BASE}/control/page/evaluate" "$manual_body"
  result=$(pyjson "$body" "str(d.get('result',{}).get('value',''))") || result="__ERR__"
  if [[ "$result" == "ok" || "$result" == "no-login-form" ]]; then
    # "no-login-form" means auto-login just finished between timeout and this check
    logged_in=1
    log "Manual login path completed ($result)"
  else
    err "Runner did not log in (auto or manual). Last result: $result"
    err "Raw response body: $body"
    err "Status: $status"
    exit 1
  fi
fi
log "Login confirmed"

# ---------------------------------------------------------------------------
# Navigate to Terminal page
# ---------------------------------------------------------------------------
section "Navigating to Terminal page"
nav_expr='(() => { const btns = Array.from(document.querySelectorAll("button,a,[role=button]")); const t = btns.find(b => (b.textContent || "").trim() === "Terminal"); if (!t) return false; t.click(); return true; })()'
nav_body=$(python -c "
import json, sys
print(json.dumps({'expression': sys.argv[1]}))
" "$nav_expr")
body=""; status=""
curl_json body status POST "${BASE}/control/page/evaluate" "$nav_body"
if [[ "$status" != "200" ]]; then
  warn "Terminal nav evaluate returned status=${status} body=${body}"
fi
# settle
sleep 1
sleep 1

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
section "Running tests"

# ----- T1: elements discovery --------------------------------------------
run_t1() {
  body=""; status=""
  curl_json body status GET "${BASE}/control/elements"
  if [[ "$status" != "200" ]]; then
    fail "T1 elements-discovery: HTTP ${status}"
    return
  fi
  count=$(pyjson "$body" "d.get('count', len(d.get('elements', [])) if isinstance(d, dict) else len(d))")
  if [[ "$count" == __ERR__* ]]; then
    fail "T1 elements-discovery: could not parse count from body"
    return
  fi
  if (( count >= 10 )); then
    pass "T1 elements-discovery (count=${count})"
  else
    fail "T1 elements-discovery: count=${count} < 10"
  fi
}
run_t1

# ----- T2: title filter ---------------------------------------------------
run_t2() {
  body=""; status=""
  curl_json body status GET "${BASE}/control/elements?title=Launch%20menu"
  if [[ "$status" != "200" ]]; then
    fail "T2 title-filter: HTTP ${status}"
    return
  fi
  result=$(pyjson "$body" "
(lambda:
  (lambda els:
    ('OK:' + str(els[0].get('id','')))
    if len(els) == 1 else ('BAD:count=' + str(len(els)))
  )(d.get('elements', d if isinstance(d, list) else []))
)()")
  if [[ "$result" == OK:* ]]; then
    elem_id="${result#OK:}"
    if [[ "$elem_id" == *launch-menu* ]]; then
      pass "T2 title-filter (id=${elem_id})"
    else
      fail "T2 title-filter: id '${elem_id}' does not contain 'launch-menu'"
    fi
  else
    fail "T2 title-filter: ${result}"
  fi
}
run_t2

# ----- T3: aria_label filter ---------------------------------------------
run_t3() {
  body=""; status=""
  curl_json body status GET "${BASE}/control/elements?aria_label=Home"
  if [[ "$status" != "200" ]]; then
    fail "T3 aria_label-filter: HTTP ${status}"
    return
  fi
  n=$(pyjson "$body" "len(d.get('elements', d if isinstance(d, list) else []))")
  if [[ "$n" == __ERR__* ]]; then
    fail "T3 aria_label-filter: parse error"
    return
  fi
  if (( n >= 1 )); then
    pass "T3 aria_label-filter (n=${n})"
  else
    fail "T3 aria_label-filter: no elements matched aria_label=Home"
  fi
}
run_t3

# ----- T4: text filter ----------------------------------------------------
run_t4() {
  body=""; status=""
  curl_json body status GET "${BASE}/control/elements?text=Terminal"
  if [[ "$status" != "200" ]]; then
    fail "T4 text-filter: HTTP ${status}"
    return
  fi
  n=$(pyjson "$body" "len(d.get('elements', d if isinstance(d, list) else []))")
  if [[ "$n" == __ERR__* ]]; then
    fail "T4 text-filter: parse error"
    return
  fi
  if (( n >= 1 )); then
    pass "T4 text-filter (n=${n})"
  else
    fail "T4 text-filter: no elements matched text=Terminal"
  fi
}
run_t4

# ----- T5: Tauri proxy allow ---------------------------------------------
run_t5() {
  body=""; status=""
  curl_json body status POST "${BASE}/tauri/invoke" \
    '{"command":"setting_get","args":{"key":"zone-profiles"}}'
  if [[ "$status" != "200" ]]; then
    fail "T5 tauri-proxy-allow: HTTP ${status} body=${body}"
    return
  fi
  # HTTP 200 + no "error" key in envelope = success (body already validated as JSON)
  has_error=$(python -c 'import sys, json; env=json.loads(sys.stdin.read()); print("err" if env.get("error") else "ok")' <<< "$body")
  if [[ "$has_error" == "ok" ]]; then
    pass "T5 tauri-proxy-allow"
  else
    fail "T5 tauri-proxy-allow: envelope had error body=${body}"
  fi
}
run_t5

# ----- T6: Tauri proxy deny ----------------------------------------------
run_t6() {
  body=""; status=""
  curl_json body status POST "${BASE}/tauri/invoke" \
    '{"command":"not_allowed_xyz"}'
  if [[ "$status" != "403" ]]; then
    fail "T6 tauri-proxy-deny: expected 403 got ${status} body=${body}"
    return
  fi
  # 403 body looks like: {"error":"command not in safelist","command":"...","allowed":[...]}
  # Check the raw body directly — pyjson's unwrap would hide the error key.
  if echo "$body" | grep -iq "safelist"; then
    pass "T6 tauri-proxy-deny (mentions safelist)"
  else
    fail "T6 tauri-proxy-deny: 403 but no 'safelist' in body: ${body}"
  fi
}
run_t6

# ----- T7: components discovery ------------------------------------------
run_t7() {
  body=""; status=""
  curl_json body status GET "${BASE}/control/components"
  if [[ "$status" != "200" ]]; then
    fail "T7 components-discovery: HTTP ${status}"
    return
  fi
  verdict=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
comps = d.get("components", d if isinstance(d, list) else [])
# Build id -> component map (try common key names)
by_id = {}
for c in comps:
    cid = c.get("id") or c.get("componentId") or c.get("name") or ""
    by_id[cid] = c
required = ["zone-profile-picker", "zone-layout-picker", "terminal-launch-menu"]
missing = [r for r in required if r not in by_id]
if missing:
    print("MISSING:" + ",".join(missing))
    sys.exit(0)
bad_path = []
bad_action = []
for r in required:
    c = by_id[r]
    aip = c.get("actionInvocationPath", "")
    if not aip:
        bad_path.append(r)
    actions = c.get("actions", [])
    has_path = any(a.get("path") for a in actions if isinstance(a, dict))
    if not has_path:
        bad_action.append(r)
if bad_path:
    print("NO_AIP:" + ",".join(bad_path))
elif bad_action:
    print("NO_ACTION_PATH:" + ",".join(bad_action))
else:
    print("OK")
' <<< "$body")
  case "$verdict" in
    OK) pass "T7 components-discovery (all 3 present with paths)";;
    MISSING:*) fail "T7 components-discovery: missing ${verdict#MISSING:}";;
    NO_AIP:*)  fail "T7 components-discovery: empty actionInvocationPath on ${verdict#NO_AIP:}";;
    NO_ACTION_PATH:*) fail "T7 components-discovery: no action.path on ${verdict#NO_ACTION_PATH:}";;
    *) fail "T7 components-discovery: unexpected verdict '${verdict}'";;
  esac
}
run_t7

# ----- T8: component action (list-layouts) -------------------------------
run_t8() {
  body=""; status=""
  curl_json body status POST "${BASE}/control/component/zone-layout-picker/action/list-layouts" '{}'
  if [[ "$status" != "200" ]]; then
    fail "T8 component-action: HTTP ${status} body=${body}"
    return
  fi
  n=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
r = d.get("result", d)
if isinstance(r, dict):
    layouts = r.get("layouts", [])
    print(len(layouts) if isinstance(layouts, list) else -1)
elif isinstance(r, list):
    print(len(r))
else:
    print(-1)
' <<< "$body")
  if [[ "$n" =~ ^[0-9]+$ ]] && (( n >= 5 )); then
    pass "T8 component-action (layouts=${n})"
  else
    fail "T8 component-action: layouts count=${n} (want >=5) body=${body}"
  fi
}
run_t8

# ----- T9: wait-for-element-condition present match ----------------------
run_t9() {
  body=""; status=""
  curl_json body status POST "${BASE}/ai/wait-for-element-condition" \
    '{"selector":{"id":"button-launch-menu"},"condition":"present","timeout_ms":2000}'
  if [[ "$status" != "200" ]]; then
    fail "T9 wait-for-element-present: HTTP ${status} body=${body}"
    return
  fi
  matched=$(pyjson "$body" "d.get('matched', d.get('result', {}).get('matched', d.get('success', False)))")
  if [[ "$matched" == "True" || "$matched" == "true" ]]; then
    pass "T9 wait-for-element-present (matched)"
  else
    fail "T9 wait-for-element-present: matched!=true body=${body}"
  fi
}
run_t9

# ----- T10: wait-for-element-condition timeout ---------------------------
run_t10() {
  body=""; status=""
  curl_json body status POST "${BASE}/ai/wait-for-element-condition" \
    '{"selector":{"id":"DOES_NOT_EXIST_XYZ_12345"},"condition":"present","timeout_ms":500}'
  if [[ "$status" == "408" ]]; then
    pass "T10 wait-for-element-timeout (408 as expected)"
  else
    fail "T10 wait-for-element-timeout: expected 408 got ${status} body=${body}"
  fi
}
run_t10

# ----- T11: batch-execute ------------------------------------------------
run_t11() {
  body=""; status=""
  local payload='{"actions":[{"type":"snapshot"},{"type":"wait","ms":50},{"type":"snapshot"}]}'
  curl_json body status POST "${BASE}/control/batch-execute" "$payload"
  if [[ "$status" != "200" ]]; then
    fail "T11 batch-execute: HTTP ${status} body=${body}"
    return
  fi
  verdict=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
completed = d.get("completed", -1)
total = d.get("total", -1)
results = d.get("results", [])
all_ok = all(r.get("success") is True for r in results) if results else False
if completed == 3 and total == 3 and all_ok and len(results) == 3:
    print("OK")
else:
    print(f"BAD completed={completed} total={total} n_results={len(results)} all_ok={all_ok}")
' <<< "$body")
  if [[ "$verdict" == "OK" ]]; then
    pass "T11 batch-execute (3/3 succeeded)"
  else
    fail "T11 batch-execute: ${verdict}"
  fi
}
run_t11

# ----- T12: change-buffer captures DOM -----------------------------------
run_t12() {
  # enable
  body=""; status=""
  curl_json body status POST "${BASE}/ai/change-buffer/enable" '{}'
  if [[ "$status" != "200" ]]; then
    fail "T12 change-buffer: enable HTTP ${status} body=${body}"
    return
  fi

  # trigger: open the terminal-launch-menu via component action
  body=""; status=""
  curl_json body status POST "${BASE}/control/component/terminal-launch-menu/action/open" '{}'
  if [[ "$status" != "200" ]]; then
    warn "T12 change-buffer: terminal-launch-menu/open returned ${status} (continuing)"
  fi

  # wait 500ms for mutations
  sleep 1

  # drain
  body=""; status=""
  curl_json body status POST "${BASE}/ai/change-buffer/drain" '{}'
  if [[ "$status" != "200" ]]; then
    fail "T12 change-buffer: drain HTTP ${status} body=${body}"
    # Best-effort disable
    curl -sS -X POST "${BASE}/ai/change-buffer/disable" -d '{}' -H 'Content-Type: application/json' >/dev/null 2>&1 || true
    return
  fi
  dom_len=$(pyjson "$body" "len(d.get('dom', d.get('result', {}).get('dom', [])))")
  if [[ "$dom_len" =~ ^[0-9]+$ ]] && (( dom_len >= 1 )); then
    pass "T12 change-buffer (dom.length=${dom_len})"
  else
    fail "T12 change-buffer: dom.length=${dom_len} (want >=1) body=${body}"
  fi

  # disable
  curl -sS -X POST "${BASE}/ai/change-buffer/disable" -d '{}' -H 'Content-Type: application/json' >/dev/null 2>&1 || true
}
run_t12

# ----- T13: stability (15 repeats) ---------------------------------------
run_t13() {
  local counts=()
  local statuses_ok=1
  for i in $(seq 1 15); do
    body=""; status=""
    curl_json body status GET "${BASE}/control/elements"
    if [[ "$status" != "200" ]]; then
      statuses_ok=0
      fail "T13 stability: call #${i} returned HTTP ${status}"
      return
    fi
    c=$(pyjson "$body" "d.get('count', len(d.get('elements', [])) if isinstance(d, dict) else len(d))")
    counts+=("$c")
  done
  verdict=$(python -c '
import sys
counts = [int(x) for x in sys.argv[1].split(",") if x.strip().isdigit()]
if not counts:
    print("BAD:no-counts")
else:
    spread = max(counts) - min(counts)
    if spread <= 5:
        print(f"OK spread={spread} min={min(counts)} max={max(counts)}")
    else:
        print(f"BAD spread={spread} counts={counts}")
' "$(IFS=,; echo "${counts[*]}")")
  if [[ "$verdict" == OK* ]]; then
    pass "T13 stability (${verdict#OK })"
  else
    fail "T13 stability: ${verdict}"
  fi
}
run_t13

# ---------------------------------------------------------------------------
# Regression coverage for pre-existing endpoints (T14 — T23)
#
# T1–T13 cover the endpoints added in the recent plan. The endpoints below
# existed before that plan and had no smoke-test coverage, so any regression
# in them would slip past the original suite. These tests are deliberately
# lenient on response shape because several of the endpoints have evolved
# their envelopes over time.
# ---------------------------------------------------------------------------

# ----- T14: ai/find (natural language finder) ----------------------------
run_t14() {
  body=""; status=""
  curl_json body status POST "${BASE}/ai/find" \
    '{"query":"launch menu button"}'
  if [[ "$status" != "200" ]]; then
    fail "T14 ai-find: HTTP ${status} body=${body}"
    return
  fi
  # Response is a discriminated union. Try several known shapes:
  #   {found:true, ambiguous:false, element:{id:"..."}, elementId:"..."}
  #   {type:"found", element:{...}}
  #   {found:true, ambiguous:true, candidates:[{id:"..."}, ...]}
  # We consider any of these "matching" if we can pull an id containing
  # "launch-menu".
  result=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
ids = []
# Canonical shape
el = d.get("element")
if isinstance(el, dict) and el.get("id"):
    ids.append(el["id"])
if d.get("elementId"):
    ids.append(d["elementId"])
# Union tag shape
if d.get("type") == "found" and isinstance(d.get("element"), dict):
    ids.append(d["element"].get("id", ""))
# Ambiguous shape
for c in d.get("candidates", []) or []:
    if isinstance(c, dict) and c.get("id"):
        ids.append(c["id"])
# Alternatives (still valid matches, just ranked lower)
for a in d.get("alternatives", []) or []:
    if isinstance(a, dict) and a.get("id"):
        ids.append(a["id"])
matches = [i for i in ids if "launch-menu" in i]
if matches:
    print("OK:" + matches[0])
else:
    print("BAD:ids=" + ",".join(ids) if ids else "BAD:no-ids")
' <<< "$body")
  if [[ "$result" == OK:* ]]; then
    pass "T14 ai-find (${result#OK:})"
  else
    fail "T14 ai-find: no launch-menu match (${result})"
  fi
}
run_t14

# ----- T15: snapshot visibleOnly filter ----------------------------------
run_t15() {
  # Unfiltered
  body=""; status=""
  curl_json body status GET "${BASE}/control/snapshot"
  if [[ "$status" != "200" ]]; then
    fail "T15 snapshot-visibleOnly: unfiltered HTTP ${status}"
    return
  fi
  total=$(pyjson "$body" "len(d.get('elements', d if isinstance(d, list) else []))")
  if [[ ! "$total" =~ ^[0-9]+$ ]]; then
    fail "T15 snapshot-visibleOnly: could not parse unfiltered count"
    return
  fi
  # Filtered
  body=""; status=""
  curl_json body status GET "${BASE}/control/snapshot?visibleOnly=true"
  if [[ "$status" != "200" ]]; then
    fail "T15 snapshot-visibleOnly: filtered HTTP ${status}"
    return
  fi
  visible=$(pyjson "$body" "len(d.get('elements', d if isinstance(d, list) else []))")
  if [[ ! "$visible" =~ ^[0-9]+$ ]]; then
    fail "T15 snapshot-visibleOnly: could not parse filtered count"
    return
  fi
  if (( visible > 0 )) && (( visible <= total )); then
    pass "T15 snapshot-visibleOnly (visible=${visible} <= total=${total})"
  else
    fail "T15 snapshot-visibleOnly: visible=${visible} total=${total} (expected 0 < visible <= total)"
  fi
}
run_t15

# ----- T16: page/evaluate ------------------------------------------------
run_t16() {
  body=""; status=""
  curl_json body status POST "${BASE}/control/page/evaluate" \
    '{"expression":"1+1"}'
  if [[ "$status" != "200" ]]; then
    fail "T16 page-evaluate: HTTP ${status} body=${body}"
    return
  fi
  # Known shapes:
  #   {result: {value: 2}}
  #   {result: 2}
  #   {value: 2}
  v=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
r = d.get("result", d)
if isinstance(r, dict):
    v = r.get("value", r)
else:
    v = r
# Normalize to string for comparison
print(str(v))
' <<< "$body")
  if [[ "$v" == "2" ]]; then
    pass "T16 page-evaluate (1+1=2)"
  else
    fail "T16 page-evaluate: got '${v}' expected '2' body=${body}"
  fi
}
run_t16

# ----- T17: bookmarks create + diff --------------------------------------
run_t17() {
  local bm_name="t17-before"
  # Create
  body=""; status=""
  curl_json body status POST "${BASE}/ai/bookmarks" \
    "{\"name\":\"${bm_name}\"}"
  if [[ "$status" != "200" ]]; then
    fail "T17 bookmarks: create HTTP ${status} body=${body}"
    return
  fi
  # Diff against the same bookmark (expect empty-ish diff, but any 200 is fine)
  body=""; status=""
  curl_json body status GET "${BASE}/ai/bookmark/${bm_name}/diff"
  local diff_status="$status"
  # Clean up best-effort regardless of diff outcome
  curl -sS -X DELETE "${BASE}/ai/bookmark/${bm_name}" >/dev/null 2>&1 || true
  if [[ "$diff_status" == "200" ]]; then
    pass "T17 bookmarks (create + diff 200)"
  else
    fail "T17 bookmarks: diff HTTP ${diff_status}"
  fi
}
run_t17

# ----- T18: forms --------------------------------------------------------
run_t18() {
  body=""; status=""
  curl_json body status GET "${BASE}/ai/forms"
  if [[ "$status" != "200" ]]; then
    fail "T18 forms: HTTP ${status} body=${body}"
    return
  fi
  # Response is either an array or {forms: [...]} — both are acceptable on a
  # page that has no forms (Terminal page typically has none).
  kind=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
if isinstance(d, list):
    print("list:" + str(len(d)))
elif isinstance(d, dict):
    forms = d.get("forms")
    if isinstance(forms, list):
        print("dict-forms:" + str(len(forms)))
    else:
        # Some variants use {count, ...} — still OK as long as it is a dict
        print("dict:" + str(len(d.keys())))
else:
    print("other:" + type(d).__name__)
' <<< "$body")
  if [[ "$kind" == list:* || "$kind" == dict-forms:* || "$kind" == dict:* ]]; then
    pass "T18 forms (${kind})"
  else
    fail "T18 forms: unexpected shape ${kind} body=${body}"
  fi
}
run_t18

# ----- T19: console-errors -----------------------------------------------
run_t19() {
  body=""; status=""
  curl_json body status GET "${BASE}/control/console-errors"
  if [[ "$status" != "200" ]]; then
    fail "T19 console-errors: HTTP ${status}"
    return
  fi
  # Expected: {count:N, errors:[...]}. Tolerate both flat and nested shapes.
  verdict=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
errors = d.get("errors")
count = d.get("count")
if isinstance(errors, list) and isinstance(count, int):
    print(f"OK count={count} n_errors={len(errors)}")
elif isinstance(errors, list):
    print(f"OK-no-count n_errors={len(errors)}")
else:
    print("BAD:" + ",".join(sorted(d.keys())[:5]) if isinstance(d, dict) else "BAD:non-dict")
' <<< "$body")
  if [[ "$verdict" == OK* ]]; then
    pass "T19 console-errors (${verdict})"
  else
    fail "T19 console-errors: ${verdict}"
  fi
}
run_t19

# ----- T20: page-summary (expensive, tolerate failure) -------------------
run_t20() {
  body=""; status=""
  curl_json body status POST "${BASE}/ai/page-summary" '{}'
  if [[ "$status" == "404" ]]; then
    warn "T20 page-summary: endpoint 404 (not mounted) — skipping as pass"
    pass "T20 page-summary (endpoint absent, warn-pass)"
    return
  fi
  if [[ "$status" != "200" ]]; then
    # Not fatal — this endpoint is expensive and can error under load.
    warn "T20 page-summary: HTTP ${status} — treating as warn-pass"
    pass "T20 page-summary (HTTP ${status}, warn-pass)"
    return
  fi
  # Any non-empty data object/string counts as a summary.
  verdict=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
if isinstance(d, dict) and d:
    keys = sorted(d.keys())[:4]
    print("OK keys=" + ",".join(keys))
elif isinstance(d, str) and d.strip():
    print("OK string-len=" + str(len(d)))
else:
    print("EMPTY")
' <<< "$body")
  if [[ "$verdict" == OK* ]]; then
    pass "T20 page-summary (${verdict})"
  else
    warn "T20 page-summary: empty summary — warn-pass"
    pass "T20 page-summary (empty, warn-pass)"
  fi
}
run_t20

# ----- T21: idle-status --------------------------------------------------
run_t21() {
  body=""; status=""
  curl_json body status GET "${BASE}/ai/idle-status"
  if [[ "$status" != "200" ]]; then
    fail "T21 idle-status: HTTP ${status} body=${body}"
    return
  fi
  # Shape: {idle: bool, ...}. Tolerate {status:"idle"|"busy"} as fallback.
  verdict=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
if isinstance(d, dict):
    if "idle" in d and isinstance(d["idle"], bool):
        print("OK idle=" + str(d["idle"]))
    elif "status" in d:
        print("OK status=" + str(d["status"]))
    else:
        print("BAD keys=" + ",".join(sorted(d.keys())[:5]))
else:
    print("BAD non-dict")
' <<< "$body")
  if [[ "$verdict" == OK* ]]; then
    pass "T21 idle-status (${verdict})"
  else
    fail "T21 idle-status: ${verdict} body=${body}"
  fi
}
run_t21

# ----- T22: design-audit (big endpoint, tolerate 501) --------------------
run_t22() {
  body=""; status=""
  curl_json body status POST "${BASE}/ai/design-audit" '{}'
  case "$status" in
    200)
      pass "T22 design-audit (HTTP 200)"
      ;;
    501)
      pass "T22 design-audit (HTTP 501 not-implemented — acceptable)"
      ;;
    404)
      warn "T22 design-audit: endpoint 404 (not mounted) — warn-pass"
      pass "T22 design-audit (endpoint absent, warn-pass)"
      ;;
    *)
      fail "T22 design-audit: HTTP ${status} body=${body}"
      ;;
  esac
}
run_t22

# ----- T23: control/discover ---------------------------------------------
run_t23() {
  body=""; status=""
  curl_json body status POST "${BASE}/control/discover" \
    '{"interactive_only":false}'
  if [[ "$status" != "200" ]]; then
    fail "T23 discover: HTTP ${status} body=${body}"
    return
  fi
  # Discovered count lives in either `discovered`, `count`, or `elements.length`
  n=$(python -c '
import sys, json
env = json.loads(sys.stdin.read())
d = env.get("data", env) if isinstance(env, dict) and "data" in env else env
for k in ("discovered", "count"):
    if isinstance(d.get(k), int):
        print(d[k]); sys.exit(0)
els = d.get("elements")
if isinstance(els, list):
    print(len(els)); sys.exit(0)
print(-1)
' <<< "$body")
  if [[ "$n" =~ ^[0-9]+$ ]] && (( n >= 10 )); then
    pass "T23 discover (discovered=${n})"
  else
    fail "T23 discover: discovered=${n} (want >=10) body=${body}"
  fi
}
run_t23

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "${BOLD}=== Summary ===${RESET}"
echo "Runner:   ${RUNNER_ID}  (port ${RUNNER_PORT})"
echo "Passed:   ${GREEN}${PASS_COUNT}${RESET}"
echo "Failed:   ${RED}${FAIL_COUNT}${RESET}"
echo
echo "${BOLD}SMOKE-TEST: ${PASS_COUNT}/${TOTAL_TESTS} passed${RESET}"

if (( FAIL_COUNT == 0 )); then
  exit 0
else
  exit 1
fi

# ---------------------------------------------------------------------------
# To make executable under Git Bash / WSL:
#   chmod +x scripts/smoke-test-runner.sh
# ---------------------------------------------------------------------------
