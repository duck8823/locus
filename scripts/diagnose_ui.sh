#!/usr/bin/env bash
#
# diagnose_ui.sh — locus UI 自動診断ハーネス。
#
# LLM / オペレータが locus の terminal-only mode と diff viewer mode を
# 実機で起動し、以下のアーティファクトを out-dir に書き出すための入口。
#
#   app.log                    child process (cargo build した debug binary) の stdout/stderr
#   build.log                  cargo build の stdout/stderr (--no-build 時は省略)
#   command.txt                起動した argv と注入した環境変数
#   env.txt                    スクリプト時点の環境変数 dump
#   perf_summary.txt           LOCUS_LOG=debug が吐く主要 perf 行の grep カウント
#   screenshot.png             screencapture が使える環境では起動 N 秒後の画面
#   interaction_events.jsonl   --interaction で注入した操作の start/done/skipped/failed イベント
#   interaction_summary.json   イベントと app.log を突き合わせた latency_ms / observed counts サマリ
#   report.json                mode / command / env / duration / exit_status / paths / tools
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
#   --probe-metrics           LOCUS_TERMINAL_PROBE_METRICS=true を注入
#   --no-probe-metrics        LOCUS_TERMINAL_PROBE_METRICS を注入しない (既定)
#   --cell-w VALUE            LOCUS_TERMINAL_CELL_W override
#   --cell-h VALUE            LOCUS_TERMINAL_CELL_H override
#   --font-family VALUE       LOCUS_TERMINAL_FONT_FAMILY override
#   --terminal-font-size VAL  LOCUS_TERMINAL_FONT_SIZE override
#   --profile PROFILE         cargo profile / binary to launch: debug or release
#                             (default debug)
#   --release                 shorthand for --profile release
#   --slint-debug-performance VALUE
#                             SLINT_DEBUG_PERFORMANCE override
#                             (e.g. refresh_full_speed,console)
#   --slint-backend VALUE     SLINT_BACKEND override
#                             (e.g. winit-femtovg, winit-software)
#   --window-size WxH         macOS で起動後に front window を WIDTHxHEIGHT に
#                             リサイズして再現スクショを撮る (#290 等の min-size
#                             目視診断向け)
#   --interaction NAME        起動後に注入する操作。複数回指定可。対応 NAME:
#                             terminal-type / terminal-scroll / diff-scroll /
#                             file-switch-next
#                             terminal-scroll は Python Quartz
#                             (pyobjc-framework-Quartz) がある macOS で有効
#   --interaction-delay SEC   launch から interactions 開始までの待ち秒数 (default 1)
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
  --probe-metrics           LOCUS_TERMINAL_PROBE_METRICS=true を注入
  --no-probe-metrics        LOCUS_TERMINAL_PROBE_METRICS を注入しない (既定)
  --cell-w VALUE            LOCUS_TERMINAL_CELL_W override
  --cell-h VALUE            LOCUS_TERMINAL_CELL_H override
  --font-family VALUE       LOCUS_TERMINAL_FONT_FAMILY override
  --terminal-font-size VAL  LOCUS_TERMINAL_FONT_SIZE override
  --profile PROFILE         cargo profile / binary to launch: debug | release
                            (default debug)
  --release                 shorthand for --profile release
  --slint-debug-performance VALUE
                            SLINT_DEBUG_PERFORMANCE override
                            (e.g. refresh_full_speed,console)
  --slint-backend VALUE     SLINT_BACKEND override
                            (e.g. winit-femtovg, winit-software)
  --window-size WxH         macOS で起動後に front window を WIDTHxHEIGHT に
                            リサイズ (例: 1280x720)
  --interaction NAME        起動後に注入する操作。複数回指定可。
                            NAME: terminal-type | terminal-scroll | diff-scroll | file-switch-next
                            terminal-scroll requires Python Quartz
                            (pyobjc-framework-Quartz) on macOS; otherwise skipped.
                            diff-scroll requires github mode and uses an
                            app-side timer for stable viewport diagnostics.
                            file-switch-next は app-side single-shot のため
                            1 回のみ、かつ単独指定のみ可。
  --interaction-delay SEC   launch から interactions 開始までの待ち秒数 (default 1)。
                            --interaction 指定時は --duration 以下であること。
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
        REPORT_PROFILE="$PROFILE" \
        REPORT_BUILD_STATUS="$BUILD_STATUS" \
        REPORT_NO_BUILD="$NO_BUILD" \
        REPORT_DEBUG_GRID="$DEBUG_GRID" \
        REPORT_PROBE_METRICS="$PROBE_METRICS" \
        REPORT_CELL_W="$CELL_W" \
        REPORT_CELL_H="$CELL_H" \
        REPORT_FONT_FAMILY="$FONT_FAMILY" \
        REPORT_TERMINAL_FONT_SIZE="$TERMINAL_FONT_SIZE" \
        REPORT_SLINT_DEBUG_PERFORMANCE="$SLINT_DEBUG_PERFORMANCE_OVERRIDE" \
        REPORT_SLINT_BACKEND="$SLINT_BACKEND_OVERRIDE" \
        REPORT_WINDOW_SIZE="$WINDOW_SIZE" \
        REPORT_WINDOW_WIDTH="$WINDOW_WIDTH" \
        REPORT_WINDOW_HEIGHT="$WINDOW_HEIGHT" \
        REPORT_WINDOW_RESIZE_STATUS="$WINDOW_RESIZE_STATUS" \
        REPORT_WINDOW_ID="${WINDOW_ID:-}" \
        REPORT_WINDOW_ID_STATUS="${WINDOW_ID_STATUS:-skipped}" \
        REPORT_APP_PID="${APP_PID:-}" \
        REPORT_APP_EXIT="${APP_EXIT:-}" \
        REPORT_APP_TERMINATION="${APP_TERMINATION:-}" \
        REPORT_SCREENSHOT_STATUS="${SCREENSHOT_STATUS:-skipped}" \
        REPORT_SCREENSHOT_CAPTURE_MODE="${SCREENSHOT_CAPTURE_MODE:-skipped}" \
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
        REPORT_INTERACTIONS_JSON="${INTERACTIONS_JSON:-[]}" \
        REPORT_INTERACTION_DELAY="$INTERACTION_DELAY" \
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
             "perf_summary.txt", "screenshot.png",
             "interaction_events.jsonl", "interaction_summary.json"):
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
        "profile": env("REPORT_PROFILE"),
    },
    "options": {
        "debug_grid": env("REPORT_DEBUG_GRID") == "1",
        "probe_metrics": env("REPORT_PROBE_METRICS") == "1",
        "cell_w": env("REPORT_CELL_W") or None,
        "cell_h": env("REPORT_CELL_H") or None,
        "font_family": env("REPORT_FONT_FAMILY") or None,
        "terminal_font_size": env("REPORT_TERMINAL_FONT_SIZE") or None,
        "slint_debug_performance": env("REPORT_SLINT_DEBUG_PERFORMANCE") or None,
        "slint_backend": env("REPORT_SLINT_BACKEND") or None,
        "window_size": env("REPORT_WINDOW_SIZE") or None,
    },
    "command": loads_or_none(env("REPORT_CMD_JSON")) or [],
    "env_overrides": loads_or_none(env("REPORT_ENV_JSON")) or [],
    "interactions": {
        "requested": loads_or_none(env("REPORT_INTERACTIONS_JSON")) or [],
        "delay_seconds": maybe_int(env("REPORT_INTERACTION_DELAY")),
    },
    "process": {
        "pid": maybe_int(env("REPORT_APP_PID")),
        "exit_status": maybe_int(env("REPORT_APP_EXIT")),
        "termination": env("REPORT_APP_TERMINATION") or None,
    },
    "screenshot": {
        "status": env("REPORT_SCREENSHOT_STATUS"),
        "focus_status": env("REPORT_FOCUS_STATUS"),
        "capture_mode": env("REPORT_SCREENSHOT_CAPTURE_MODE"),
    },
    "window": {
        "requested": env("REPORT_WINDOW_SIZE") or None,
        "width": maybe_int(env("REPORT_WINDOW_WIDTH")),
        "height": maybe_int(env("REPORT_WINDOW_HEIGHT")),
        "resize_status": env("REPORT_WINDOW_RESIZE_STATUS"),
        "id": maybe_int(env("REPORT_WINDOW_ID")),
        "id_status": env("REPORT_WINDOW_ID_STATUS"),
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
        printf '  "build": { "skipped": %s, "status": %s, "profile": %s },\n' \
            "$([ "$NO_BUILD" = 1 ] && echo true || echo false)" \
            "$(json_escape_fallback "$BUILD_STATUS")" \
            "$(json_escape_fallback "$PROFILE")"
        printf '  "process": { "pid": %s, "exit_status": %s, "termination": %s },\n' \
            "${APP_PID:-null}" "${APP_EXIT:-null}" \
            "$(json_escape_fallback "${APP_TERMINATION:-}")"
        printf '  "screenshot": { "status": %s, "focus_status": %s, "capture_mode": %s },\n' \
            "$(json_escape_fallback "${SCREENSHOT_STATUS:-skipped}")" \
            "$(json_escape_fallback "${FOCUS_STATUS:-skipped}")" \
            "$(json_escape_fallback "${SCREENSHOT_CAPTURE_MODE:-skipped}")"
        printf '  "window": { "requested": %s, "width": %s, "height": %s, "resize_status": %s, "id": %s, "id_status": %s },\n' \
            "$(json_escape_fallback "$WINDOW_SIZE")" \
            "${WINDOW_WIDTH:-null}" \
            "${WINDOW_HEIGHT:-null}" \
            "$(json_escape_fallback "$WINDOW_RESIZE_STATUS")" \
            "${WINDOW_ID:-null}" \
            "$(json_escape_fallback "${WINDOW_ID_STATUS:-skipped}")"
        printf '  "tool_availability": { "screencapture": %s, "osascript": %s, "python3": false, "cargo": %s },\n' \
            "$([ "${HAS_SCREENCAPTURE:-0}" = 1 ] && echo true || echo false)" \
            "$([ "${HAS_OSASCRIPT:-0}" = 1 ] && echo true || echo false)" \
            "$([ "${HAS_CARGO:-0}" = 1 ] && echo true || echo false)"
        printf '  "interactions": { "requested": [], "delay_seconds": %s },\n' "$INTERACTION_DELAY"
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

write_filtered_env() {
    # 診断成果物は PR / issue に貼られる可能性があるため、全 env dump は避ける。
    # locus / Rust / terminal 再現に必要な代表値だけ残し、credential らしい名前は
    # whitelist とは独立に redacted marker として出す。
    env | sort | awk -F= '
        BEGIN {
            safe = "^(LOCUS_|SLINT_|PATH$|LANG$|LC_|TERM$|SHELL$|HOME$|USER$|TMPDIR$|PWD$|CARGO_|RUST_|RUSTUP_|CI$|GITHUB_REPOSITORY$|GH_HOST$)"
            secret = "(TOKEN|SECRET|PASSWORD|PASS|KEY|COOKIE|CREDENTIAL|AUTH)"
        }
        {
            name = $1
            upper_name = toupper(name)
            if (upper_name ~ secret) {
                print name "=<redacted>"
            } else if (name ~ safe) {
                print $0
            }
        }
    ' > "$ENV_TXT"
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

apply_window_geometry() {
    # --window-size が指定されたとき、起動した process の front window を raise して
    # 指定 WIDTHxHEIGHT に bounds を設定する。#290 のような min-size 目視診断を
    # 再現スクショで取るための pre-screenshot helper。
    # Accessibility 権限・osascript 不在・window 未生成などで失敗しても script は
    # 継続し、status を report に残す。
    if [ -z "$WINDOW_SIZE" ]; then
        WINDOW_RESIZE_STATUS="skipped_not_requested"
        return
    fi
    if [ -z "${APP_PID:-}" ]; then
        WINDOW_RESIZE_STATUS="skipped_no_pid"
        return
    fi
    if [ "$HAS_OSASCRIPT" -ne 1 ]; then
        WINDOW_RESIZE_STATUS="skipped_no_tool"
        return
    fi

    if osascript \
        -e "tell application \"System Events\"" \
        -e "    tell (first application process whose unix id is $APP_PID)" \
        -e "        set frontmost to true" \
        -e "        if (count of windows) = 0 then error \"no windows\"" \
        -e "        -- fixed position keeps diagnostic captures reproducible" \
        -e "        set position of front window to {100, 100}" \
        -e "        set size of front window to {$WINDOW_WIDTH, $WINDOW_HEIGHT}" \
        -e "    end tell" \
        -e "end tell" >/dev/null 2>&1; then
        WINDOW_RESIZE_STATUS="ok"
        sleep 0.3
    else
        WINDOW_RESIZE_STATUS="failed"
    fi
}

detect_app_window_id() {
    # APP_PID 所有の主 window の CGWindowID を Quartz 経由で取得する。
    # 取れたら $WINDOW_ID にセットし $WINDOW_ID_STATUS=ok。
    # python3 / Quartz が無い・該当 window が無い等は status に記録して空のまま返す。
    # 候補は layer 0 / OwnerPID == APP_PID / positive bounds の中で最大面積を選ぶ。
    WINDOW_ID=""
    WINDOW_ID_STATUS="skipped"

    if [ -z "${APP_PID:-}" ]; then
        WINDOW_ID_STATUS="skipped_no_pid"
        return
    fi
    if [ -z "${HAS_PYTHON3_BIN:-}" ]; then
        WINDOW_ID_STATUS="skipped_no_python3"
        return
    fi

    local detected rc
    detected="$(APP_PID="$APP_PID" "$HAS_PYTHON3_BIN" - <<'PY' 2>/dev/null
import os
import sys
try:
    import Quartz
except ImportError:
    sys.exit(11)
try:
    pid = int(os.environ.get("APP_PID", "0"))
except ValueError:
    sys.exit(12)
if pid <= 0:
    sys.exit(12)
options = (
    Quartz.kCGWindowListOptionOnScreenOnly
    | Quartz.kCGWindowListExcludeDesktopElements
)
windows = Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID) or []
candidates = []
for w in windows:
    if w.get("kCGWindowOwnerPID") != pid:
        continue
    if w.get("kCGWindowLayer", 0) != 0:
        continue
    bounds = w.get("kCGWindowBounds") or {}
    width = bounds.get("Width", 0) or 0
    height = bounds.get("Height", 0) or 0
    if width <= 0 or height <= 0:
        continue
    wid = w.get("kCGWindowNumber")
    if wid is None:
        continue
    try:
        candidates.append((float(width) * float(height), int(wid)))
    except (TypeError, ValueError):
        continue
if not candidates:
    sys.exit(13)
candidates.sort(reverse=True)
print(candidates[0][1])
PY
    )"
    rc=$?
    case "$rc" in
        0)
            if [ -n "$detected" ]; then
                WINDOW_ID="$detected"
                WINDOW_ID_STATUS="ok"
            else
                WINDOW_ID_STATUS="failed"
            fi
            ;;
        11) WINDOW_ID_STATUS="skipped_no_quartz" ;;
        12) WINDOW_ID_STATUS="skipped_no_pid" ;;
        13) WINDOW_ID_STATUS="no_window" ;;
        *)  WINDOW_ID_STATUS="failed" ;;
    esac
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

