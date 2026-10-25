"""Zip a staged Foundry module folder.

Foundry's installer expects module.json at the root of the archive, so every
entry is written relative to the staged folder instead of wrapping it in a
top-level directory.

usage: python tools/zip.py <source-dir> <output.zip>
"""

import os
import sys
import zipfile


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: zip.py <source-dir> <output.zip>", file=sys.stderr)
        return 2
    source, output = sys.argv[1], sys.argv[2]

    if not os.path.isfile(os.path.join(source, "module.json")):
        print(f"{source} has no module.json at its root", file=sys.stderr)
        return 1

    entries = []
    for base, dirs, names in os.walk(source):
        dirs.sort()
        names.sort()
        for name in names:
            full = os.path.join(base, name)
            if os.path.islink(full):
                continue
            relative = os.path.relpath(full, source).replace(os.sep, "/")
            entries.append((full, relative))
    entries.sort(key=lambda entry: entry[1])

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for full, relative in entries:
            archive.write(full, relative)

    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        if "module.json" not in names:
            print("module.json is not at the zip root", file=sys.stderr)
            return 1
        unsafe = [n for n in names if n.startswith("/") or ".." in n.split("/")]
        if unsafe:
            print(f"refusing to ship unsafe paths: {unsafe}", file=sys.stderr)
            return 1

    size = os.path.getsize(output)
    print(f"zip: {len(entries)} files, {size} bytes -> {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
