{
  "targets": [
    {
      "target_name": "libvesktop",
      "sources": [ "src/libvesktop.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags": [
        "<!(pkg-config --cflags glib-2.0 gio-2.0)"
      ],
      "libraries": [
        "<!@(pkg-config  --libs-only-l --libs-only-other glib-2.0 gio-2.0)"
      ],
      "ldflags": [
        "<!@(pkg-config  --libs-only-L --libs-only-other glib-2.0 gio-2.0)"
      ],
      "defines": [
        "NODE_ADDON_API_CPP_EXCEPTIONS"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
    }
  ]
}