# ---- interaction injection -------------------------------------------------

# 現在時刻を Unix epoch ms で返す。tracing_subscriber の RFC3339 timestamp と
# 突き合わせるため、Python があれば time.time() で ms 精度を得る。bash 3 の
# date には %N が無いので fallback は秒精度 (× 1000)。
unix_ms() {
    if [ -n "${HAS_PYTHON3_BIN:-}" ]; then
        "$HAS_PYTHON3_BIN" -c 'import time; print(int(time.time() * 1000))' 2>/dev/null \
            || printf '%s000' "$(date +%s)"
    else
        printf '%s000' "$(date +%s)"
    fi
}

sleep_ms() {
    local ms="$1"
    case "$ms" in
        ''|*[!0-9]*) return ;;
    esac
    [ "$ms" -gt 0 ] || return
    sleep "$((ms / 1000)).$(printf '%03d' "$((ms % 1000))")"
}

# JSONL に 1 行追記する。固定フィールド (event/name/index) と任意の
# key=value ペアを取る。数値キー (start_unix_ms / end_unix_ms / latency_ms)
# はそのまま number として出力し、それ以外は string として escape する。
emit_event() {
    local event="$1" iname="$2" iindex="$3"
    shift 3
    local line emitted_ms default_status
    emitted_ms="$(unix_ms)"
    case "$event" in
        start) default_status="started" ;;
        done) default_status="ok" ;;
        skipped) default_status="skipped" ;;
        failed) default_status="failed" ;;
        *) default_status="$event" ;;
    esac
    line='{"event":'
    line+="$(json_escape_fallback "$event")"
    line+=',"phase":'
    line+="$(json_escape_fallback "$event")"
    line+=',"name":'
    line+="$(json_escape_fallback "$iname")"
    line+=",\"index\":$iindex"
    case "$emitted_ms" in
        ''|*[!0-9-]*) line+=',"timestamp_unix_ms":null' ;;
        *) line+=",\"timestamp_unix_ms\":$emitted_ms" ;;
    esac
    line+=',"status":'
    line+="$(json_escape_fallback "$default_status")"
    while [ "$#" -gt 0 ]; do
        local pair="$1" key val
        key="${pair%%=*}"
        val="${pair#*=}"
        case "$key" in
            start_unix_ms|end_unix_ms|latency_ms|bytes_len)
                # 数値が空 / 非数値の場合は null にフォールバック
                case "$val" in
                    ''|*[!0-9-]*) line+=",\"$key\":null" ;;
                    *) line+=",\"$key\":$val" ;;
                esac
                ;;
            *)
                line+=",\"$key\":"
                line+="$(json_escape_fallback "$val")"
                ;;
        esac
        shift
    done
    line+='}'
    printf '%s\n' "$line" >> "$INTERACTION_EVENTS"
}

