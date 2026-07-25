#!/bin/bash
rm -f /tmp/rtsp.sock
gst-launch-1.0 -e \
  rtspsrc location=rtsp://172.16.65.32/stream/main latency=100 protocols=tcp ! \
  rtph264depay ! h264parse config-interval=-1 ! \
  video/x-h264,stream-format=byte-stream,alignment=au ! \
  queue leaky=downstream max-size-buffers=200 ! \
  shmsink socket-path=/tmp/rtsp.sock shm-size=20000000 \
          wait-for-connection=false sync=false
