#!/usr/bin/env bash
# Portable Windows build: fastdiscord.exe with the GStreamer runtime DLLs
# beside it and the plugins its pipelines use under lib\gstreamer-1.0
# (main.rs points GStreamer there). Runs in Git Bash on the CI runner, with
# the official GStreamer MSVC runtime + devel installed.
#
# Usage: packaging/windows.sh  →  dist/FastDiscord-windows-x86_64.zip
set -euo pipefail
cd "$(dirname "$0")/.."

GST=$(cygpath -u "${GSTREAMER_1_0_ROOT_MSVC_X86_64:?GStreamer MSVC root not set}")
OUT=dist/FastDiscord
ZIP=dist/FastDiscord-windows-x86_64.zip

# Required elements: Desktop Duplication capture, WHIP publish, WHEP watch,
# the encoder probe and the webrtcbin internals.
ELEMENTS=(d3d11screencapturesrc d3d11download appsrc appsink queue videorate capsfilter
          videoconvert videotestsrc fakesink h264parse rtph264pay rtph264depay
          openh264enc openh264dec whipsink whepsrc webrtcbin nicesrc nicesink
          dtlssrtpenc dtlssrtpdec srtpenc srtpdec rtpbin rtpsession rtpjitterbuffer
          rtprtxsend rtprtxreceive rtpstorage)
# Probed at runtime; absent ones just shorten the encoder/decoder ladders.
OPTIONAL=(nvh264enc mfh264enc x264enc d3d11h264dec)

echo "── release build"
cargo build --release

echo "── layout"
rm -rf "$OUT" "$ZIP"
mkdir -p "$OUT/lib/gstreamer-1.0"
cp target/release/fastdiscord.exe "$OUT/"
# GStreamer's own libraries (glib, gstreamer, libnice, openssl…): next to
# the exe, where Windows looks for the plugins' dependencies too.
cp "$GST"/bin/*.dll "$OUT/"

declare -A SEEN
copy_plugin() {
    local so
    so=$(gst-inspect-1.0 "$1" 2>/dev/null | tr -d '\r' | grep -m1 -oP '^\s+Filename\s+\K.+' || true)
    [ -n "$so" ] || return 1
    so=$(cygpath -u "$so")
    [ -n "${SEEN[$so]:-}" ] && return 0
    SEEN[$so]=1
    cp "$so" "$OUT/lib/gstreamer-1.0/"
}
for el in "${ELEMENTS[@]}"; do
    copy_plugin "$el" || { echo "missing plugin for element: $el"; exit 1; }
done
for el in "${OPTIONAL[@]}"; do
    copy_plugin "$el" || echo "   optional, absent: $el"
done
echo "   $(ls "$OUT/lib/gstreamer-1.0" | wc -l) plugins, $(ls "$OUT"/*.dll | wc -l) libraries"

echo "── zip"
(cd dist && 7z a -tzip -mx=7 "$(basename "$ZIP")" FastDiscord >/dev/null)
du -h "$ZIP"