inject_terminal_type() {
    local idx="$1"
    local start_ms

    if [ -z "${APP_PID:-}" ] || ! kill -0 "$APP_PID" 2>/dev/null; then
        start_ms="$(unix_ms)"
        emit_event "skipped" "terminal-type" "$idx" \
            "start_unix_ms=$start_ms" "reason=app_not_running"
        return
    fi
    if [ "${HAS_OSASCRIPT:-0}" -ne 1 ]; then
        start_ms="$(unix_ms)"
        emit_event "skipped" "terminal-type" "$idx" \
            "start_unix_ms=$start_ms" "reason=no_osascript"
        return
    fi

    # bytes_len は app 側 (terminal/mod.rs) の "terminal input forwarded" だけが
    # 出す。注入文字列そのものは ここの interaction_events にだけ書き、app.log
    # には keystroke の結果として bytes_len のみが流れる。
    local payload="locus-diagnostic-input"

    if ! osascript \
        -e "tell application \"System Events\"" \
        -e "    tell (first application process whose unix id is $APP_PID)" \
        -e "        set frontmost to true" \
        -e "    end tell" \
        -e "end tell" >/dev/null 2>&1; then
        start_ms="$(unix_ms)"
        emit_event "failed" "terminal-type" "$idx" \
            "start_unix_ms=$start_ms" "reason=osascript_focus_failed"
        return
    fi
    sleep 0.2

    start_ms="$(unix_ms)"
    emit_event "start" "terminal-type" "$idx" \
        "start_unix_ms=$start_ms" "detail=type '$payload' + return"

    if osascript \
        -e "tell application \"System Events\"" \
        -e "    keystroke \"$payload\"" \
        -e "    key code 36" \
        -e "end tell" >/dev/null 2>&1; then
        local end_ms
        end_ms="$(unix_ms)"
        emit_event "done" "terminal-type" "$idx" \
            "start_unix_ms=$start_ms" "end_unix_ms=$end_ms" \
            "bytes_len=$((${#payload} + 1))"
    else
        emit_event "failed" "terminal-type" "$idx" \
            "start_unix_ms=$start_ms" "reason=osascript_failed"
    fi
}

