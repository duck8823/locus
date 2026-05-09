#!/usr/bin/env bash
#
# diagnose_ui.sh — locus UI 自動診断ハーネス。
#
# LLM / オペレータが locus の terminal-only mode と diff viewer mode を
# 実機で起動し、以下のアーティファクトを out-dir に書き出すための入口。
#
#   app.log         child process (cargo build した debug binary) の stdout/stderr
#   build.log       cargo build の stdout/stderr (--no-build 時は省略)
#   command.txt     起動した argv と注入した環境変数
#   env.txt         スクリプト時点の環境変数 dump
#   perf_summary.txt LOCUS_LOG=debug が吐く主要 perf 行の grep カウント
#   screenshot.png  screencapture が使える環境では起動 N 秒後の画面
#   report.json     mode / command / env / duration / exit_status / paths / tools
#
# ふるまい:
#   - 既定で `cargo build` 実行 → `target/debug/locus ...` を子プロセスで起動。
#     app.log には locus 本体の出力のみが入るよう build ログは別ファイルに分ける。
#   - LOCUS_LOG=debug を強制注入。LOCUS_TERMINAL_DEBUG_GRID は既定で on にする
#     (--no-debug-grid で off)。terminal cell / font 系 override は --cell-w 等で
#     渡されたときだけ環境変数として子プロセスに渡す。
#   - DURATION 秒だけ動かしてから graceful (TERM → 待つ → KILL) で停止する。
#     起動した PID とその直接子プロセスのみを停止対象にし、無関係なプロセスを
#     殺さない。
#
# usage:
#   scripts/diagnose_ui.sh terminal [options]
#   scripts/diagnose_ui.sh github <owner/repo#PR> [options]
#
# options:
#   --duration SEC            起動後にスリープする秒数 (default 8)
#   --out-dir DIR             成果物を書き出すディレクトリ
#                             (default target/locus-diagnostics/<timestamp>)
#   --agent-cmd CMD           terminal mode で渡す agent CLI コマンド
#                             (default ${LOCUS_AGENT_CMD:-sh})
#   --debug-grid              LOCUS_TERMINAL_DEBUG_GRID=true を注入 (既定 on)
#   --no-debug-grid           LOCUS_TERMINAL_DEBUG_GRID を注入しない
#   --cell-w VALUE            LOCUS_TERMINAL_CELL_W override
#   --cell-h VALUE            LOCUS_TERMINAL_CELL_H override
#   --font-family VALUE       LOCUS_TERMINAL_FONT_FAMILY override
#   --terminal-font-size VAL  LOCUS_TERMINAL_FONT_SIZE override
#   --no-build                cargo build をスキップ (target/debug/locus 既存前提)
#   -h, --help                このヘルプ
#

set -uo pipefail

PROG="scripts/diagnose_ui.sh"

# ---- helpers ---------------------------------------------------------------

log() { printf '[diagnose_ui] %s\n' "$*" >&2; }

die() {
    log "error: $*"
    exit 2
}

usage() {
    cat <<'USAGE'
usage:
  scripts/diagnose_ui.sh terminal [options]
  scripts/diagnose_ui.sh github <owner/repo#PR> [options]

options:
  --duration SEC            起動後にスリープする秒数 (default 8)
  --out-dir DIR             成果物の出力ディレクトリ
                            (default target/locus-diagnostics/<timestamp>)
  --agent-cmd CMD           terminal mode で渡す agent CLI コマンド
                            (default ${LOCUS_AGENT_CMD:-sh})
  --debug-grid              LOCUS_TERMINAL_DEBUG_GRID=true (既定 on)
  --no-debug-grid           LOCUS_TERMINAL_DEBUG_GRID を注入しない
  --cell-w VALUE            LOCUS_TERMINAL_CELL_W override
  --cell-h VALUE            LOCUS_TERMINAL_CELL_H override
  --font-family VALUE       LOCUS_TERMINAL_FONT_FAMILY override
  --terminal-font-size VAL  LOCUS_TERMINAL_FONT_SIZE override
  --no-build                cargo build をスキップ
  -h, --help                ヘルプ
USAGE
}

