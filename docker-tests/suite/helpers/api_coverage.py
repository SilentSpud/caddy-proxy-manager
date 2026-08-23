#!/usr/bin/env python3
"""API surface coverage for the docker integration suite.

    api_coverage.py OPENAPI_JSON CALLS_TSV

Line coverage is not reachable here — the application under test is a bundled
standalone server in another container, and instrumenting it would mean testing
something other than the artefact that ships. What *is* measurable, and is the
useful question for a black-box suite, is how much of the declared REST surface
the suite actually drove over the wire.

Each recorded call (`METHOD<TAB>/concrete/path`) is matched against the path
templates in the project's own OpenAPI document, so `/api/v1/proxy-hosts/42`
counts towards `/api/v1/proxy-hosts/{id}` without this script needing to know
which segments are identifiers. Calls that match nothing are reported
separately: they are either endpoints missing from the document or a typo in a
test, and both are worth seeing.

Exit status is always 0. This is a report, not a gate — a filtered run
(`./run.sh mtls`) or one with an optional group disabled legitimately touches
less of the surface, so a threshold here would fail for the wrong reasons.
"""

import json
import sys

HTTP_METHODS = ("get", "put", "post", "delete", "patch", "head", "options")

GREEN = "\033[32m"
YELLOW = "\033[33m"
DIM = "\033[2m"
BOLD = "\033[1m"
OFF = "\033[0m"


def segments(path):
    return [part for part in path.split("/") if part]


def is_placeholder(segment):
    return segment.startswith("{") and segment.endswith("}")


def template_matches(template_segs, call_segs):
    """A path template matches a concrete path when every literal segment is
    equal and every `{placeholder}` absorbs exactly one segment."""
    if len(template_segs) != len(call_segs):
        return False
    return all(
        is_placeholder(t) or t == c for t, c in zip(template_segs, call_segs)
    )


def generalise(path):
    """Collapse numeric segments so unmatched calls group into one line each
    rather than one per record id."""
    return "/" + "/".join(
        "{id}" if seg.isdigit() else seg for seg in segments(path)
    )


def load_operations(spec):
    """Every (METHOD, path-template) pair the document declares."""
    operations = []
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method in item:
            if method.lower() in HTTP_METHODS:
                operations.append((method.upper(), path))
    return sorted(set(operations), key=lambda op: (op[1], op[0]))


def load_calls(path):
    calls = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                parts = line.rstrip("\n").split("\t")
                if len(parts) == 2 and parts[0] and parts[1]:
                    calls.append((parts[0].upper(), parts[1]))
    except FileNotFoundError:
        pass
    return calls


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 0

    try:
        with open(argv[1], encoding="utf-8") as handle:
            spec = json.load(handle)
    except (OSError, ValueError) as error:
        print("api coverage: could not read the OpenAPI document (%s)" % error)
        return 0

    operations = load_operations(spec)
    if not operations:
        print("api coverage: the OpenAPI document declares no operations")
        return 0

    calls = load_calls(argv[2])
    templates = {path: segments(path) for _, path in operations}

    covered = set()
    unmatched = set()
    for method, call_path in calls:
        call_segs = segments(call_path)
        hit = False
        for op_method, op_path in operations:
            if op_method == method and template_matches(templates[op_path], call_segs):
                covered.add((op_method, op_path))
                hit = True
                break
        if not hit:
            unmatched.add((method, generalise(call_path)))

    missed = [op for op in operations if op not in covered]
    percent = 100.0 * len(covered) / len(operations)
    colour = GREEN if percent >= 80 else YELLOW

    print()
    print("%sAPI surface coverage%s %s(documented operations driven over the wire)%s"
          % (BOLD, OFF, DIM, OFF))
    print("  %s%d/%d operations — %.0f%%%s"
          % (colour, len(covered), len(operations), percent, OFF))

    if missed:
        print()
        print("  %snot exercised:%s" % (YELLOW, OFF))
        for method, path in missed:
            print("    %-6s %s" % (method, path))

    if unmatched:
        print()
        print("  %sexercised but not in the document:%s" % (DIM, OFF))
        for method, path in sorted(unmatched):
            print("    %-6s %s" % (method, path))

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