inject_terminal_scroll() {
    local idx="$1"
    local start_ms

    if [ -z "${APP_PID:-}" ] || ! kill -0 "$APP_PID" 2>/dev/null; then
        start_ms="$(unix_ms)"
        emit_event "skipped" "terminal-scroll" "$idx" \
            "start_unix_ms=$start_ms" "reason=app_not_running"
        return
    fi
    if [ -z "${HAS_PYTHON3_BIN:-}" ]; then
        start_ms="$(unix_ms)"
        emit_event "skipped" "terminal-scroll" "$idx" \
            "start_unix_ms=$start_ms" "reason=no_python3"
        return
    fi

    # focus は best-effort: scroll wheel event は HID 層で post されるため、
    # 対象 window が前面でないとロケータ次第で別 app に届く可能性がある。
    if [ "${HAS_OSASCRIPT:-0}" -eq 1 ]; then
        osascript \
            -e "tell application \"System Events\" to set frontmost of (first application process whose unix id is $APP_PID) to true" \
            >/dev/null 2>&1 || true
        sleep 0.2
    fi

    start_ms="$(unix_ms)"
    emit_event "start" "terminal-scroll" "$idx" \
        "start_unix_ms=$start_ms" "detail=move pointer to terminal area; post 6 scroll wheel events (line, dy=-3)"

    APP_PID="$APP_PID" MODE="$MODE" "$HAS_PYTHON3_BIN" - >/dev/null 2>&1 <<'PY'
import os
import sys, time
try:
    import Quartz
except ImportError:
    sys.exit(11)

try:
    pid = int(os.environ.get("APP_PID", "0"))
except ValueError:
    sys.exit(12)
if pid <= 0:
    sys.exit(12)

options = (
    Quartz.kCGWindowListOptionOnScreenOnly
    | Quartz.kCGWindowListExcludeDesktopElements
)
windows = Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID) or []
candidates = []
for w in windows:
    if w.get("kCGWindowOwnerPID") != pid:
        continue
    if w.get("kCGWindowLayer", 0) != 0:
        continue
    bounds = w.get("kCGWindowBounds") or {}
    width = float(bounds.get("Width", 0) or 0)
    height = float(bounds.get("Height", 0) or 0)
    if width <= 0 or height <= 0:
        continue
    x = float(bounds.get("X", 0) or 0)
    y = float(bounds.get("Y", 0) or 0)
    candidates.append((width * height, x, y, width, height))
if not candidates:
    sys.exit(13)

_, x, y, width, height = sorted(candidates, reverse=True)[0]
mode = os.environ.get("MODE") or "terminal"
if mode == "github":
    # Diff viewer: terminal pane is the bottom part of the left content area.
    content_width = max(1.0, width - 320.0)
    target = (x + min(content_width, width) * 0.5, y + max(24.0, height - 129.0))
else:
    # Terminal-only window: the terminal fills the window.
    target = (x + width * 0.5, y + height * 0.5)

move = Quartz.CGEventCreateMouseEvent(
    None, Quartz.kCGEventMouseMoved, target, Quartz.kCGMouseButtonLeft
)
if move is None:
    sys.exit(21)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, move)
time.sleep(0.05)
for event_type in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
    click = Quartz.CGEventCreateMouseEvent(
        None, event_type, target, Quartz.kCGMouseButtonLeft
    )
    if click is None:
        sys.exit(22)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, click)
    time.sleep(0.03)

for _ in range(6):
    e = Quartz.CGEventCreateScrollWheelEvent(
        None, Quartz.kCGScrollEventUnitLine, 1, -3
    )
    if e is None:
        sys.exit(20)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
    time.sleep(0.05)
PY
    local rc=$?
    case "$rc" in
        0)
            local end_ms
            end_ms="$(unix_ms)"
            emit_event "done" "terminal-scroll" "$idx" \
                "start_unix_ms=$start_ms" "end_unix_ms=$end_ms"
            ;;
        11)
            emit_event "skipped" "terminal-scroll" "$idx" \
                "start_unix_ms=$start_ms" "reason=no_quartz"
            ;;
        12)
            emit_event "skipped" "terminal-scroll" "$idx" \
                "start_unix_ms=$start_ms" "reason=no_pid_for_scroll"
            ;;
        13)
            emit_event "skipped" "terminal-scroll" "$idx" \
                "start_unix_ms=$start_ms" "reason=no_window_for_scroll"
            ;;
        *)
            emit_event "failed" "terminal-scroll" "$idx" \
                "start_unix_ms=$start_ms" "reason=quartz_post_failed"
            ;;
    esac
}

inject_diff_scroll() {
    local idx="$1"
    local start_ms

    if [ "$MODE" != "github" ]; then
        start_ms="$(unix_ms)"
        emit_event "skipped" "diff-scroll" "$idx" \
            "start_unix_ms=$start_ms" "reason=requires_github_mode"
        return
    fi
    if [ -z "${APP_PID:-}" ] || ! kill -0 "$APP_PID" 2>/dev/null; then
        start_ms="$(unix_ms)"
        emit_event "skipped" "diff-scroll" "$idx" \
            "start_unix_ms=$start_ms" "reason=app_not_running"
        return
    fi

    if [ -n "${RUN_START_MS:-}" ] && [ -n "${DIFF_SCROLL_TRIGGER_OFFSET_MS:-}" ]; then
        start_ms="$((RUN_START_MS + DIFF_SCROLL_TRIGGER_OFFSET_MS))"
    else
        start_ms="$(unix_ms)"
    fi
    emit_event "start" "diff-scroll" "$idx" \
        "start_unix_ms=$start_ms" "detail=app-side diagnostic timer scrolls diff viewport"
    emit_event "done" "diff-scroll" "$idx" \
        "start_unix_ms=$start_ms" "end_unix_ms=$(unix_ms)" \
        "detail=armed via LOCUS_DIAG_DIFF_SCROLL_AFTER_MS"
}