# JSON 文字列を安全にエスケープする。python3 が無い環境向けの fallback。
# 戻り値は `""` で括った JSON string literal (空入力でも `""` を返す)。
# 入力には改行 / `\` / `"` のみ含まれる前提で扱う (notes / status などは
# それで十分)。タブや制御文字はそのまま通る — 厳密モードが必要なら python3。
json_escape_fallback() {
    local s="${1-}"
    local escaped
    escaped="$(
        printf '%s' "$s" \
            | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
            | awk 'BEGIN { ORS = "" } { if (NR > 1) printf "\\n"; printf "%s", $0 }'
    )"
    printf '"%s"' "$escaped"
}

# python3 があれば JSON 全体を組む。無ければ最小フォールバック。
write_report_json() {
    local report_path="$1"
    if [ -n "${HAS_PYTHON3_BIN:-}" ]; then
        REPORT_PATH="$report_path" \
        REPORT_MODE="$MODE" \
        REPORT_GITHUB_SPEC="$GITHUB_SPEC" \
        REPORT_AGENT_CMD="$AGENT_CMD" \
        REPORT_DURATION="$DURATION" \
        REPORT_OUT_DIR="$OUT_DIR" \
        REPORT_BIN="$BIN" \
        REPORT_BUILD_STATUS="$BUILD_STATUS" \
        REPORT_NO_BUILD="$NO_BUILD" \
        REPORT_DEBUG_GRID="$DEBUG_GRID" \
        REPORT_CELL_W="$CELL_W" \
        REPORT_CELL_H="$CELL_H" \
        REPORT_FONT_FAMILY="$FONT_FAMILY" \
        REPORT_TERMINAL_FONT_SIZE="$TERMINAL_FONT_SIZE" \
        REPORT_APP_PID="${APP_PID:-}" \
        REPORT_APP_EXIT="${APP_EXIT:-}" \
        REPORT_APP_TERMINATION="${APP_TERMINATION:-}" \
        REPORT_SCREENSHOT_STATUS="${SCREENSHOT_STATUS:-skipped}" \
        REPORT_FOCUS_STATUS="${FOCUS_STATUS:-skipped}" \
        REPORT_HAS_SCREENCAPTURE="${HAS_SCREENCAPTURE:-0}" \
        REPORT_HAS_OSASCRIPT="${HAS_OSASCRIPT:-0}" \
        REPORT_HAS_PYTHON3="1" \
        REPORT_HAS_CARGO="${HAS_CARGO:-0}" \
        REPORT_NOTES="$REPORT_NOTES" \
        REPORT_PLATFORM="$(uname -s)" \
        REPORT_TIMESTAMP="$TS" \
        REPORT_CMD_JSON="$CMD_ARGS_JSON" \
        REPORT_ENV_JSON="$ENV_VARS_JSON" \
            "$HAS_PYTHON3_BIN" - <<'PY'
import json, os

def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default

def maybe_int(s):
    if s is None or s == "":
        return None
    try:
        return int(s)
    except ValueError:
        return s

def loads_or_none(s):
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None

out_dir = env("REPORT_OUT_DIR")
artifacts = {}
for name in ("app.log", "build.log", "command.txt", "env.txt",
             "perf_summary.txt", "screenshot.png"):
    p = os.path.join(out_dir, name)
    artifacts[name] = {
        "path": p,
        "exists": os.path.exists(p),
        "size_bytes": os.path.getsize(p) if os.path.exists(p) else None,
    }

data = {
    "schema_version": 1,
    "timestamp": env("REPORT_TIMESTAMP"),
    "platform": env("REPORT_PLATFORM"),
    "mode": env("REPORT_MODE"),
    "github_spec": env("REPORT_GITHUB_SPEC") or None,
    "agent_cmd": env("REPORT_AGENT_CMD") or None,
    "duration_seconds": maybe_int(env("REPORT_DURATION")),
    "out_dir": out_dir,
    "binary": env("REPORT_BIN"),
    "build": {
        "skipped": env("REPORT_NO_BUILD") == "1",
        "status": env("REPORT_BUILD_STATUS"),
    },
    "options": {
        "debug_grid": env("REPORT_DEBUG_GRID") == "1",
        "cell_w": env("REPORT_CELL_W") or None,
        "cell_h": env("REPORT_CELL_H") or None,
        "font_family": env("REPORT_FONT_FAMILY") or None,
        "terminal_font_size": env("REPORT_TERMINAL_FONT_SIZE") or None,
    },
    "command": loads_or_none(env("REPORT_CMD_JSON")) or [],
    "env_overrides": loads_or_none(env("REPORT_ENV_JSON")) or [],
    "process": {
        "pid": maybe_int(env("REPORT_APP_PID")),
        "exit_status": maybe_int(env("REPORT_APP_EXIT")),
        "termination": env("REPORT_APP_TERMINATION") or None,
    },
    "screenshot": {
        "status": env("REPORT_SCREENSHOT_STATUS"),
        "focus_status": env("REPORT_FOCUS_STATUS"),
    },
    "tool_availability": {
        "screencapture": env("REPORT_HAS_SCREENCAPTURE") == "1",
        "osascript": env("REPORT_HAS_OSASCRIPT") == "1",
        "python3": env("REPORT_HAS_PYTHON3") == "1",
        "cargo": env("REPORT_HAS_CARGO") == "1",
    },
    "artifacts": artifacts,
    "notes": env("REPORT_NOTES") or "",
}

with open(env("REPORT_PATH"), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
        return $?
    fi

    # python3 が無い時の最低限フォールバック (キーは絞る)。
    {
        printf '{\n'
        printf '  "schema_version": 1,\n'
        printf '  "timestamp": %s,\n' "$(json_escape_fallback "$TS")"
        printf '  "platform": %s,\n' "$(json_escape_fallback "$(uname -s)")"
        printf '  "mode": %s,\n' "$(json_escape_fallback "$MODE")"
        printf '  "github_spec": %s,\n' "$(json_escape_fallback "$GITHUB_SPEC")"
        printf '  "agent_cmd": %s,\n' "$(json_escape_fallback "$AGENT_CMD")"
        printf '  "duration_seconds": %s,\n' "$DURATION"
        printf '  "out_dir": %s,\n' "$(json_escape_fallback "$OUT_DIR")"
        printf '  "binary": %s,\n' "$(json_escape_fallback "$BIN")"
        printf '  "build": { "skipped": %s, "status": %s },\n' \
            "$([ "$NO_BUILD" = 1 ] && echo true || echo false)" \
            "$(json_escape_fallback "$BUILD_STATUS")"
        printf '  "process": { "pid": %s, "exit_status": %s, "termination": %s },\n' \
            "${APP_PID:-null}" "${APP_EXIT:-null}" \
            "$(json_escape_fallback "${APP_TERMINATION:-}")"
        printf '  "screenshot": { "status": %s, "focus_status": %s },\n' \
            "$(json_escape_fallback "${SCREENSHOT_STATUS:-skipped}")" \
            "$(json_escape_fallback "${FOCUS_STATUS:-skipped}")"
        printf '  "tool_availability": { "screencapture": %s, "osascript": %s, "python3": false, "cargo": %s },\n' \
            "$([ "${HAS_SCREENCAPTURE:-0}" = 1 ] && echo true || echo false)" \
            "$([ "${HAS_OSASCRIPT:-0}" = 1 ] && echo true || echo false)" \
            "$([ "${HAS_CARGO:-0}" = 1 ] && echo true || echo false)"
        printf '  "notes": %s\n' "$(json_escape_fallback "$REPORT_NOTES")"
        printf '}\n'
    } > "$report_path"
}

# bash 配列を JSON 配列にする (python3 があるときだけ呼ぶ)。
to_json_array() {
    if [ -z "${HAS_PYTHON3_BIN:-}" ]; then
        printf '[]'
        return
    fi
    "$HAS_PYTHON3_BIN" -c '
import json, sys
print(json.dumps(sys.argv[1:], ensure_ascii=False))
' "$@"
}

cleanup_app() {
    # SIGTERM で落とし、それでも残ったら SIGKILL。
    # 二重呼び出し (明示呼び + EXIT trap) でも副作用が出ないよう冪等にする。
    [ -n "${APP_PID:-}" ] || return
    [ "${CLEANUP_DONE:-0}" = "1" ] && return

    if ! kill -0 "$APP_PID" 2>/dev/null; then
        # 既に死んでいる: 外側で "running" のままだったら正規化のみ行う。
        # "terminated_sigterm" / "terminated_sigkill" / "exited_early" は上書きしない。
        if [ "${APP_TERMINATION:-}" = "running" ]; then
            APP_TERMINATION="exited_during_run"
        fi
        CLEANUP_DONE=1
        return
    fi

    # 親に TERM を送り、locus 側の Drop に PTY 子の片付けを任せる。
    APP_TERMINATION="terminated_sigterm"
    kill -TERM "$APP_PID" 2>/dev/null || true

    # 最大 3 秒だけ graceful 待ち
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if ! kill -0 "$APP_PID" 2>/dev/null; then
            CLEANUP_DONE=1
            return
        fi
        sleep 0.2
    done

    # まだ生きている → 子から先に KILL する (親を先に殺すと PPID が
    # 1 (launchd) に reparent されて pkill -P が当たらなくなるため)。
    APP_TERMINATION="terminated_sigkill"
    if command -v pkill >/dev/null 2>&1; then
        pkill -KILL -P "$APP_PID" 2>/dev/null || true
    fi
    kill -KILL "$APP_PID" 2>/dev/null || true
    CLEANUP_DONE=1
}

focus_app_for_screenshot() {
    # desktop 全体の screenshot でも対象 window が背面に回ると診断価値が下がるため、
    # macOS では best-effort で起動した PID を最前面化してから撮る。
    # osascript / Accessibility 権限が無い環境では失敗を report に残すだけで継続する。
    if [ -z "${APP_PID:-}" ]; then
        FOCUS_STATUS="skipped_no_pid"
        return
    fi
    if [ "$HAS_OSASCRIPT" -ne 1 ]; then
        FOCUS_STATUS="skipped_no_tool"
        return
    fi

    if osascript -e "tell application \"System Events\" to set frontmost of first application process whose unix id is $APP_PID to true" >/dev/null 2>&1; then
        FOCUS_STATUS="ok"
        sleep 0.5
    else
        FOCUS_STATUS="failed"
    fi
}

# ---- arg parsing -----------------------------------------------------------

MODE=""
GITHUB_SPEC=""
AGENT_CMD="${LOCUS_AGENT_CMD:-sh}"
DURATION=8
OUT_DIR=""
DEBUG_GRID=1
CELL_W=""
CELL_H=""
FONT_FAMILY=""
TERMINAL_FONT_SIZE=""
NO_BUILD=0

if [ "$#" -lt 1 ]; then
    usage
    exit 2
fi

case "$1" in
    -h|--help)
        usage
        exit 0
        ;;
    terminal)
        MODE="terminal"
        shift
        ;;
    github)
        MODE="github"
        shift
        if [ "$#" -lt 1 ]; then
            die "github mode requires <owner/repo#PR>"
        fi
        GITHUB_SPEC="$1"
        shift
        ;;
    *)
        die "unknown subcommand: $1 (expected: terminal | github)"
        ;;
