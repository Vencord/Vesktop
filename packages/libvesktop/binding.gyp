{
  "targets": [
    {
      "target_name": "libvesktop",
      "sources": [ "src/libvesktop.cc", "src/idle_notifier.cc", "src/ext-idle-notify-v1-protocol.c" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags_cc": [
        "<!(pkg-config --cflags glib-2.0 gio-2.0 wayland-client)",
        "-O3"
      ],
      "libraries": [
        "<!@(pkg-config  --libs-only-l --libs-only-other glib-2.0 gio-2.0 wayland-client)"
      ],
      "cflags_cc!": ["-fno-exceptions"],
    }
  ]
}