inject_file_switch_next() {
    local idx="$1"
    local start_ms
    if [ -n "${RUN_START_MS:-}" ] && [ -n "${FILE_SWITCH_TRIGGER_OFFSET_MS:-}" ]; then
        start_ms="$((RUN_START_MS + FILE_SWITCH_TRIGGER_OFFSET_MS))"
    else
        start_ms="$(unix_ms)"
    fi

    if [ "$MODE" != "github" ]; then
        emit_event "skipped" "file-switch-next" "$idx" \
            "start_unix_ms=$start_ms" "reason=requires_github_mode"
        return
    fi
    if [ -z "${APP_PID:-}" ] || ! kill -0 "$APP_PID" 2>/dev/null; then
        emit_event "skipped" "file-switch-next" "$idx" \
            "start_unix_ms=$start_ms" "reason=app_not_running"
        return
    fi

    emit_event "start" "file-switch-next" "$idx" \
        "start_unix_ms=$start_ms" "detail=app-side diagnostic timer requests next file"
    emit_event "done" "file-switch-next" "$idx" \
        "start_unix_ms=$start_ms" "end_unix_ms=$(unix_ms)" \
        "detail=armed via LOCUS_DIAG_FILE_SWITCH_AFTER_MS"
}

run_interactions() {
    [ "${#INTERACTIONS[@]}" -gt 0 ] || return
    local i=0 name
    for name in "${INTERACTIONS[@]}"; do
        case "$name" in
            terminal-type)   inject_terminal_type "$i" ;;
            terminal-scroll) inject_terminal_scroll "$i" ;;
            diff-scroll)     inject_diff_scroll "$i" ;;
            file-switch-next) inject_file_switch_next "$i" ;;
            *)
                # 未対応 NAME は parse 段階で die しているため到達しないが
                # 防衛的に残す。
                local _start_ms
                _start_ms="$(unix_ms)"
                emit_event "skipped" "$name" "$i" \
                    "start_unix_ms=$_start_ms" "reason=unknown_interaction"
                ;;
        esac
        i=$((i + 1))
        # 連続した interaction が同フレームに混ざらないよう少しだけ間を空ける
        sleep 0.2
    done
}

