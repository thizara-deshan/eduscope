#!/bin/bash
# Record cam2 + audio. Camera H.264 PASSED THROUGH = minimal CPU.
TS=$(date +%Y%m%d_%H%M%S); OUT="${1:-cam2_$TS.ts}"; echo "REC cam2 -> $OUT"
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! queue ! mux. \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! voaacenc bitrate=128000 ! aacparse ! queue ! mux. \
  mpegtsmux name=mux alignment=7 ! filesink location="$OUT"
