#!/usr/bin/env python3
"""Fail when a package's source changed in a PR but its README did not.

Deterministic enforcement layer that complements the Kiro `package-docs-sync`
hook: the hook helps update docs live in an editing session, this check stops
source/doc drift from merging regardless of how the change was made.

Scope note: `docs.tealtiger.ai` lives in a *separate* repo
(github.com/agentguard-ai/TealTiger-Docs), so this check cannot verify that the
matching integration page was updated. It can only enforce the same-repo
README, and it prints a reminder naming the docs page that likely also needs a
change (to be handled in a TealTiger-Docs PR).

Usage:
    python check_package_docs_drift.py <changed_files_file>

where <changed_files_file> is a newline-delimited list of changed paths
(as produced by `git diff --name-only`). Exits non-zero on drift.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Source extensions that count as "public/behavioral" enough to require a doc look.
SRC_EXTS = {".py", ".ts", ".tsx", ".js"}

# Paths under a package's src/ that are NOT public surface -> ignored for drift.
IGNORE_SRC_SUBSTRINGS = (
    "/__tests__/",
    "/tests/",
    "test_",
    "_test.",
    ".test.",
    ".spec.",
)

PKG_SRC_RE = re.compile(r"^packages/(?P<pkg>[^/]+)/src/")
PKG_README_RE = re.compile(r"^packages/(?P<pkg>[^/]+)/README\.md$")


def docs_page_for(pkg: str) -> str:
    """Best-effort map a package name to its TealTiger-Docs integration page."""
    # `langchain-tealtiger` -> langchain ; `tealtiger-mcp` -> mcp
    name = pkg
    if name.endswith("-tealtiger"):
        name = name[: -len("-tealtiger")]
    elif name.startswith("tealtiger-"):
        name = name[len("tealtiger-") :]
    return f"TealTiger-Docs/integrations/{name}.mdx"


def is_public_src(path: str) -> bool:
    if not PKG_SRC_RE.match(path):
        return False
    if Path(path).suffix not in SRC_EXTS:
        return False
    lowered = path.lower()
    return not any(s in lowered for s in IGNORE_SRC_SUBSTRINGS)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_package_docs_drift.py <changed_files_file>", file=sys.stderr)
        return 2

    changed = [
        line.strip()
        for line in Path(argv[1]).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    pkgs_src_changed: set[str] = set()
    pkgs_readme_changed: set[str] = set()

    for path in changed:
        path = path.replace("\\", "/")
        if is_public_src(path):
            m = PKG_SRC_RE.match(path)
            if m:
                pkgs_src_changed.add(m.group("pkg"))
        rm = PKG_README_RE.match(path)
        if rm:
            pkgs_readme_changed.add(rm.group("pkg"))

    drifted = sorted(pkgs_src_changed - pkgs_readme_changed)

    if not pkgs_src_changed:
        print("No package src/ changes detected — nothing to check.")
        return 0

    for pkg in sorted(pkgs_src_changed):
        state = "README updated" if pkg in pkgs_readme_changed else "README NOT updated"
        print(f"  {pkg}: src changed, {state}")

    if not drifted:
        print("\nAll packages with src changes also updated their README. OK.")
        # Still remind about the separate docs repo.
        for pkg in sorted(pkgs_src_changed):
            print(f"  reminder: also review {docs_page_for(pkg)} in the TealTiger-Docs repo.")
        return 0

    print("\nERROR: source changed without a corresponding README update:", file=sys.stderr)
    for pkg in drifted:
        print(
            f"  - packages/{pkg}/src/ changed but packages/{pkg}/README.md did not.\n"
            f"    Update the README to match, and review {docs_page_for(pkg)} "
            f"in the TealTiger-Docs repo (separate PR).",
            file=sys.stderr,
        )
    print(
        "\nIf this change genuinely does not affect documented behavior, add the label "
        "'docs-not-needed' to the PR (see workflow) or touch the README with a no-op note "
        "explaining why no doc change was required.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
