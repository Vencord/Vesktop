{
  "targets": [
    {
      "target_name": "libvesktop",
      "sources": [],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NODE_ADDON_API_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS==\"linux\"", {
          "sources": [ "src/libvesktop.cc" ],
          "cflags_cc": [
            "<!(pkg-config --cflags glib-2.0 gio-2.0)",
            "-O3"
          ],
          "libraries": [
            "<!@(pkg-config  --libs-only-l --libs-only-other glib-2.0 gio-2.0)"
          ]
        }],
        ["OS==\"win\"", {
          "sources": [ "src/libvesktop_windows.cc" ],
          "libraries": [
            "user32.lib"
          ]
        }]
      ]
    },
    {
      "target_name": "vesktop-audio-capture",
      "type": "none",
      "sources": [],
      "conditions": [
        ["OS==\"win\"", {
          "type": "executable",
          "sources": [ "src/windows_audio_capture.cc" ],
          "libraries": [
            "avrt.lib",
            "Mmdevapi.lib",
            "ole32.lib",
            "runtimeobject.lib"
          ]
        }]
      ]
    }
  ]
}
