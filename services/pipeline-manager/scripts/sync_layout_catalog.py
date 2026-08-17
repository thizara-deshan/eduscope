from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "packages/shared/src/constants/layout-presets.json"
TARGET = ROOT / "services/pipeline-manager/src/pipeline_manager/resources/layout-presets.v1.json"


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, TARGET)


if __name__ == "__main__":
    main()
