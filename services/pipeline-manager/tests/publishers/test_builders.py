from __future__ import annotations

import pytest

from pipeline_manager.models import PublisherId
from pipeline_manager.publishers.audio import build_audio_publisher
from pipeline_manager.publishers.rtsp import RtspCredentials, build_rtsp_publisher, redact_rtsp_argv
from pipeline_manager.publishers.usb import build_usb_publisher


class TestUsbPublisher:
    def test_exact_ring_size(self) -> None:
        spec = build_usb_publisher("/dev/video0")
        assert "shm-size=64000000" in spec.argv

    def test_exact_socket(self) -> None:
        spec = build_usb_publisher("/dev/video0")
        assert "socket-path=/tmp/usb.sock" in spec.argv

    def test_wait_for_connection_false(self) -> None:
        spec = build_usb_publisher("/dev/video0")
        assert "wait-for-connection=false" in spec.argv

    def test_raw_nv12_1080p60(self) -> None:
        spec = build_usb_publisher("/dev/video0")
        assert "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1" in spec.argv

    def test_no_decode_elements(self) -> None:
        spec = build_usb_publisher("/dev/video0")
        assert "mppvideodec" not in spec.argv
        assert "h264parse" not in spec.argv


class TestRtspPublisher:
    @pytest.mark.parametrize(
        "publisher_id,socket,ring",
        [(PublisherId.RTSP, "/tmp/rtsp.sock", 20_000_000), (PublisherId.RTSP2, "/tmp/rtsp2.sock", 20_000_000)],
    )
    def test_exact_socket_and_ring(self, publisher_id: PublisherId, socket: str, ring: int) -> None:
        spec = build_rtsp_publisher(publisher_id, "rtsp://10.20.4.30/presentation")
        assert f"socket-path={socket}" in spec.argv
        assert f"shm-size={ring}" in spec.argv

    def test_tcp_and_100ms_latency(self) -> None:
        spec = build_rtsp_publisher(PublisherId.RTSP, "rtsp://10.20.4.30/presentation")
        assert "protocols=tcp" in spec.argv
        assert "latency=100" in spec.argv

    def test_cameras_are_not_decoded(self) -> None:
        spec = build_rtsp_publisher(PublisherId.RTSP, "rtsp://10.20.4.30/presentation")
        assert "mppvideodec" not in spec.argv
        assert "videoconvert" not in spec.argv

    def test_h264_byte_stream_wire_format(self) -> None:
        spec = build_rtsp_publisher(PublisherId.RTSP, "rtsp://10.20.4.30/presentation")
        assert "video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1" in spec.argv

    def test_wait_for_connection_false(self) -> None:
        spec = build_rtsp_publisher(PublisherId.RTSP, "rtsp://10.20.4.30/presentation")
        assert "wait-for-connection=false" in spec.argv

    def test_rejects_non_rtsp_publisher_id(self) -> None:
        with pytest.raises(ValueError):
            build_rtsp_publisher(PublisherId.USB, "rtsp://x")

    def test_credentials_are_discrete_property_tokens_not_in_url(self) -> None:
        creds = RtspCredentials(username="lecturer", password="s3cr3t")
        spec = build_rtsp_publisher(PublisherId.RTSP, "rtsp://10.20.4.30/presentation", creds)
        assert "location=rtsp://10.20.4.30/presentation" in spec.argv
        assert "user-id=lecturer" in spec.argv
        assert "user-pw=s3cr3t" in spec.argv
        # never embedded into the URL token itself
        assert not any("s3cr3t" in token and token.startswith("location=") for token in spec.argv)

    def test_redaction_hides_credentials(self) -> None:
        creds = RtspCredentials(username="lecturer", password="s3cr3t")
        spec = build_rtsp_publisher(PublisherId.RTSP, "rtsp://10.20.4.30/presentation", creds)
        redacted = redact_rtsp_argv(spec.argv)
        assert "user-pw=s3cr3t" not in redacted
        assert "user-id=lecturer" not in redacted
        assert any("redacted" in token for token in redacted)


class TestAudioPublisher:
    def test_exact_ring_and_socket(self) -> None:
        spec = build_audio_publisher("hw:1,0")
        assert "shm-size=4000000" in spec.argv
        assert "socket-path=/tmp/audio.sock" in spec.argv

    def test_s16le_48khz_stereo(self) -> None:
        spec = build_audio_publisher("hw:1,0")
        assert "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved" in spec.argv

    def test_wait_for_connection_false(self) -> None:
        spec = build_audio_publisher("hw:1,0")
        assert "wait-for-connection=false" in spec.argv
