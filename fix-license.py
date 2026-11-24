from pathlib import Path

ROOT = Path(__file__).parent

HEADER = """Copyright (C) 2026 DON:E (Elias Toft Hansen)
SPDX-License-Identifier: AGPL-3.0-or-later
"""

EXTENSIONS = {
    ".cs": "//",
    ".js": "//",
    ".ts": "//",
    ".tsx": "//",
    ".jsx": "//",
    ".py": "#",
    ".sh": "#",
}

SKIP_DIRS = {
    ".git", "node_modules", "bin", "obj",
    "dist", "build", "vendor"
}

for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in EXTENSIONS:
        continue

    if any(part in SKIP_DIRS for part in path.parts):
        continue

    content = path.read_text(encoding="utf-8")

    if "SPDX-License-Identifier:" in content:
        continue

    prefix = EXTENSIONS[path.suffix]
    header = "\n".join(
        f"{prefix} {line}" for line in HEADER.splitlines()
    )

    path.write_text(header + "\n\n" + content, encoding="utf-8")
    print(f"Updated: {path.relative_to(ROOT)}")

print("Finished!")