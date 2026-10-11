"""Build a reproducible Zotero XPI with standard-library Python only."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = {name: name for name in (
    "manifest.json", "bootstrap.js", "autostart.js", "keepzotero-native.js",
    "preferences.xhtml", "preferences.js", "prefs.js", "LICENSE", "NOTICE.md",
)}
FILES.update({
    "tray-worker.js": "content/tray-worker.js",
    "keepzotero-tray.dll": "native/keepzotero-tray.dll",
    "tray-bridge.c": "native/tray-bridge.c",
})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild-native", action="store_true")
    parser.add_argument("--gcc", default="gcc", help="MinGW-w64 x64 GCC executable")
    args = parser.parse_args()
    if args.rebuild_native:
        subprocess.run([
            args.gcc, "-shared", "-nostdlib", "-Os", "-s", "-Wl,--entry,0",
            "-Wl,--no-insert-timestamp", "tray-bridge.c",
            "-o", "keepzotero-tray.dll", "-luser32",
        ], cwd=ROOT, check=True)

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    version = manifest["version"]
    output = ROOT / f"keepzotero-zotero10-tray-{version}.xpi"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source, target in sorted(FILES.items(), key=lambda pair: pair[1]):
            data = (ROOT / source).read_bytes()
            entry = zipfile.ZipInfo(target, date_time=(2026, 10, 11, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Corrupt package")
        for source, target in FILES.items():
            assert archive.read(target) == (ROOT / source).read_bytes(), target

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT / "SHA256SUMS").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    app = manifest["applications"]["zotero"]
    updates = {"addons": {app["id"]: {"updates": [{
        "version": version,
        "update_link": f"{manifest['homepage_url']}/raw/refs/heads/main/{output.name}",
        "update_hash": f"sha256:{digest}",
        "applications": {"zotero": {
            "strict_min_version": app["strict_min_version"],
            "strict_max_version": app["strict_max_version"],
        }},
    }]}}}
    (ROOT / "keepzotero-update.json").write_text(
        json.dumps(updates, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Built {output.name} ({output.stat().st_size} bytes)")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
