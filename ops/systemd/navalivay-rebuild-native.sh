#!/usr/bin/env bash
# Self-healing prestart hook for navalivay-server.
#
# Why this exists:
#   `better-sqlite3` (and other native node modules) are compiled against a
#   specific Node.js ABI (NODE_MODULE_VERSION). When the host upgrades Node
#   (e.g. via unattended-upgrades on the NodeSource repo), the prebuilt
#   .node file becomes incompatible and the service crash-loops with
#   ERR_DLOPEN_FAILED. apt-mark hold is the primary defense, but this
#   script is a belt-and-suspenders fallback so a missed pin can never
#   take prod down: we detect the mismatch and rebuild before ExecStart.
#
# Behavior:
#   - Fast path: try to require() each native module. If all load, exit 0
#     immediately (zero overhead on healthy boots).
#   - Slow path: on ERR_DLOPEN_FAILED, run `npm rebuild` for the offending
#     modules. Log loudly to journal so the incident is visible.
#
# Safe to run repeatedly. Never exits non-zero on transient errors that
# would block startup; we'd rather let ExecStart surface the real failure.

set -u

SERVER_DIR="/var/www/NAVALIVAY/server"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
NPM_BIN="${NPM_BIN:-/usr/bin/npm}"

# Each entry: "<package>:<canonical-binary-path-relative-to-package-root>".
# Listing the exact binary (not a glob) lets us ignore sibling artifacts
# like better-sqlite3's `test_extension.node`, which legitimately fails
# to dlopen on its own and would otherwise cause false-positive rebuilds.
NATIVE_MODULES=(
  "better-sqlite3:build/Release/better_sqlite3.node"
)

cd "$SERVER_DIR" || {
  echo "[prestart] WARN: $SERVER_DIR not found, skipping native check" >&2
  exit 0
}

needs_rebuild=()
for entry in "${NATIVE_MODULES[@]}"; do
  mod="${entry%%:*}"
  rel="${entry#*:}"
  bin_path="node_modules/$mod/$rel"

  # Stage A: dlopen() only the canonical binary under the *current* Node.
  # Avoid glob-loading every .node in build/Release because some packages
  # ship sibling artifacts (e.g. better-sqlite3 ships test_extension.node)
  # that fail dlopen on purpose.
  glob_check=$("$NODE_BIN" -e "
    const fs=require('fs'),path=require('path');
    const p=path.resolve('$bin_path');
    if(!fs.existsSync(p)){console.log('MISSING'); process.exit(0);}
    try{ process.dlopen({exports:{}}, p); }
    catch(e){
      // Module did not self-register is the expected error for an
      // ABI-compatible native addon when loaded outside its own require().
      // Treat it as 'binary is fine, init logic must run via require()'.
      if(/Module did not self-register/i.test(e.message)){console.log('OK_SELFREG'); process.exit(0);}
      console.log('DLOPEN_FAIL:'+e.message); process.exit(0);
    }
    console.log('OK');
  " 2>&1)

  # Stage B: even if Stage A is OK, run the package's own require() once,
  # so we catch JS-side init failures the binary check can't see.
  require_err=""
  if ! "$NODE_BIN" -e "require('$mod')" >/dev/null 2>"/tmp/navalivay-native-${mod}.err"; then
    require_err=$(cat "/tmp/navalivay-native-${mod}.err" 2>/dev/null || true)
  fi
  rm -f "/tmp/navalivay-native-${mod}.err"

  case "$glob_check" in
    OK|OK_SELFREG)
      if [ -z "$require_err" ]; then
        : # healthy
      elif echo "$require_err" | grep -qE 'ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|was compiled against|Could not locate the bindings file|Cannot find module.*\.node|invalid ELF|file too short|wrong ELF class'; then
        echo "[prestart] $mod require() failed in a way npm rebuild fixes" >&2
        echo "[prestart] $require_err" >&2
        needs_rebuild+=("$mod")
      else
        echo "[prestart] $mod load error (not auto-fixable), letting ExecStart handle it:" >&2
        echo "[prestart] $require_err" >&2
      fi
      ;;
    MISSING)
      echo "[prestart] $mod canonical binary missing ($bin_path), rebuilding" >&2
      needs_rebuild+=("$mod")
      ;;
    DLOPEN_FAIL:*)
      echo "[prestart] $mod canonical binary will not dlopen under current Node, rebuilding" >&2
      echo "[prestart] ${glob_check#DLOPEN_FAIL:}" >&2
      needs_rebuild+=("$mod")
      ;;
    *)
      echo "[prestart] $mod canonical-binary check returned unexpected output: $glob_check" >&2
      ;;
  esac
done

if [ "${#needs_rebuild[@]}" -eq 0 ]; then
  exit 0
fi

echo "[prestart] rebuilding native modules: ${needs_rebuild[*]}" >&2
if "$NPM_BIN" rebuild "${needs_rebuild[@]}" >&2; then
  echo "[prestart] rebuild OK for: ${needs_rebuild[*]}" >&2
else
  echo "[prestart] rebuild FAILED, ExecStart will likely fail and surface the real error" >&2
fi

exit 0
