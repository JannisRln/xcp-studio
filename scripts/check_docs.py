#!/usr/bin/env python3
"""Validate source-controlled tickets, requirement mapping and documentation links.

This checker intentionally uses only the Python standard library so it can run
on a clean Windows CI agent without installing extra dependencies.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
TICKETS = DOCS / "tickets"
REQUIREMENTS = DOCS / "requirements.md"
INDEX = TICKETS / "INDEX.md"

STATUS = {"backlog", "ready", "in-progress", "blocked", "review", "done"}
PRIORITY = {"P0", "P1", "P2"}
REQUIRED_FIELDS = {
    "id", "title", "status", "priority", "area", "owner", "branch",
    "github_issue", "depends_on", "requirements",
}
REQUIRED_SECTIONS = [
    "Context / desired behavior",
    "Scope",
    "Non-goals",
    "Owned paths and interface boundaries",
    "Acceptance criteria",
    "Verification plan",
    "Dependencies / handoff",
    "Evidence and completion",
]
ID_PATTERN = re.compile(r"T-\d{4}")
REQ_PATTERN = re.compile(r"[A-Z]+-\d{3}")
LINK_PATTERN = re.compile(r"(?<!!)\[[^\]\n]+\]\(([^)]+)\)")


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def require(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)


def frontmatter(path: Path, report: Report) -> tuple[dict[str, str], str]:
    data = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", data, re.DOTALL)
    if not match:
        report.errors.append(f"{path.relative_to(ROOT)}: missing initial YAML frontmatter")
        return {}, data
    fields: dict[str, str] = {}
    for lineno, line in enumerate(match.group(1).splitlines(), start=2):
        if not line.strip():
            continue
        if ":" not in line:
            report.errors.append(f"{path.relative_to(ROOT)}:{lineno}: invalid metadata")
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if key in fields:
            report.errors.append(f"{path.relative_to(ROOT)}:{lineno}: duplicate field {key}")
        fields[key] = value
    report.require(REQUIRED_FIELDS <= fields.keys(),
                   f"{path.relative_to(ROOT)}: missing {sorted(REQUIRED_FIELDS - fields.keys())}")
    return fields, data[match.end():]


def parse_list(raw: str, label: str, report: Report) -> list[str]:
    if not (raw.startswith("[") and raw.endswith("]")):
        report.errors.append(f"{label}: expected a one-line bracket list")
        return []
    items = [item.strip() for item in raw[1:-1].split(",") if item.strip()]
    report.require(len(items) == len(set(items)), f"{label}: duplicate entries")
    return items


def requirement_rows(report: Report) -> dict[str, str]:
    rows: dict[str, str] = {}
    for number, line in enumerate(REQUIREMENTS.read_text(encoding="utf-8").splitlines(), 1):
        fields = [field.strip() for field in line.strip().strip("|").split("|")]
        if not fields or not REQ_PATTERN.fullmatch(fields[0]):
            continue
        req_id = fields[0]
        if req_id in rows:
            report.errors.append(f"requirements.md:{number}: duplicate requirement {req_id}")
        report.require(len(fields) >= 5 and bool(ID_PATTERN.fullmatch(fields[-1])),
                       f"requirements.md:{number}: invalid ticket mapping for {req_id}")
        rows[req_id] = fields[-1]
    report.require(bool(rows), "requirements.md: no requirement table entries found")
    return rows


def check_tickets(requirements: dict[str, str], report: Report) -> dict[str, dict]:
    records: dict[str, dict] = {}
    paths = sorted(TICKETS.glob("T-[0-9][0-9][0-9][0-9]-*.md"))
    report.require(bool(paths), "docs/tickets: no numbered Markdown tickets found")
    for path in paths:
        metadata, body = frontmatter(path, report)
        if not metadata:
            continue
        tid = metadata.get("id", "")
        location = str(path.relative_to(ROOT))
        report.require(bool(ID_PATTERN.fullmatch(tid)), f"{location}: invalid ticket ID {tid}")
        report.require(path.name.startswith(tid + "-"), f"{location}: ID mismatches filename")
        report.require(tid not in records, f"{location}: duplicate ticket ID {tid}")
        report.require(metadata.get("status") in STATUS, f"{location}: invalid status")
        report.require(metadata.get("priority") in PRIORITY, f"{location}: invalid priority")
        report.require(bool(metadata.get("title")), f"{location}: title cannot be empty")
        report.require(bool(metadata.get("area")), f"{location}: area cannot be empty")
        report.require(bool(metadata.get("owner")), f"{location}: owner cannot be empty")
        report.require(bool(metadata.get("branch")), f"{location}: branch cannot be empty")
        issue = metadata.get("github_issue", "")
        report.require(issue == "none" or (issue.isdigit() and int(issue) > 0),
                       f"{location}: github_issue must be a positive integer or none")
        if metadata.get("status") in {"in-progress", "review"}:
            report.require(metadata.get("owner") != "unassigned" and metadata.get("branch") != "none",
                           f"{location}: active ticket must have claimed owner and branch")
        if metadata.get("status") == "done":
            report.require("pending" not in body.split("## Evidence and completion")[-1].lower(),
                           f"{location}: done ticket still has pending evidence")
        for section in REQUIRED_SECTIONS:
            report.require(f"## {section}\n" in body, f"{location}: missing section {section}")
        dependencies = parse_list(metadata.get("depends_on", "invalid"),
                                  f"{location}: depends_on", report)
        reqs = parse_list(metadata.get("requirements", "invalid"),
                          f"{location}: requirements", report)
        report.require(bool(reqs), f"{location}: no requirement IDs")
        for dependency in dependencies:
            report.require(bool(ID_PATTERN.fullmatch(dependency)),
                           f"{location}: invalid dependency {dependency}")
            report.require(dependency != tid, f"{location}: self dependency")
        for req in reqs:
            report.require(bool(REQ_PATTERN.fullmatch(req)), f"{location}: invalid requirement {req}")
            report.require(req in requirements, f"{location}: undefined requirement {req}")
        records[tid] = {
            "path": path, "status": metadata.get("status"),
            "priority": metadata.get("priority"), "dependencies": dependencies,
            "requirements": reqs,
        }
    for tid, record in records.items():
        for dep in record["dependencies"]:
            report.require(dep in records, f"{tid}: unknown dependency {dep}")
        if record["status"] == "blocked":
            report.require(bool(record["dependencies"]) or "blocker" in
                           record["path"].read_text(encoding="utf-8").lower(),
                           f"{tid}: blocked ticket must explain its blocker")
    return records


def check_graph(tickets: dict[str, dict], report: Report) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(tid: str) -> None:
        if tid in visiting:
            report.errors.append(f"dependency cycle includes {tid}")
            return
        if tid in visited:
            return
        visiting.add(tid)
        for dep in tickets[tid]["dependencies"]:
            if dep in tickets:
                visit(dep)
        visiting.remove(tid)
        visited.add(tid)

    for tid in tickets:
        visit(tid)


def check_index(tickets: dict[str, dict], report: Report) -> None:
    lines = INDEX.read_text(encoding="utf-8").splitlines()
    found: dict[str, str] = {}
    for number, line in enumerate(lines, start=1):
        match = re.match(
            r"^\|\s*(T-\d{4})\s*\|\s*\[[^]]+\]\((T-\d{4}-[^)]+\.md)\)"
            r"\s*\|\s*(P[012])\s*\|\s*([a-z-]+)\s*\|", line
        )
        if not match:
            continue
        tid, name, priority, status = match.groups()
        report.require(tid not in found, f"INDEX.md:{number}: duplicate {tid}")
        found[tid] = name
        report.require(tid in tickets, f"INDEX.md:{number}: nonexistent {tid}")
        if tid in tickets:
            ticket = tickets[tid]
            report.require(ticket["path"].name == name,
                           f"INDEX.md:{number}: wrong ticket filename for {tid}")
            report.require(ticket["status"] == status and ticket["priority"] == priority,
                           f"INDEX.md:{number}: metadata status/priority differs for {tid}")
    report.require(set(found) == set(tickets),
                   f"INDEX.md: tickets missing/extra: {sorted(set(tickets) ^ set(found))}")


def check_requirement_mapping(requirements: dict[str, str],
                              tickets: dict[str, dict], report: Report) -> None:
    used: dict[str, set[str]] = defaultdict(set)
    for tid, ticket in tickets.items():
        for req in ticket["requirements"]:
            used[req].add(tid)
    for req, mapped in requirements.items():
        report.require(bool(used[req]), f"{req}: not referenced by any ticket")
        report.require(mapped in used[req],
                       f"{req}: requirements table maps to {mapped}, but ticket does not list {req}")


def check_links(report: Report) -> None:
    documents = sorted(DOCS.rglob("*.md"))
    documents.extend([ROOT / "README.md", ROOT / "AGENTS.md",
                      ROOT / ".github" / "PULL_REQUEST_TEMPLATE.md"])
    for document in documents:
        text = document.read_text(encoding="utf-8")
        for target in LINK_PATTERN.findall(text):
            parsed = urlsplit(target.strip())
            if parsed.scheme or target.startswith("#") or target.startswith("//"):
                continue
            path = unquote(parsed.path)
            if not path:
                continue
            resolved = (document.parent / path).resolve()
            report.require(resolved.is_relative_to(ROOT) and resolved.exists(),
                           f"{document.relative_to(ROOT)}: broken or escaping link {target}")


def main() -> int:
    report = Report()
    requirements = requirement_rows(report)
    tickets = check_tickets(requirements, report)
    check_graph(tickets, report)
    check_index(tickets, report)
    check_requirement_mapping(requirements, tickets, report)
    check_links(report)
    if report.errors:
        for message in report.errors:
            print(f"ERROR: {message}", file=sys.stderr)
        print(f"Documentation validation failed: {len(report.errors)} problem(s).", file=sys.stderr)
        return 1
    print(f"Documentation OK: {len(tickets)} tickets, {len(requirements)} requirements, "
          f"dependency graph, index and Markdown links verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