esac

while [ "$#" -gt 0 ]; do
    case "$1" in
        --duration)
            shift
            [ "$#" -gt 0 ] || die "--duration requires a value"
            DURATION="$1"
            shift
            ;;
        --out-dir)
            shift
            [ "$#" -gt 0 ] || die "--out-dir requires a value"
            OUT_DIR="$1"
            shift
            ;;
        --agent-cmd)
            shift
            [ "$#" -gt 0 ] || die "--agent-cmd requires a value"
            AGENT_CMD="$1"
            shift
            ;;
        --debug-grid)
            DEBUG_GRID=1
            shift
            ;;
        --no-debug-grid)
            DEBUG_GRID=0
            shift
            ;;
        --cell-w)
            shift
            [ "$#" -gt 0 ] || die "--cell-w requires a value"
            CELL_W="$1"
            shift
            ;;
        --cell-h)
            shift
            [ "$#" -gt 0 ] || die "--cell-h requires a value"
            CELL_H="$1"
            shift
            ;;
        --font-family)
            shift
            [ "$#" -gt 0 ] || die "--font-family requires a value"
            FONT_FAMILY="$1"
            shift
            ;;
        --terminal-font-size)
            shift
            [ "$#" -gt 0 ] || die "--terminal-font-size requires a value"
            TERMINAL_FONT_SIZE="$1"
            shift
            ;;
        --no-build)
            NO_BUILD=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

