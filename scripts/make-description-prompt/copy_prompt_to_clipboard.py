#!/usr/bin/env python3

import subprocess
import sys
from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent / "gen-prompts"


def copy_to_clipboard(text: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text.encode(), check=True)
    elif sys.platform == "linux":
        subprocess.run(
            ["xclip", "-selection", "clipboard"], input=text.encode(), check=True
        )
    else:
        subprocess.run(["clip"], input=text.encode(), check=True)


def main() -> int:
    prompts = sorted(PROMPT_DIR.glob("*.txt"))
    if not prompts:
        print("No prompt files found in gen-prompts/", file=sys.stderr)
        return 1

    total = len(prompts)
    for i, path in enumerate(prompts, 1):
        text = path.read_text(encoding="utf-8")
        copy_to_clipboard(text)
        if i < total:
            input(f"[{i}/{total}] Copied '{path.name}' — press Enter for next")
        else:
            print(f"[{i}/{total}] Copied '{path.name}' — done!")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
