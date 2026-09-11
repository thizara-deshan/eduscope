#!/usr/bin/env python3
import argparse
import ipaddress
import json
import os
import pathlib
import grp
import secrets as random_secrets
import stat
import sys
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator


ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load(path: pathlib.Path, schema_path: pathlib.Path, *, required_uid: int = 0):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ValueError(f"{path}: must be a regular non-symlink file")
    if info.st_uid != required_uid:
        raise ValueError(f"{path}: owner UID must be {required_uid}")
    if stat.S_IMODE(info.st_mode) & ~0o640:
        raise ValueError(f"{path}: mode must be no broader than 0640")
    value = json.loads(path.read_text())
    schema = json.loads(schema_path.read_text())
    errors = sorted(Draft202012Validator(schema).iter_errors(value), key=lambda error: list(error.path))
    if errors:
        raise ValueError("; ".join(f"{'.'.join(map(str, error.path)) or '(root)'}: {error.message}" for error in errors))
    return value


def _identity(name: str):
    try:
        return 0, grp.getgrnam(name).gr_gid
    except KeyError:
        raise ValueError(f"required service group does not exist: {name}")


def _atomic_write(directory: pathlib.Path, name: str, content: str, mode: int, uid: int, gid: int):
    if '/' in name or name in {'.', '..'}:
        raise ValueError("invalid output name")
    directory.mkdir(parents=True, exist_ok=True)
    dir_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temp_name = f".{name}.{os.getpid()}.{random_secrets.token_hex(6)}.tmp"
    try:
        try:
            current = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            if stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode):
                raise ValueError(f"refusing non-regular output: {directory / name}")
        except FileNotFoundError:
            pass
        fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=dir_fd)
        try:
            os.write(fd, content.encode())
            os.fsync(fd)
            os.fchmod(fd, mode)
            try:
                os.fchown(fd, uid, gid)
            except PermissionError:
                if (uid, gid) != (os.getuid(), os.getgid()):
                    raise
        finally:
            os.close(fd)
        os.replace(temp_name, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        os.fsync(dir_fd)
    finally:
        try:
            os.unlink(temp_name, dir_fd=dir_fd)
        except FileNotFoundError:
            pass
        os.close(dir_fd)


def _write_outputs(files, output_root: pathlib.Path, public_output_root: pathlib.Path):
    for relative, (content, mode, (uid, gid)) in files.items():
        path = pathlib.PurePosixPath(relative)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('invalid output path')
        _atomic_write(output_root / pathlib.Path(*path.parts[:-1]), path.name, content, mode, uid, gid)

    public_output_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    os.chmod(public_output_root, 0o755)
    public_content = files['config.json'][0]
    _atomic_write(public_output_root, 'config.json', public_content, 0o644, os.getuid(), os.getgid())


def _env(lines):
    for value in lines.values():
        if '\n' in str(value) or '\r' in str(value):
            raise ValueError("environment values may not contain control characters")
    return ''.join(f"{key}={value}\n" for key, value in lines.items())


def _validate_llm_endpoint(endpoint, profile):
    if endpoint is None:
        return
    parsed = urlsplit(endpoint)
    if parsed.scheme == 'https':
        return
    if profile != 'demo-staging':
        raise ValueError('production requires HTTPS for llmEndpoint')
    try:
        private_host = ipaddress.ip_address(parsed.hostname or '').is_private
    except ValueError:
        private_host = False
    if parsed.scheme != 'http' or not private_host:
        raise ValueError('demo-staging HTTP llmEndpoint must use a private IP address')


def render(manifest, provisioning, secrets, profile):
    _validate_llm_endpoint(manifest['integrations']['llmEndpoint'], profile)
    quiz_origin = manifest['integrations']['quizPublicOrigin'] or 'https://quiz.campus.invalid'
    public = {"apiBaseUrl": "/api/v1", "quizBaseUrl": quiz_origin, "environment": "production", "adapters": {"default": "real", "overrides": {}}, "deploymentProfile": profile, "notices": [] if profile == 'production' else ["placeholder / firmware acceptance still open"]}
    bootstrap = {"version": 1, "wiredInterface": manifest['network']['wiredInterface'], "inputs": {"presentation": {"kind": "v4l2", "address": "/dev/eduscope/pc-capture"}, "lecturer-cam": {"kind": "rtsp", "address": provisioning['rtsp']['lecturer-cam']}, "students-cam": {"kind": "rtsp", "address": provisioning['rtsp']['students-cam']}, "mic-lecturer": {"kind": "alsa", "address": "eduscope_mic"}}, "bootstrapAdmin": {**provisioning['bootstrapAdmin'], "passwordFile": "/etc/eduscope/bootstrap-admin.password"}}
    core_provisioning = {"deviceId": provisioning['deviceId'], "serialNumber": manifest['board']['serial'], "instituteProfileId": provisioning['instituteProfileId'], "hallCode": manifest['integrations']['hallCode'], "hallDisplayName": provisioning['hallDisplayName'], "titlePattern": manifest['integrations']['titlePattern'], "timezone": manifest['integrations']['timezone'], "ntpServers": manifest['integrations']['ntpServers'], "expectedStorageVolumeUuid": manifest['storage']['recordingsUuid'], "featureFlags": provisioning['featureFlags'], "quizServerBaseUrl": manifest['integrations']['quizPublicOrigin'], "quizDeviceCredential": secrets['quizDeviceCredential'], "llmEndpoint": manifest['integrations']['llmEndpoint'], "provisionedAt": provisioning['provisionedAt'], "provisionedBy": provisioning['provisionedBy']}
    common = secrets['internalBearer']
    files = {
      'config.json': (json.dumps(public, separators=(',', ':')) + '\n', 0o644, (0, 0)),
      'device-bootstrap.json': (json.dumps(bootstrap, separators=(',', ':')) + '\n', 0o640, _identity('eduscope-core')),
      'provisioning.json': (json.dumps(core_provisioning, separators=(',', ':')) + '\n', 0o640, _identity('eduscope-core')),
      'env/core.env': (_env({'NODE_ENV':'production','CORE_API_HOST':'127.0.0.1','CORE_API_PORT':5000,'CORE_API_DB_PATH':'/var/lib/eduscope/core.db','CORE_API_RECORDINGS_ROOT':'/media/eduscope','CORE_API_RUNTIME_DIR':'/run/eduscope','CORE_API_PROVISIONING_PATH':'/etc/eduscope/provisioning.json','CORE_API_DEVICE_BOOTSTRAP_PATH':'/run/eduscope/device-bootstrap.json','CORE_API_BOOTSTRAP_ADMIN_PASSWORD_FILE':'/etc/eduscope/bootstrap-admin.password','CORE_API_HELPER_SOCKET':'/run/eduscope/helper.sock','CORE_API_PM_BASE_URL':'http://127.0.0.1:8091','CORE_API_INTERNAL_BEARER':common,'CORE_API_JWT_SECRET':secrets['jwtSecret'],'CORE_API_SECRETBOX_KEY':secrets['secretboxKey'],'EDUSCOPE_CORE_LOG_MAX_ROWS':50000,'EDUSCOPE_CORE_LOG_MAX_AGE_DAYS':90}), 0o640, _identity('eduscope-core')),
      'env/pipeline.env': (_env({'EDUSCOPE_PM_BIND_HOST':'127.0.0.1','EDUSCOPE_PM_PORT':8091,'EDUSCOPE_PM_PLATFORM_ID':'rk3588','EDUSCOPE_PM_SHARED_BEARER_TOKEN':common,'EDUSCOPE_PM_RECORDINGS_ROOT':'/media/eduscope','EDUSCOPE_PM_RUNTIME_ROOT':'/run/eduscope','EDUSCOPE_PM_HELPER_SOCKET':'/run/eduscope/helper.sock','EDUSCOPE_PM_RUNTIME_DIR':'/run/eduscope/pipeline-manager','EDUSCOPE_PM_CAPTURE_CARD_STABLE_IDENTIFIER':'/dev/eduscope/pc-capture','EDUSCOPE_PM_CAPTURE_CARD_HUB_LOCATION':manifest['capture']['hubLocation'],'EDUSCOPE_PM_CAPTURE_CARD_HUB_PORT':manifest['capture']['hubPort'],'EDUSCOPE_PM_LED_PRESENT':str(manifest['led']['present']).lower(),'EDUSCOPE_PM_MIC_ALSA_CARD':manifest['audio']['micCardId'],'EDUSCOPE_PM_MIC_ALSA_CONTROL':manifest['audio']['micControl'],'EDUSCOPE_PM_HDMI2_ALSA_DEVICE':'eduscope_meeting_hdmi'}), 0o640, _identity('eduscope-pipeline')),
      'env/stt.env': (_env({'EDUSCOPE_STT_BIND_HOST':'127.0.0.1','EDUSCOPE_STT_PORT':7101,'EDUSCOPE_STT_INTERNAL_BEARER':common,'EDUSCOPE_STT_AUDIO_SOCKET':'/tmp/audio.sock','EDUSCOPE_STT_MODEL_PATH':'/opt/eduscope/models/vosk-model-en-us-0.22','EDUSCOPE_STT_MODEL_VERSION':'vosk-model-en-us-0.22'}), 0o640, _identity('eduscope-ai')),
      'env/slide.env': (_env({'EDUSCOPE_SLIDE_BIND_HOST':'127.0.0.1','EDUSCOPE_SLIDE_PORT':7102,'EDUSCOPE_SLIDE_INTERNAL_BEARER':common,'EDUSCOPE_SLIDE_RUNTIME_ROOT':'/run/eduscope','EDUSCOPE_SLIDE_RECORDINGS_ROOT':'/media/eduscope'}), 0o640, _identity('eduscope-ai')),
      'env/question.env': (_env({'EDUSCOPE_QUESTION_BIND_HOST':'127.0.0.1','EDUSCOPE_QUESTION_PORT':7103,'EDUSCOPE_QUESTION_INTERNAL_BEARER':common,'EDUSCOPE_QUESTION_GENERATION_DEADLINE_SECONDS':40}), 0o640, _identity('eduscope-ai')),
    }
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True, type=pathlib.Path)
    parser.add_argument('--provisioning', required=True, type=pathlib.Path)
    parser.add_argument('--secrets', required=True, type=pathlib.Path)
    parser.add_argument('--output-root', required=True, type=pathlib.Path)
    parser.add_argument('--public-output-root', default='/run/eduscope-public', type=pathlib.Path)
    parser.add_argument('--profile', choices=['production', 'demo-staging'], required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        manifest = _load(args.manifest, ROOT / 'provisioning/device-manifest.schema.json')
        provisioning = _load(args.provisioning, ROOT / 'provisioning/provisioning.schema.json')
        secret_values = _load(args.secrets, ROOT / 'provisioning/secrets.schema.json')
        files = render(manifest, provisioning, secret_values, args.profile)
        Draft202012Validator(json.loads((ROOT / 'runtime/device-bootstrap.schema.json').read_text())).validate(json.loads(files['device-bootstrap.json'][0]))
        if not args.check:
            _write_outputs(files, args.output_root, args.public_output_root)
        print('PASS runtime configuration')
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