case "$DURATION" in
    ''|*[!0-9]*) die "--duration must be a non-negative integer (got: $DURATION)" ;;
esac

# ---- preparation -----------------------------------------------------------

TS="$(date +%Y%m%dT%H%M%S)"
if [ -z "$OUT_DIR" ]; then
    OUT_DIR="target/locus-diagnostics/${TS}"
fi
mkdir -p "$OUT_DIR" || die "failed to create out-dir: $OUT_DIR"

APP_LOG="$OUT_DIR/app.log"
BUILD_LOG="$OUT_DIR/build.log"
COMMAND_TXT="$OUT_DIR/command.txt"
ENV_TXT="$OUT_DIR/env.txt"
PERF_SUMMARY="$OUT_DIR/perf_summary.txt"
SCREENSHOT="$OUT_DIR/screenshot.png"
REPORT_JSON="$OUT_DIR/report.json"

REPORT_NOTES=""
APP_TERMINATION="not_launched"
APP_PID=""
APP_EXIT=""
SCREENSHOT_STATUS="skipped"
FOCUS_STATUS="skipped"
BUILD_STATUS="skipped"
BIN="target/debug/locus"

# tool availability
HAS_PYTHON3_BIN="$(command -v python3 || true)"
HAS_SCREENCAPTURE=0
command -v screencapture >/dev/null 2>&1 && HAS_SCREENCAPTURE=1
HAS_OSASCRIPT=0
command -v osascript >/dev/null 2>&1 && HAS_OSASCRIPT=1
HAS_CARGO=0
command -v cargo >/dev/null 2>&1 && HAS_CARGO=1