# events と app.log を突き合わせて latency_ms / counts を JSON で出す。
# Python があるときに完全版、無いときは skip note 入りの最小 JSON。
write_interaction_summary() {
    if [ -n "${HAS_PYTHON3_BIN:-}" ]; then
        APP_LOG="$APP_LOG" \
        EVENTS_FILE="$INTERACTION_EVENTS" \
        SUMMARY_FILE="$INTERACTION_SUMMARY" \
        REQUESTED_INTERACTIONS_JSON="${INTERACTIONS_JSON:-[]}" \
        INTERACTION_DELAY_SEC="$INTERACTION_DELAY" \
            "$HAS_PYTHON3_BIN" - <<'PY'
import json, math, os, re
from datetime import datetime

app_log = os.environ.get("APP_LOG") or ""
events_path = os.environ.get("EVENTS_FILE") or ""
summary_path = os.environ.get("SUMMARY_FILE") or ""

try:
    requested = json.loads(os.environ.get("REQUESTED_INTERACTIONS_JSON") or "[]")
except json.JSONDecodeError:
    requested = []

events = []
if events_path and os.path.exists(events_path):
    with open(events_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

# tracing_subscriber default fmt の RFC3339 timestamp ("...Z") を
# Unix epoch ms に変換する。マッチしない行は黙って捨てる。
TS_RE = re.compile(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s')

def parse_ts(ts):
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int(dt.timestamp() * 1000)

forwarded = []
render_hits = []
scroll_hits = []
diff_scroll_hits = []
file_switch_hits = []
if app_log and os.path.exists(app_log):
    with open(app_log, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = TS_RE.match(line)
            if not m:
                continue
            ums = parse_ts(m.group(1))
            if ums is None:
                continue
            if "terminal input forwarded" in line:
                forwarded.append(ums)
            if "terminal render tick" in line or "terminal render idle flush" in line:
                render_hits.append(ums)
            if "terminal scroll event" in line:
                scroll_hits.append(ums)
            if "diff scroll event" in line:
                diff_scroll_hits.append(ums)
            if "file switch requested" in line:
                file_switch_hits.append(ums)

def first_after(items, threshold):
    for ums in items:
        if ums >= threshold:
            return ums
    return None

# events を index ごとに集約。done/skipped/failed が start を上書きしないよう
# start_unix_ms は最初に来た値を優先する。
agg = {}
for ev in events:
    idx = ev.get("index")
    if idx is None:
        continue
    a = agg.setdefault(idx, {
        "index": idx,
        "name": ev.get("name"),
        "status": "unknown",
        "start_unix_ms": None,
        "end_unix_ms": None,
        "injection_duration_ms": None,
        "latency_ms": None,
        "match_keyword": None,
        "observed": False,
        "observation_status": "pending",
        "observation_reason": None,
        "reason": None,
        "detail": None,
    })
    if ev.get("name"):
        a["name"] = ev["name"]
    s_ms = ev.get("start_unix_ms")
    if a["start_unix_ms"] is None and s_ms is not None:
        a["start_unix_ms"] = s_ms
    if ev.get("event") == "start":
        if a["status"] in ("unknown",):
            a["status"] = "started"
        if ev.get("detail"):
            a["detail"] = ev["detail"]
    elif ev.get("event") == "done":
        a["status"] = ev.get("status") or "ok"
        if ev.get("end_unix_ms") is not None:
            a["end_unix_ms"] = ev["end_unix_ms"]
    elif ev.get("event") == "skipped":
        a["status"] = "skipped"
        a["reason"] = ev.get("reason")
    elif ev.get("event") == "failed":
        a["status"] = "failed"
        a["reason"] = ev.get("reason")

# latency 計算: ok/started のときだけ意味がある。
for a in agg.values():
    if a["start_unix_ms"] is not None and a["end_unix_ms"] is not None:
        a["injection_duration_ms"] = a["end_unix_ms"] - a["start_unix_ms"]
    if a["status"] == "skipped":
        a["observation_status"] = "skipped"
        a["observation_reason"] = a["reason"]
        continue
    if a["status"] == "failed":
        a["observation_status"] = "failed"
        a["observation_reason"] = a["reason"]
        continue
    if a["status"] not in ("ok", "started"):
        a["observation_status"] = "unknown"
        continue
    start = a["start_unix_ms"]
    if start is None:
        a["observation_status"] = "unmatched"
        a["observation_reason"] = "missing_start_timestamp"
        continue
    if a["name"] == "terminal-type":
        hit = first_after(forwarded, start)
        if hit is not None:
            a["latency_ms"] = hit - start
            a["match_keyword"] = "terminal input forwarded"
        else:
            a["observation_status"] = "unmatched"
            a["observation_reason"] = "no terminal input forwarded log after injection"
    elif a["name"] == "terminal-scroll":
        hit = first_after(scroll_hits, start)
        if hit is not None:
            a["latency_ms"] = hit - start
            a["match_keyword"] = "terminal scroll event"
        else:
            a["observation_status"] = "unmatched"
            a["observation_reason"] = "no terminal scroll event log after injection"
    elif a["name"] == "diff-scroll":
        hit = first_after(diff_scroll_hits, start)
        if hit is not None:
            a["latency_ms"] = hit - start
            a["match_keyword"] = "diff scroll event"
        else:
            a["observation_status"] = "unmatched"
            a["observation_reason"] = "no diff scroll event log after injection"
    elif a["name"] == "file-switch-next":
        hit = first_after(file_switch_hits, start)
        if hit is not None:
            a["latency_ms"] = hit - start
            a["match_keyword"] = "file switch requested"
        else:
            a["observation_status"] = "unmatched"
            a["observation_reason"] = "no file switch requested log after injection"
    else:
        a["observation_status"] = "unknown"
        a["observation_reason"] = "unknown_interaction"
    if a["latency_ms"] is not None:
        a["observed"] = True
        a["observation_status"] = "matched"
        a["observation_reason"] = None

ordered = [agg[k] for k in sorted(agg.keys())]
events_total = len(ordered)
skipped = sum(1 for a in ordered if a["status"] == "skipped")
failed = sum(1 for a in ordered if a["status"] == "failed")
observed = sum(1 for a in ordered if a["observed"])
unobserved = sum(
    1
    for a in ordered
    if a["status"] in ("ok", "started") and not a["observed"]
)

def percentile(values, p):
    if not values:
        return None
    sorted_values = sorted(values)
    index = max(0, math.ceil((p / 100.0) * len(sorted_values)) - 1)
    return sorted_values[min(index, len(sorted_values) - 1)]

def latency_stats(values):
    if not values:
        return {
            "count": 0,
            "min_ms": None,
            "p50_ms": None,
            "p95_ms": None,
            "max_ms": None,
        }
    return {
        "count": len(values),
        "min_ms": min(values),
        "p50_ms": percentile(values, 50),
        "p95_ms": percentile(values, 95),
        "max_ms": max(values),
    }

latencies_by_name = {}
all_latencies = []
for a in ordered:
    latency = a.get("latency_ms")
    if latency is None:
        continue
    all_latencies.append(latency)
    latencies_by_name.setdefault(a.get("name") or "unknown", []).append(latency)

out = {
    "schema_version": 1,
    "requested": requested,
    "interaction_delay_seconds": int(os.environ.get("INTERACTION_DELAY_SEC") or 0),
    "interactions": ordered,
    "counts": {
        "events_total": events_total,
        "skipped": skipped,
        "failed": failed,
        "observed": observed,
        "unobserved": unobserved,
    },
    "latency_stats": {
        "overall": latency_stats(all_latencies),
        "by_interaction": {
            name: latency_stats(values)
            for name, values in sorted(latencies_by_name.items())
        },
    },
}

with open(summary_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
        return
    fi

    # Python 不在: 最低限の skip JSON を残しておく
    {
        printf '{\n'
        printf '  "schema_version": 1,\n'
        printf '  "requested": [],\n'
        printf '  "interaction_delay_seconds": %s,\n' "$INTERACTION_DELAY"
        printf '  "interactions": [],\n'
        printf '  "counts": { "events_total": 0, "skipped": 0, "failed": 0 },\n'
        printf '  "notes": "skipped: python3 not available"\n'
        printf '}\n'
    } > "$INTERACTION_SUMMARY"
}

# ---- arg parsing -----------------------------------------------------------

MODE=""
GITHUB_SPEC=""
AGENT_CMD="${LOCUS_AGENT_CMD:-sh}"
DURATION=8
OUT_DIR=""
DEBUG_GRID=1
PROBE_METRICS=0
CELL_W=""
CELL_H=""
FONT_FAMILY=""
TERMINAL_FONT_SIZE=""
PROFILE="${LOCUS_DIAG_PROFILE:-debug}"
SLINT_DEBUG_PERFORMANCE_OVERRIDE="${SLINT_DEBUG_PERFORMANCE:-}"
SLINT_BACKEND_OVERRIDE="${SLINT_BACKEND:-}"
WINDOW_SIZE=""
WINDOW_WIDTH=""
WINDOW_HEIGHT=""
INTERACTIONS=()
INTERACTION_DELAY=1
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
        --probe-metrics)
            PROBE_METRICS=1
            shift
            ;;
        --no-probe-metrics)
            PROBE_METRICS=0
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
        --profile)
            shift
            [ "$#" -gt 0 ] || die "--profile requires a value (debug | release)"
            PROFILE="$1"
            shift
            ;;
        --release)
            PROFILE="release"
            shift
            ;;
        --slint-debug-performance)
            shift
            [ "$#" -gt 0 ] || die "--slint-debug-performance requires a value"
            SLINT_DEBUG_PERFORMANCE_OVERRIDE="$1"
            shift
            ;;
        --slint-backend)
            shift
            [ "$#" -gt 0 ] || die "--slint-backend requires a value"
            SLINT_BACKEND_OVERRIDE="$1"
            shift
            ;;
        --window-size)
            shift
            [ "$#" -gt 0 ] || die "--window-size requires a value (e.g. 1280x720)"
            WINDOW_SIZE="$1"
            shift
            ;;
        --interaction)
            shift
            [ "$#" -gt 0 ] || die "--interaction requires a value (terminal-type | terminal-scroll | diff-scroll | file-switch-next)"
            INTERACTIONS+=("$1")
            shift
            ;;
        --interaction-delay)
            shift
            [ "$#" -gt 0 ] || die "--interaction-delay requires a value"
            INTERACTION_DELAY="$1"
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

case "$INTERACTION_DELAY" in
    ''|*[!0-9]*) die "--interaction-delay must be a non-negative integer (got: $INTERACTION_DELAY)" ;;
esac

case "$PROFILE" in
    debug|release) ;;
    *) die "--profile must be one of: debug | release (got: $PROFILE)" ;;
esac

