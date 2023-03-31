# Vencord Desktop

A standalone Electron app that loads Discord & Vencord (very early and unfinished)

## Motivation

The official Discord Desktop app is very resource heavy compared to Discord in your Browser. There are multiple alternative Electron apps (ArmCord, WebCord, probably more) that prove how much of a performance gain you can gain by using a custom app. ArmCord already supports Vencord but makes it pretty limited for us. Making our own standalone app gives us much more control.

This is just a random idea I (V) got, and might not actually ever be finished heh

Gluon also seems very attractive for this because of how lightweight it can be and because unlike electron, streaming just works out of the box like in any chromium browser. However, at the time of writing this, it still lacks some features necessary to make it work (synchronous ipc or a way to get node process variables into the onLoad function for instance, plus onLoad seems to load a little too late sometimes)