# command.txt / env.txt
{
    case "$MODE" in
        terminal) printf '%s %s %s\n' "$BIN" "[passthrough]" "$AGENT_CMD" ;;
        github)   printf '%s github %s\n' "$BIN" "$GITHUB_SPEC" ;;
    esac
    printf '\n# duration: %s seconds\n' "$DURATION"
    printf '# debug_grid: %s\n' "$DEBUG_GRID"
    printf '# cell_w: %s\n' "$CELL_W"
    printf '# cell_h: %s\n' "$CELL_H"
    printf '# font_family: %s\n' "$FONT_FAMILY"
    printf '# terminal_font_size: %s\n' "$TERMINAL_FONT_SIZE"
    printf '# no_build: %s\n' "$NO_BUILD"
} > "$COMMAND_TXT"

env > "$ENV_TXT" 2>/dev/null || true

# build
if [ "$NO_BUILD" -eq 0 ]; then
    if [ "$HAS_CARGO" -ne 1 ]; then
        BUILD_STATUS="failed_no_cargo"
        REPORT_NOTES="cargo not found on PATH; cannot build."
        log "cargo not found; skipping build and aborting."
        ENV_VARS_JSON="[]"
        CMD_ARGS_JSON="[]"
        write_report_json "$REPORT_JSON"
        exit 1
    fi
    log "running cargo build (logs → $BUILD_LOG)"
    if cargo build > "$BUILD_LOG" 2>&1; then
        BUILD_STATUS="ok"
    else
        BUILD_STATUS="failed"
        REPORT_NOTES="cargo build failed; see build.log"
        log "cargo build failed; see $BUILD_LOG"
        ENV_VARS_JSON="[]"
        CMD_ARGS_JSON="[]"
        write_report_json "$REPORT_JSON"
        exit 1
    fi
