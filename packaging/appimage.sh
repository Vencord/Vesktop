#!/usr/bin/env bash
# Packs FastDiscord into a self-contained AppImage: the binary, the
# GStreamer plugins its share pipelines use (docs/SCREENSHARE.md) and their
# libraries found by recursive ldd. glibc, the graphics/Wayland stack and
# the sound server clients (PipeWire, PulseAudio) come from the host: their
# runtime modules and daemons live there. Adapted from FockyTV's
# client/package-appimage.sh.
#
# Usage: packaging/appimage.sh  →  dist/FastDiscord-x86_64.AppImage
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist/FastDiscord-x86_64.AppImage
APPDIR=target/appdir
TOOLS=target/appimage-tools
rm -rf "$APPDIR"

# Required elements: WHIP publish, WHEP watch, the encoder probe and the
# webrtcbin internals (ICE, DTLS/SRTP, RTP session, NACK/RTX).
ELEMENTS=(appsrc appsink queue videorate capsfilter videoconvert videotestsrc fakesink
          h264parse rtph264pay rtph264depay openh264enc openh264dec
          whipsink whepsrc webrtcbin nicesrc nicesink dtlssrtpenc dtlssrtpdec
          srtpenc srtpdec rtpbin rtpsession rtpjitterbuffer rtprtxsend rtprtxreceive
          rtpstorage)
# The encoder/decoder ladders probe at runtime; whatever the build machine
# lacks only shortens the ladder (VAAPI also needs a driver on the host).
OPTIONAL=(vah264lpenc vah264enc x264enc vah264dec)

echo "── release build"
cargo build --release

echo "── AppDir"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/lib/gstreamer-1.0" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps" dist
cp target/release/fastdiscord "$APPDIR/usr/bin/"
if command -v rsvg-convert >/dev/null; then
    rsvg-convert -w 256 -h 256 assets/icon.svg -o "$APPDIR/fastdiscord.png"
else
    cp assets/tray.png "$APPDIR/fastdiscord.png"
fi
cp "$APPDIR/fastdiscord.png" "$APPDIR/.DirIcon"
cp "$APPDIR/fastdiscord.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/"
cat > "$APPDIR/fastdiscord.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=FastDiscord
GenericName=Discord Client
Comment=Cliente Discord nativo em Rust e egui
Exec=fastdiscord
Icon=fastdiscord
Categories=Network;InstantMessaging;
Terminal=false
EOF

echo "── GStreamer plugins"
declare -A SEEN
copy_plugin() {
    local so
    # The plugin path is the indented "Filename" line of "Plugin Details";
    # property docs may contain the word too.
    so=$(gst-inspect-1.0 "$1" 2>/dev/null | grep -m1 -oP '^\s+Filename\s+\K\S+' || true)
    [ -n "$so" ] || return 1
    [ -n "${SEEN[$so]:-}" ] && return 0
    SEEN[$so]=1
    cp -L "$so" "$APPDIR/usr/lib/gstreamer-1.0/"
}
for el in "${ELEMENTS[@]}"; do
    copy_plugin "$el" || { echo "missing plugin for element: $el"; exit 1; }
done
for el in "${OPTIONAL[@]}"; do
    copy_plugin "$el" || echo "   optional, absent: $el"
done

# Libraries that must come from the host.
from_host() {
    case "$1" in
        */ld-linux*|*/libc.so*|*/libm.so*|*/libpthread*|*/libdl*|*/librt*|*/libresolv*|*/libanl*|*/libnsl*|*/libutil*|*/libBrokenLocale*) return 0 ;;
        */libgcc_s.so*|*/libstdc++.so*|*/libGL.so*|*/libEGL.so*|*/libOpenGL*|*/libglapi*|*/libvulkan*|*/libX*|*/libxcb*|*/libxkbcommon*|*/libwayland*|*/libdrm*|*/libgbm*|*/libICE*|*/libSM*|*/libepoxy*) return 0 ;;
        */libpipewire*|*/libspa*|*/libpulse*|*/libsystemd*|*/libdbus*|*/libasound*) return 0 ;;
    esac
    return 1
}

echo "── libraries (recursive ldd)"
copied=1
while [ "$copied" -gt 0 ]; do
    copied=0
    for f in "$APPDIR/usr/bin/"* "$APPDIR/usr/lib/"*.so* "$APPDIR/usr/lib/gstreamer-1.0/"*.so*; do
        [ -f "$f" ] || continue
        while read -r lib; do
            [ -f "$lib" ] || continue
            [ -e "$APPDIR/usr/lib/$(basename "$lib")" ] && continue
            from_host "$lib" && continue
            cp -L "$lib" "$APPDIR/usr/lib/"
            copied=$((copied + 1))
        done < <(ldd "$f" 2>/dev/null | awk '{print $3}' | grep '\.so' || true)
    done
done
echo "   $(ls "$APPDIR/usr/lib" | wc -l) libraries"

cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$HERE/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export GST_PLUGIN_SYSTEM_PATH_1_0="$HERE/usr/lib/gstreamer-1.0"
export GST_PLUGIN_PATH_1_0="$HERE/usr/lib/gstreamer-1.0"
# Scan in-process: an external gst-plugin-scanner from the host would run
# with a mismatched loader/libc.
export GST_REGISTRY_FORK=no
exec "$HERE/usr/bin/fastdiscord" "$@"
EOF
chmod +x "$APPDIR/AppRun"

echo "── appimagetool"
mkdir -p "$TOOLS"
if [ ! -d "$TOOLS/appimagetool" ]; then
    curl -fsSL --retry 3 -o "$TOOLS/appimagetool.AppImage" \
        https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x "$TOOLS/appimagetool.AppImage"
    # Extracted: CI containers have no FUSE to mount it.
    (cd "$TOOLS" && ./appimagetool.AppImage --appimage-extract >/dev/null && mv squashfs-root appimagetool)
fi
if [ ! -x "$TOOLS/runtime-x86_64" ]; then
    curl -fsSL --retry 3 -o "$TOOLS/runtime-x86_64" \
        https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64
    chmod +x "$TOOLS/runtime-x86_64"
fi
rm -f "$OUT"
ARCH=x86_64 "$TOOLS/appimagetool/AppRun" --runtime-file "$TOOLS/runtime-x86_64" "$APPDIR" "$OUT"
chmod +x "$OUT"
du -h "$OUT"
