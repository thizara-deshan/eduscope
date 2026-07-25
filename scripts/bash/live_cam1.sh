#!/bin/bash
# cam1 + audio -> local nginx RTMP.  ./live_cam1.sh [KEY]
KEY="${1:-test}"; TARGET="rtmp://127.0.0.1:1935/live/$KEY"; echo "LIVE cam1 -> $TARGET"
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    mpph264enc bps=4000000 rc-mode=cbr gop=60 profile=high ! \
    h264parse config-interval=1 ! queue max-size-buffers=200 ! mux. \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! voaacenc bitrate=128000 ! aacparse ! \
    queue max-size-buffers=200 ! mux. \
  flvmux name=mux streamable=true ! queue max-size-buffers=400 ! \
  rtmpsink location="$TARGET live=1" sync=false
