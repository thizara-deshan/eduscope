#!/bin/bash
export DISPLAY=:0
before=$(wmctrl -l | grep "gst-launch-1.0" | awk '{print $1}')
gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/rtsp2.sock is-live=true do-timestamp=true ! \
    video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1 ! \
    h264parse ! mppvideodec ! videoconvert ! \
    queue max-size-buffers=2 leaky=downstream ! xvimagesink sync=false \
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
[ -n "$WID" ] && { wmctrl -i -r "$WID" -e 0,0,0,1920,1080; wmctrl -i -r "$WID" -b add,fullscreen; } || echo "WARN: no window"
trap "kill -INT $PID; wait $PID; exit" INT TERM
wait $PID