fi

if [ ! -x "$BIN" ]; then
    BUILD_STATUS="${BUILD_STATUS}_binary_missing"
    REPORT_NOTES="binary not found at $BIN (use --no-build only after a build)"
    log "binary not found at $BIN"
    ENV_VARS_JSON="[]"
    CMD_ARGS_JSON="[]"
    write_report_json "$REPORT_JSON"
    exit 1
fi

# argv とインジェクト env を組む
ENV_VARS=("LOCUS_LOG=debug")
if [ "$DEBUG_GRID" -eq 1 ]; then
    ENV_VARS+=("LOCUS_TERMINAL_DEBUG_GRID=true")
fi
[ -n "$CELL_W" ]              && ENV_VARS+=("LOCUS_TERMINAL_CELL_W=$CELL_W")
[ -n "$CELL_H" ]              && ENV_VARS+=("LOCUS_TERMINAL_CELL_H=$CELL_H")
[ -n "$FONT_FAMILY" ]         && ENV_VARS+=("LOCUS_TERMINAL_FONT_FAMILY=$FONT_FAMILY")
[ -n "$TERMINAL_FONT_SIZE" ]  && ENV_VARS+=("LOCUS_TERMINAL_FONT_SIZE=$TERMINAL_FONT_SIZE")

case "$MODE" in
    terminal) CMD_ARGS=("$BIN" "$AGENT_CMD") ;;
    github)   CMD_ARGS=("$BIN" "github" "$GITHUB_SPEC") ;;
esac

if [ -n "$HAS_PYTHON3_BIN" ]; then
    CMD_ARGS_JSON="$(to_json_array "${CMD_ARGS[@]}")"
    ENV_VARS_JSON="$(to_json_array "${ENV_VARS[@]}")"
else
    CMD_ARGS_JSON="[]"
    ENV_VARS_JSON="[]"
fi

# command.txt に最終的な argv / env も追記
{
    printf '\n# argv:\n'
    printf '  %s\n' "${CMD_ARGS[@]}"
    printf '\n# injected env:\n'
    printf '  %s\n' "${ENV_VARS[@]}"
} >> "$COMMAND_TXT"

# ---- launch ---------------------------------------------------------------

trap 'cleanup_app' EXIT INT TERM

log "launching: ${CMD_ARGS[*]}"
log "injected env: ${ENV_VARS[*]}"
log "out-dir: $OUT_DIR"

# bash 4 以降ならジョブコントロール下で起動してプロセスグループ分離可能。
# macOS の bash 3 でも以下の env 経由 spawn で十分: PID は記録され、
# cleanup_app が PID と直接の子に対して TERM/KILL を送る。
env "${ENV_VARS[@]}" "${CMD_ARGS[@]}" > "$APP_LOG" 2>&1 &
APP_PID=$!
APP_TERMINATION="running"

log "launched pid=$APP_PID; sleeping ${DURATION}s"

# DURATION が 0 でも sleep 0 を呼ぶと一瞬で抜けるだけで安全。
sleep "$DURATION"