if [ "${#INTERACTIONS[@]}" -gt 0 ]; then
    if [ "$INTERACTION_DELAY" -gt "$DURATION" ]; then
        die "--interaction-delay must be less than or equal to --duration when --interaction is used (delay=$INTERACTION_DELAY duration=$DURATION)"
    fi
    _file_switch_count=0
    _diff_scroll_count=0
    for _name in "${INTERACTIONS[@]}"; do
        case "$_name" in
            terminal-type|terminal-scroll) ;;
            diff-scroll)
                _diff_scroll_count=$((_diff_scroll_count + 1))
                if [ "$_diff_scroll_count" -gt 1 ]; then
                    die "--interaction diff-scroll can be specified at most once (app-side single-shot diagnostic)"
                fi
                if [ "$MODE" != "github" ]; then
                    die "--interaction diff-scroll requires github mode"
                fi
                ;;
            file-switch-next)
                _file_switch_count=$((_file_switch_count + 1))
                if [ "$_file_switch_count" -gt 1 ]; then
                    die "--interaction file-switch-next can be specified at most once (app-side single-shot diagnostic)"
                fi
                ;;
            *) die "--interaction must be one of: terminal-type, terminal-scroll, diff-scroll, file-switch-next (got: $_name)" ;;
        esac
    done
    if [ "$_file_switch_count" -eq 1 ] && [ "${#INTERACTIONS[@]}" -gt 1 ]; then
        die "--interaction file-switch-next must be used alone (app-side timer is armed from launch)"
    fi
    unset _name _file_switch_count _diff_scroll_count
fi

if [ -n "$WINDOW_SIZE" ]; then
    case "$WINDOW_SIZE" in
        *x*)
            WINDOW_WIDTH="${WINDOW_SIZE%x*}"
            WINDOW_HEIGHT="${WINDOW_SIZE#*x}"
            ;;
        *)
            die "--window-size must be WIDTHxHEIGHT (positive integers, e.g. 1280x720); got: $WINDOW_SIZE"
            ;;
    esac
    case "$WINDOW_WIDTH" in
        ''|*[!0-9]*|0*) die "--window-size width must be a positive integer (got: '$WINDOW_WIDTH')" ;;
    esac
    case "$WINDOW_HEIGHT" in
        ''|*[!0-9]*|0*) die "--window-size height must be a positive integer (got: '$WINDOW_HEIGHT')" ;;
    esac
fi

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
INTERACTION_EVENTS="$OUT_DIR/interaction_events.jsonl"
INTERACTION_SUMMARY="$OUT_DIR/interaction_summary.json"
REPORT_JSON="$OUT_DIR/report.json"

REPORT_NOTES=""
APP_TERMINATION="not_launched"
APP_PID=""
APP_EXIT=""
SCREENSHOT_STATUS="skipped"
SCREENSHOT_CAPTURE_MODE="skipped"
FOCUS_STATUS="skipped"
WINDOW_RESIZE_STATUS="skipped_not_requested"
WINDOW_ID=""
WINDOW_ID_STATUS="skipped"
BUILD_STATUS="skipped"
case "$PROFILE" in
    debug)   BIN="target/debug/locus" ;;
    release) BIN="target/release/locus" ;;
esac
RUN_START_MS=""
FILE_SWITCH_TRIGGER_OFFSET_MS=""
DIFF_SCROLL_TRIGGER_OFFSET_MS=""

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
        terminal) printf '%s %s\n' "$BIN" "$AGENT_CMD" ;;
        github)   printf '%s github %s\n' "$BIN" "$GITHUB_SPEC" ;;
    esac
    printf '\n# duration: %s seconds\n' "$DURATION"
    printf '# debug_grid: %s\n' "$DEBUG_GRID"
    printf '# probe_metrics: %s\n' "$PROBE_METRICS"
    printf '# cell_w: %s\n' "$CELL_W"
    printf '# cell_h: %s\n' "$CELL_H"
    printf '# font_family: %s\n' "$FONT_FAMILY"
    printf '# terminal_font_size: %s\n' "$TERMINAL_FONT_SIZE"
    printf '# profile: %s\n' "$PROFILE"
    printf '# slint_debug_performance: %s\n' "$SLINT_DEBUG_PERFORMANCE_OVERRIDE"
    printf '# slint_backend: %s\n' "$SLINT_BACKEND_OVERRIDE"
    printf '# window_size: %s\n' "$WINDOW_SIZE"
    if [ "${#INTERACTIONS[@]}" -gt 0 ]; then
        printf '# interactions: %s\n' "${INTERACTIONS[*]}"
    else
        printf '# interactions:\n'
    fi
    printf '# interaction_delay: %s\n' "$INTERACTION_DELAY"
    printf '# no_build: %s\n' "$NO_BUILD"
} > "$COMMAND_TXT"

write_filtered_env 2>/dev/null || true

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
    log "running cargo build for profile=$PROFILE (logs → $BUILD_LOG)"
    if [ "$PROFILE" = "release" ]; then
        cargo build --release > "$BUILD_LOG" 2>&1
    else
        cargo build > "$BUILD_LOG" 2>&1
    fi
    if [ "$?" -eq 0 ]; then
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
if [ "$PROBE_METRICS" -eq 1 ]; then
    ENV_VARS+=("LOCUS_TERMINAL_PROBE_METRICS=true")
fi
[ -n "$CELL_W" ]              && ENV_VARS+=("LOCUS_TERMINAL_CELL_W=$CELL_W")
[ -n "$CELL_H" ]              && ENV_VARS+=("LOCUS_TERMINAL_CELL_H=$CELL_H")
[ -n "$FONT_FAMILY" ]         && ENV_VARS+=("LOCUS_TERMINAL_FONT_FAMILY=$FONT_FAMILY")
[ -n "$TERMINAL_FONT_SIZE" ]  && ENV_VARS+=("LOCUS_TERMINAL_FONT_SIZE=$TERMINAL_FONT_SIZE")
[ -n "$SLINT_DEBUG_PERFORMANCE_OVERRIDE" ] && ENV_VARS+=("SLINT_DEBUG_PERFORMANCE=$SLINT_DEBUG_PERFORMANCE_OVERRIDE")
[ -n "$SLINT_BACKEND_OVERRIDE" ] && ENV_VARS+=("SLINT_BACKEND=$SLINT_BACKEND_OVERRIDE")
if [ "${#INTERACTIONS[@]}" -gt 0 ]; then
    # interaction latency を app.log と突き合わせられるよう、高速 render tick も
    # 診断時だけ出す。通常 run では従来通り slow/budget-hit のみ。
    ENV_VARS+=("LOCUS_DIAG_TRACE_RENDER_TICKS=true")
    for _interaction in "${INTERACTIONS[@]}"; do
        if [ "$_interaction" = "file-switch-next" ]; then
            # app 側 single-shot timer が file-switch-requested callback を発火する。
            # script 側 event start はこの timer の予定発火時刻に合わせる。
            FILE_SWITCH_TRIGGER_OFFSET_MS=$((INTERACTION_DELAY * 1000))
            ENV_VARS+=("LOCUS_DIAG_FILE_SWITCH_AFTER_MS=$FILE_SWITCH_TRIGGER_OFFSET_MS")
        elif [ "$_interaction" = "diff-scroll" ]; then
            # diff ListView の OS wheel event は環境差が大きいため、app 側
            # single-shot timer でも viewport-y を動かして安定した診断 signal
            # を出す。script 側 event start は timer の予定発火時刻に合わせる。
            DIFF_SCROLL_TRIGGER_OFFSET_MS=$((INTERACTION_DELAY * 1000))
            ENV_VARS+=("LOCUS_DIAG_DIFF_SCROLL_AFTER_MS=$DIFF_SCROLL_TRIGGER_OFFSET_MS")
        fi
    done
    unset _interaction
