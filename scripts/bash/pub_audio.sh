#!/bin/bash
rm -f /tmp/audio.sock
gst-launch-1.0 -e \
  alsasrc device=hw:UMS,0 do-timestamp=true ! \
  audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! \
  queue max-size-time=200000000 ! \
  shmsink socket-path=/tmp/audio.sock shm-size=4000000 \
          wait-for-connection=false sync=false