# 既に死んでいたら exit code を読み、screenshot は試みない。
# `wait` の終了コードを `APP_EXIT` に取りたいので、`|| true` を挟まない
# (set -e は無効なので非ゼロでもスクリプトは継続する)。`2>/dev/null` は
# "no such process" 系のメッセージを抑止するため。
if ! kill -0 "$APP_PID" 2>/dev/null; then
    # シグナル trap が走って cleanup_app が既に "terminated_*" を設定して
    # いる可能性があるので、未マークの場合だけ "exited_early" を立てる。
    [ "$APP_TERMINATION" = "running" ] && APP_TERMINATION="exited_early"
    log "process exited before duration elapsed"
    wait "$APP_PID" 2>/dev/null
    APP_EXIT=$?
else
    # screenshot
    if [ "$HAS_SCREENCAPTURE" -eq 1 ]; then
        focus_app_for_screenshot
        if screencapture -x "$SCREENSHOT" >/dev/null 2>&1 && [ -s "$SCREENSHOT" ]; then
            SCREENSHOT_STATUS="ok"
            log "screenshot: $SCREENSHOT"
        else
            SCREENSHOT_STATUS="failed"
            log "screencapture invocation failed"
        fi
    else
        SCREENSHOT_STATUS="skipped_no_tool"
        log "screencapture not found; skipping screenshot"
    fi

    # 停止
    log "terminating pid=$APP_PID"
    cleanup_app
    wait "$APP_PID" 2>/dev/null
    APP_EXIT=$?
fi

# trap が二重に走らないように解除
trap - EXIT INT TERM

# ---- post processing ------------------------------------------------------

FINAL_EXIT=0
case "$APP_TERMINATION" in
    exited_early|exited_during_run)
        REPORT_NOTES="${REPORT_NOTES:+$REPORT_NOTES }app exited before harness terminated it; see app.log."
        if [ -n "$APP_EXIT" ] && [ "$APP_EXIT" -ne 0 ]; then
            FINAL_EXIT="$APP_EXIT"
        else
            FINAL_EXIT=1
        fi
        ;;
esac

# perf_summary.txt — LOCUS_LOG=debug が吐く主要 keyword の grep カウント。
# 本体コード側で形式が変わっても script は壊れず 0 件としてカウントされるだけ。
{
    printf 'locus diagnostic perf summary\n'
    printf '  app.log: %s\n' "$APP_LOG"
    printf '\n'
    printf '== keyword counts ==\n'
    for kw in \
        "preview refreshed" \
        "terminal resized" \
        "terminal resize failed" \
        "window session saved" \
        "pr session saved" \
        "linked issues fetched" \
        "initial hydrate snapshot+list fetched" \
        "initial hydrate completed" \
        "initial hydrate snapshot failed" \
    ; do
        if [ -f "$APP_LOG" ]; then
            count="$(grep -c -F -- "$kw" "$APP_LOG" 2>/dev/null || true)"
        else
            count=0
        fi
        printf '  %-44s %s\n' "$kw" "${count:-0}"
    done
    printf '\n'
    printf '== matched lines ==\n'
    if [ -f "$APP_LOG" ]; then
        grep -E -- 'preview refreshed|terminal resized|window session saved|pr session saved|linked issues fetched|initial hydrate' \
            "$APP_LOG" 2>/dev/null \
            | head -n 200 \
            || printf '  (no matching debug lines found)\n'
    else
        printf '  (app.log missing)\n'
    fi
    printf '\n'
    printf '== warn / error tail ==\n'
    if [ -f "$APP_LOG" ]; then
        grep -E -i -- ' WARN | ERROR |panicked|panic at' "$APP_LOG" 2>/dev/null \
            | tail -n 50 \
            || printf '  (no warn/error lines found)\n'
    fi
} > "$PERF_SUMMARY"

# report.json
write_report_json "$REPORT_JSON"

log "done. artifacts:"
log "  $REPORT_JSON"
log "  $APP_LOG"
log "  $PERF_SUMMARY"
[ "$SCREENSHOT_STATUS" = "ok" ] && log "  $SCREENSHOT"
exit "$FINAL_EXIT"