fi

case "$MODE" in
    terminal) CMD_ARGS=("$BIN" "$AGENT_CMD") ;;
    github)   CMD_ARGS=("$BIN" "github" "$GITHUB_SPEC") ;;
esac

if [ -n "$HAS_PYTHON3_BIN" ]; then
    CMD_ARGS_JSON="$(to_json_array "${CMD_ARGS[@]}")"
    ENV_VARS_JSON="$(to_json_array "${ENV_VARS[@]}")"
    if [ "${#INTERACTIONS[@]}" -gt 0 ]; then
        INTERACTIONS_JSON="$(to_json_array "${INTERACTIONS[@]}")"
    else
        INTERACTIONS_JSON="[]"
    fi
else
    CMD_ARGS_JSON="[]"
    ENV_VARS_JSON="[]"
    INTERACTIONS_JSON="[]"
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
RUN_START_MS="$(unix_ms)"

log "launched pid=$APP_PID"

# DURATION が 0 でも sleep 0 を呼ぶと一瞬で抜けるだけで安全。interactions が
# 指定されていれば INTERACTION_DELAY 秒待って注入し、残り duration を sleep。
# interactions 未指定なら従来通り duration 全部 sleep。
if [ "${#INTERACTIONS[@]}" -gt 0 ]; then
    : > "$INTERACTION_EVENTS"
    log "sleeping ${INTERACTION_DELAY}s before interactions: ${INTERACTIONS[*]}"
    sleep_ms "$((INTERACTION_DELAY * 1000))"
    run_interactions
    NOW_MS="$(unix_ms)"
    REMAINING_MS=$((RUN_START_MS + (DURATION * 1000) - NOW_MS))
    if [ "$REMAINING_MS" -gt 0 ]; then
        log "sleeping remaining ${REMAINING_MS}ms after interactions"
        sleep_ms "$REMAINING_MS"
    else
        log "duration already elapsed after interactions"
    fi
else
    log "sleeping ${DURATION}s"
    sleep "$DURATION"
fi

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
    # window geometry override (--window-size が指定されたときだけ動く)
    apply_window_geometry

    # screenshot
    if [ "$HAS_SCREENCAPTURE" -eq 1 ]; then
        focus_app_for_screenshot
        detect_app_window_id

        # window capture を優先する: desktop 全体だと壁紙のみが写ることがあり
        # (#306) 受け入れ条件「対象 app window を含む」を満たさないため。
        # window id が取れなかった / 失敗した場合は従来の desktop screenshot に fallback。
        if [ -n "$WINDOW_ID" ] \
            && screencapture -x -l "$WINDOW_ID" "$SCREENSHOT" >/dev/null 2>&1 \
            && [ -s "$SCREENSHOT" ]; then
            SCREENSHOT_STATUS="ok"
            SCREENSHOT_CAPTURE_MODE="window"
            log "screenshot: $SCREENSHOT (window id=$WINDOW_ID)"
        elif screencapture -x "$SCREENSHOT" >/dev/null 2>&1 && [ -s "$SCREENSHOT" ]; then
            SCREENSHOT_STATUS="ok"
            SCREENSHOT_CAPTURE_MODE="desktop"
            log "screenshot: $SCREENSHOT (desktop fallback)"
        else
            SCREENSHOT_STATUS="failed"
            SCREENSHOT_CAPTURE_MODE="failed"
            log "screencapture invocation failed"
        fi
    else
        SCREENSHOT_STATUS="skipped_no_tool"
        SCREENSHOT_CAPTURE_MODE="skipped"
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
    printf '== slint performance ==\n'
    if [ -f "$APP_LOG" ]; then
        grep -E -- 'Slint: Build config|average frames per second' "$APP_LOG" 2>/dev/null \
            | head -n 200 \
            || printf '  (no Slint performance lines found)\n'
    else
        printf '  (app.log missing)\n'
    fi
    printf '\n'
    printf '== keyword counts ==\n'
    for kw in \
        "Slint: Build config" \
        "average frames per second" \
        "typography configured" \
        "preview refreshed" \
        "terminal resized" \
        "terminal resize failed" \
        "terminal input forwarded" \
        "terminal input forward failed" \
        "terminal scroll event" \
        "diff scroll event" \
        "terminal render tick" \
        "terminal render idle flush" \
        "file switch requested" \
        "diagnostic file switch" \
        "window session saved" \
        "pr session saved" \
        "pr switch fetch completed" \
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
        grep -E -- 'Slint: Build config|average frames per second|typography configured|preview refreshed|terminal resized|terminal resize failed|terminal input forwarded|terminal input forward failed|terminal scroll event|diff scroll event|terminal render tick|terminal render idle flush|file switch requested|diagnostic file switch|window session saved|pr session saved|pr switch fetch completed|linked issues fetched|initial hydrate snapshot\+list fetched|initial hydrate completed|initial hydrate snapshot failed' \
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

# interaction_summary.json — events file が無い (interactions 未指定) でも
# Python があれば空の interactions / counts を持つ JSON を出す。
if [ "${#INTERACTIONS[@]}" -gt 0 ] || [ -f "$INTERACTION_EVENTS" ]; then
    write_interaction_summary
fi

# report.json
write_report_json "$REPORT_JSON"

log "done. artifacts:"
log "  $REPORT_JSON"
log "  $APP_LOG"
log "  $PERF_SUMMARY"
[ -f "$INTERACTION_EVENTS" ]  && log "  $INTERACTION_EVENTS"
[ -f "$INTERACTION_SUMMARY" ] && log "  $INTERACTION_SUMMARY"
[ "$SCREENSHOT_STATUS" = "ok" ] && log "  $SCREENSHOT"
exit "$FINAL_EXIT"
