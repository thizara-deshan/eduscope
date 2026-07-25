#!/bin/bash
# Record cam1 + cam2 side-by-side with audio.  ./rec_cam1_cam2_5050.sh [A] [B] [out.ts]
source "$(dirname "$0")/_layout.sh"
A=${1:-50}; B=${2:-50}; TS=$(date +%Y%m%d_%H%M%S)
OUT="${3:-cam1_cam2_${A}-${B}_$TS.ts}"
eval $(ratio_layout $A $B); echo "REC cam1/cam2 ${A}/${B} -> $OUT"
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=$W0,height=$H0 ! queue ! comp.sink_0 \
  shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=$W1,height=$H1 ! queue ! comp.sink_1 \
  compositor name=comp background=black \
    sink_0::xpos=$X0 sink_0::ypos=$Y0 sink_1::xpos=$X1 sink_1::ypos=$Y1 ! \
    video/x-raw,width=1920,height=1080,framerate=30/1 ! \
    queue ! mpph264enc bps=4000000 rc-mode=cbr gop=30 profile=high ! \
    h264parse config-interval=1 ! queue ! mux. \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! voaacenc bitrate=128000 ! aacparse ! queue ! mux. \
  mpegtsmux name=mux alignment=7 ! filesink location="$OUT"
