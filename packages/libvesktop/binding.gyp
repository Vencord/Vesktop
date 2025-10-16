{
  "targets": [
    {
      "target_name": "libvesktop",
      "sources": [ "src/libvesktop.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags_cc": [
        "<!(pkg-config --cflags glib-2.0 gio-2.0)",
        "-O3"
      ],
      "libraries": [
        "<!@(pkg-config  --libs-only-l --libs-only-other glib-2.0 gio-2.0)"
      ],
      "cflags_cc!": ["-fno-exceptions"],
    }
  ]
}