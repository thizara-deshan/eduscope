from pipeline_manager.display import worker_argv
from pipeline_manager.pipelines.builder import DisplayOut, DisplayPlacement


def test_display_worker_receives_graph_and_second_display_geometry() -> None:
    placement = DisplayPlacement(
        output=DisplayOut.HDMI_2, x=1920, y=0, width=1920, height=1080, fullscreen=True
    )
    argv = worker_argv(
        ["gst-launch-1.0", "-e", "-m", "videotestsrc", "!", "xvimagesink", "sync=false"],
        placement,
        python_executable="python3",
    )
    assert argv[:3] == ["python3", "-m", "pipeline_manager.display"]
    assert argv[argv.index("--graph") + 1] == "videotestsrc ! xvimagesink sync=false"
    assert argv[argv.index("--x") + 1] == "1920"
    assert argv[argv.index("--width") + 1] == "1920"
