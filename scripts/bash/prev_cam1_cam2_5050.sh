#!/bin/bash
# Preview cam1 + cam2 side-by-side with audio, HDMI-2.
#   ./prev_cam1_cam2_5050.sh [A] [B]
export DISPLAY=:0
source "$(dirname "$0")/_layout.sh"
A=${1:-50}; B=${2:-50}; eval $(ratio_layout $A $B)
echo "PREVIEW cam1/cam2 ${A}/${B}"
before=$(wmctrl -l | grep "gst-launch-1.0" | awk '{print $1}')
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/rtsp.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=$W0,height=$H0 ! \
    queue max-size-buffers=6 leaky=downstream ! comp.sink_0 \
  shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=6 leaky=downstream ! \
    videorate drop-only=true ! video/x-raw,framerate=30/1 ! \
    videoscale ! video/x-raw,width=$W1,height=$H1 ! \
    queue max-size-buffers=6 leaky=downstream ! comp.sink_1 \
  compositor name=comp background=black \
    sink_0::xpos=$X0 sink_0::ypos=$Y0 sink_1::xpos=$X1 sink_1::ypos=$Y1 ! \
    video/x-raw,width=1920,height=1080,framerate=30/1 ! \
    queue ! xvimagesink sync=false \
  shmsrc socket-path=/tmp/audio.sock is-live=true do-timestamp=true ! \
    audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
    queue ! audioconvert ! audioresample ! autoaudiosink sync=false &
PID=$!
WID=""
for i in $(seq 1 60); do
  for w in $(wmctrl -l | grep "gst-launch-1.0" | awk '{print $1}'); do
    echo "$before" | grep -q "$w" || { WID="$w"; break; }
  done
  [ -n "$WID" ] && break; sleep 0.5
done
[ -n "$WID" ] && { wmctrl -i -r "$WID" -e 0,1920,0,1920,1080; wmctrl -i -r "$WID" -b add,fullscreen; } || echo "WARN: no window"
trap "kill -INT $PID; wait $PID; exit" INT TERM
wait $PID
