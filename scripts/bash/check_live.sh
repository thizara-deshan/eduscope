#!/bin/bash
# Run BEFORE going live: verifies plugins + nginx/stunnel + a real test push.
echo "=== required gstreamer elements ==="
for e in rtmpsink flvmux voaacenc aacparse mpph264enc mppvideodec; do
  gst-inspect-1.0 $e >/dev/null 2>&1 && echo "  OK   $e" || echo "  MISS $e   <-- sudo apt install gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly"
done
echo "=== services ==="
systemctl is-active nginx    >/dev/null && echo "  nginx OK"    || echo "  nginx DOWN"
systemctl is-active stunnel4 >/dev/null && echo "  stunnel4 OK" || echo "  stunnel4 DOWN"
echo "=== ports (1935 nginx-rtmp, 1936 stunnel) ==="
sudo ss -tulpn | grep -E ':1935|:1936' || echo "  no listeners!"
echo "=== nginx push directive present? ==="
grep -A6 'application live' /etc/nginx/nginx.conf | grep -q 'push' \
  && grep -A6 'application live' /etc/nginx/nginx.conf | grep 'push' \
  || echo "  WARNING: no 'push' line -> nginx will NOT forward to stunnel/platform"
echo "=== 10s test push -> rtmp://127.0.0.1:1935/live/${1:-test} ==="
timeout 12 gst-launch-1.0 -e \
  videotestsrc is-live=true ! video/x-raw,width=1280,height=720,framerate=30/1 ! \
  videoconvert ! mpph264enc bps=2000000 rc-mode=cbr gop=60 ! h264parse ! queue ! mux. \
  audiotestsrc is-live=true ! audioconvert ! voaacenc bitrate=128000 ! aacparse ! queue ! mux. \
  flvmux name=mux streamable=true ! rtmpsink location="rtmp://127.0.0.1:1935/live/${1:-test} live=1" 2>&1 | tail -4
echo "=== stunnel log ==="
sudo tail -5 /var/log/stunnel4/stunnel.log 2>/dev/null || echo "  (no log yet)"
