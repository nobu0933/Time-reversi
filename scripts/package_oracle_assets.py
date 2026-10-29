"""Package local Oracle training assets separately from the public Git tree."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "oracle-pro-learning-assets.zip"
EXPECTED = {
    "python_ai/pretrained/oracle-weight.rs":
        "6fe8fb524772986986a0c9ddd8275664ecf4cc81a8915ea7b9bb00bb703f3f6a",
    "python_ai/pretrained/oracle-opening-tree.dat":
        "ddd6a49aa51913050181890f42344afdd863ca636727efb5f740ce73c68d5205",
    "python_ai/pretrained/oracle-opening-data.dat":
        "05700af9046fa97f7e5d0621ca6c6db2f90c9f515b6704e3e2462077ff786a03",
    "python_ai/runs/oracle-opening-pretrain-v1.pt":
        "ef9be45acacf861574f9a0c5c97be7c87dba99f999cc8cf0d1ef5c9f27d816aa",
}
README = """TIME REVERSI — Oracle PRO learning assets

These files are separate from the public Git repository. Extract this ZIP into
the repository root (the directory containing index.html). The archive keeps
the required python_ai/pretrained/ and python_ai/runs/ paths. Existing game
code, MID weights and Python environment are not replaced.

Then follow python_ai/PRO_TRAINING_GUIDE.md to create a Python environment and
start the TIME REVERSI self-play training. The included checkpoint already
contains the recommended Oracle-based pretraining, so pretraining need not be
repeated.

See python_ai/pretrained/ORACLE_SOURCE.md for provenance and SHA-256 hashes.
"""


def main() -> None:
    payload = {}
    for name, expected_hash in EXPECTED.items():
        path = ROOT / name
        if not path.is_file():
            raise SystemExit(f"Missing required file: {path}")
        content = path.read_bytes()
        actual_hash = sha256(content).hexdigest()
        if actual_hash != expected_hash:
            raise SystemExit(f"SHA-256 mismatch for {path}: {actual_hash}")
        payload[name] = content

    provenance = ROOT / "python_ai/pretrained/ORACLE_SOURCE.md"
    payload["python_ai/pretrained/ORACLE_SOURCE.md"] = provenance.read_bytes()
    payload["ORACLE_ASSETS_README.txt"] = README.encode("utf-8")
    manifest = "".join(
        f"{sha256(content).hexdigest()}  {name}\n"
        for name, content in sorted(payload.items())
    )
    payload["SHA256SUMS.txt"] = manifest.encode("ascii")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in payload.items():
            archive.writestr(name, content)

    with ZipFile(OUTPUT) as archive:
        bad_member = archive.testzip()
        if bad_member is not None:
            raise SystemExit(f"Corrupt ZIP member: {bad_member}")
        for name, expected_hash in EXPECTED.items():
            if sha256(archive.read(name)).hexdigest() != expected_hash:
                raise SystemExit(f"Verification failed for ZIP member: {name}")
    print(f"Created and verified {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
