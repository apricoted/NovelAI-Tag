from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
PATTERN = re.compile(r"[?]v=20[0-9]{6}-cache[0-9]+")
TARGET_FILES = [
    ROOT / "site" / "index.html",
    ROOT / "site" / "strings.html",
    ROOT / "site" / "review.html",
]
TARGET_FILES.extend(sorted((ROOT / "site" / "assets").rglob("*.js")))


def main() -> int:
    leftovers = []
    for path in TARGET_FILES:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), 1):
            for match in PATTERN.finditer(line):
                rel = path.relative_to(ROOT).as_posix()
                leftovers.append(f"{rel}:{line_no}: {match.group(0)}")

    if leftovers:
        print("Found cache buster leftovers:")
        for item in leftovers:
            print(item)
        return 1

    print("OK: no JS/CSS cache buster leftovers found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
