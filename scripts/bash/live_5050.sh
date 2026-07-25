#!/bin/bash
# 50/50 composite of camera 1 (left) + camera 2 (right) + audio -> RTMP live.
# Needs pub_rtsp.sh, pub_rtsp2.sh, pub_audio.sh running.
#   ./live_5050.sh [STREAM_KEY]
KEY="${1:-test}"
TARGET="rtmp://127.0.0.1:1935/live/$KEY"
echo "LIVE 50/50 cam1+cam2 -> $TARGET"
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! \
    queue max-size-buffers=6 leaky=downstream ! comp.sink_0 \
  \
  shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=960,height=540 ! \
    queue max-size-buffers=6 leaky=downstream ! comp.sink_1 \
  \
  compositor name=comp background=black \
    sink_0::xpos=0   sink_0::ypos=270 \
    sink_1::xpos=960 sink_1::ypos=270 ! \
    video/x-raw,width=1920,height=1080,framerate=30/1 ! \
    queue ! mpph264enc bps=4000000 rc-mode=cbr gop=60 profile=high ! \
    h264parse config-interval=1 ! \
    queue max-size-buffers=200 ! mux. \
  \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! \
    voaacenc bitrate=128000 ! aacparse ! \
    queue max-size-buffers=200 ! mux. \
  \
  flvmux name=mux streamable=true ! \
  queue max-size-buffers=400 ! \
  rtmpsink location="$TARGET live=1" sync=false
