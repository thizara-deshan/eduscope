#!/bin/bash
export DISPLAY=:0

before=$(wmctrl -l | grep "gst-launch-1.0" | awk '{print $1}')

gst-launch-1.0 -e \
  shmsrc socket-path=/tmp/usb.sock is-live=true do-timestamp=true ! \
  video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1 ! \
  queue max-size-buffers=2 leaky=downstream ! \
  xvimagesink sync=false &
PID=$!

WID=""
for i in $(seq 1 60); do
  for w in $(wmctrl -l | grep "gst-launch-1.0" | awk '{print $1}'); do
    echo "$before" | grep -q "$w" || { WID="$w"; break; }
  done
  [ -n "$WID" ] && break
  sleep 0.5
done

if [ -n "$WID" ]; then
  wmctrl -i -r "$WID" -e 0,0,0,1920,1080      # x=0  -> HDMI-1
  wmctrl -i -r "$WID" -b add,fullscreen
else
  echo "WARN: USB preview window never appeared"
fi

trap "kill -INT $PID; wait $PID; exit" INT TERM
wait $PID
