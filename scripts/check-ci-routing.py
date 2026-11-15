#!/usr/bin/env python3
"""Keep the hand-spelled CI routing sites in agreement.

The candidate-CI routing (ci.yml's `route` job carries the full explanation)
spells the self-hosted pool's label set and the router's blob pin by hand, in
several places per workflow. Nothing at run time compares them, and each kind
of drift fails differently:

  * a forced-lane literal in `runs-on` that differs from the set the router
    counts asks for labels no runner may carry -- under
    UIBRIDGE_CI_LINUX_LANE=self-hosted that job queues until GitHub's 24 h
    limit;
  * a `# coord-pools:` line that differs from what `runs-on` requests makes the
    fleet's runner lints vouch for a set the job no longer asks for (or a
    routed `runs-on` with no such line is invisible to them);
  * a `--self-hosted-labels` that differs between workflows makes one router
    count a different queue than the jobs it routes land in;
  * a `want=` pin that is not the router's blob (as `git hash-object` computes
    it over the checked-out file) sends that workflow to the hosted floor on
    every run (safe, but silently);
  * a lane variable a routed `runs-on` reads that `.qontinui/ci-pool-variables.toml`
    does not declare with that same pool (or a declared variable no routed job
    reads) makes coord's pool-variable controller decide the wrong pool's
    health for it, or read it `declaration_mismatch` and decide nothing (plan
    2026-11-11-coord-owns-ci-lane-variables, Phase 2c);
  * a job that names the pool in `runs-on` outside the routed form (no route
    reference, or a `runs-on` folded over several lines) escapes every check
    above, so that is refused too, as is a workflow that invokes the router
    but routes no job.

This reads every workflow under .github/workflows and fails, naming file and
line, on any disagreement. It is text-level on purpose: the sites are comments
and string literals inside expressions, which a YAML parse does not expose.

Usage: check-ci-routing.py [REPO_ROOT]   (default: this script's repo)
Exit 0 = consistent, 1 = drift (each finding printed), 2 = nothing to check.
"""
import hashlib
import os
import re
import sys

ROUTER = os.path.join(".github", "scripts", "route-ci-lane.py")
DECLARATION = os.path.join(".qontinui", "ci-pool-variables.toml")
HOSTED = ["ubuntu-24.04"]

RE_FLAG = re.compile(r"--self-hosted-labels\s+(\S+)")
RE_PIN = re.compile(r"^\s*want=\"?([0-9a-f]{40})\"?\s*$")
RE_POOLS = re.compile(r"^\s*#\s*coord-pools:\s*\[([^\]]*)\]\s*\|\s*\[([^\]]*)\]\s*$")
RE_RUNS_ON = re.compile(r"^\s*runs-on:\s*(.*)$")
RE_FORCED = re.compile(r"'(\[\"self-hosted\"[^']*\])'")
RE_FLOOR = re.compile(r"\|\|\s*'(\[[^']*\])'\s*\)\s*\}\}\s*$")
RE_LANE = re.compile(r"vars\.([A-Za-z0-9_]+)\s*==\s*'self-hosted'")


def blob_sha(path):
    data = open(path, "rb").read()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def split_list(text):
    return [t.strip().strip('"') for t in text.split(",") if t.strip()]


def pool_key(labels):
    """coord's pool key: case-insensitive, order-insensitive, de-duplicated."""
    return sorted({l.lower() for l in labels})


def read_declaration(path):
    """{VARIABLE: [labels]} from the declaration, or (None, why).

    Mirrors the shape rules coord's parser enforces (qontinui-coord
    ci_pool_alerts/variables.rs `parse_declaration`): only a top-level
    `variables` array of tables, each with exactly `name` and `pool`, and no
    name declared twice (compared case-insensitively). coord refuses the WHOLE
    file on any of these, which leaves every lane in it undecided.
    """
    try:
        import tomllib
    except ImportError:
        return None, "cannot be checked: this needs Python 3.11+ (tomllib)"
    try:
        data = tomllib.loads(open(path, encoding="utf-8").read())
    except tomllib.TOMLDecodeError as e:
        return None, "does not parse: %s" % e
    extra = sorted(set(data) - {"variables"})
    if extra:
        return None, "unknown top-level key(s) %s; coord refuses the file" % extra
    entries = data.get("variables", [])
    if not isinstance(entries, list):
        return None, "`variables` must be an array of tables ([[variables]])"
    declared = {}
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            return None, "variables[%d] is not a table" % i
        extra = sorted(set(entry) - {"name", "pool"})
        if extra:
            return None, "variables[%d] has unknown key(s) %s; coord refuses the file" % (i, extra)
        name, pool = entry.get("name"), entry.get("pool")
        if not isinstance(name, str) or not isinstance(pool, list):
            return None, "variables[%d] needs a string `name` and a list `pool`" % i
        name = name.strip().upper()
        if name in declared:
            return None, "variables[%d]: %s is declared more than once; coord refuses the file" % (i, name)
        declared[name] = [str(l).strip() for l in pool]
    return declared, None


def check(root):
    findings = []
    lanes = []
    wf_dir = os.path.join(root, ".github", "workflows")
    router = os.path.join(root, ROUTER)
    router_blob = blob_sha(router) if os.path.exists(router) else None

    flags, pins, routed = [], [], 0
    for name in sorted(os.listdir(wf_dir)):
        if not name.endswith((".yml", ".yaml")):
            continue
        path = os.path.join(wf_dir, name)
        lines = open(path, encoding="utf-8").read().split("\n")
        invocations, file_routed = 0, 0
        for i, line in enumerate(lines):
            where = "%s:%d" % (os.path.join(".github", "workflows", name), i + 1)
            if "route-ci-lane.py" in line and "python" in line:
                invocations += 1
            m = RE_FLAG.search(line)
            if m:
                flags.append((where, split_list(m.group(1))))
            m = RE_PIN.match(line)
            if m:
                pins.append((where, m.group(1)))
            m = RE_RUNS_ON.match(line)
            if not m:
                continue
            if "needs.route.outputs.labels" not in m.group(1):
                if "self-hosted" in m.group(1):
                    findings.append("%s: runs-on names the pool outside the routed form" % where)
                elif m.group(1).strip() in ("", ">", ">-", "|", "|-"):
                    findings.append("%s: runs-on spans several lines; keep it on one line "
                                    "so this check can read it" % where)
                continue
            routed += 1
            file_routed += 1
            expr = m.group(1)
            forced = RE_FORCED.search(expr)
            floor = RE_FLOOR.search(expr)
            pools = RE_POOLS.match(lines[i - 1]) if i else None
            if not forced:
                findings.append("%s: routed runs-on has no forced-lane literal" % where)
            if not floor:
                findings.append("%s: routed runs-on has no hosted-floor literal" % where)
            if not pools:
                findings.append("%s: routed runs-on is not directly under a "
                                "`# coord-pools: [...] | [...]` line" % where)
                continue
            pool_set, floor_set = split_list(pools.group(1)), split_list(pools.group(2))
            if forced and split_list(forced.group(1)[1:-1]) != pool_set:
                findings.append("%s: forced-lane literal %s != coord-pools pool %s"
                                % (where, forced.group(1), pool_set))
            if floor and split_list(floor.group(1)[1:-1]) != floor_set:
                findings.append("%s: hosted-floor literal %s != coord-pools floor %s"
                                % (where, floor.group(1), floor_set))
            if floor_set != HOSTED:
                findings.append("%s: coord-pools floor %s != %s" % (where, floor_set, HOSTED))
            flags.append((where + " (coord-pools)", pool_set))
            lane = RE_LANE.search(expr)
            if not lane:
                findings.append("%s: routed runs-on forces the pool under no "
                                "`vars.<LANE> == 'self-hosted'`" % where)
            elif forced:
                lanes.append((where, lane.group(1).upper(), split_list(forced.group(1)[1:-1])))
        file_pins = [p for p in pins if p[0].startswith(os.path.join(".github", "workflows", name) + ":")]
        if invocations and not file_routed:
            findings.append("%s: invokes the router but no job's runs-on reads its output"
                            % os.path.join(".github", "workflows", name))
        if invocations != len(file_pins):
            findings.append("%s: %d router invocation(s) but %d `want=` pin(s)"
                            % (os.path.join(".github", "workflows", name), invocations, len(file_pins)))

    if not flags and not pins and not routed:
        return None, ["no routing sites found under %s" % wf_dir]

    if flags:
        ref_where, ref = flags[0]
        for where, labels in flags[1:]:
            if labels != ref:
                findings.append("%s: pool label set %s != %s (%s)" % (where, labels, ref, ref_where))
    if pins and router_blob is None:
        findings.append("%s: pinned by %d workflow(s) but missing" % (ROUTER, len(pins)))
    for where, want in pins:
        if router_blob and want != router_blob:
            findings.append("%s: pin %s != %s blob %s" % (where, want, ROUTER, router_blob))
    decl_path = os.path.join(root, DECLARATION)
    if routed and not os.path.exists(decl_path):
        findings.append("%s: missing, but %d job(s) are routed by a lane variable; coord's "
                        "pool-variable controller reads nothing for this repo" % (DECLARATION, routed))
    elif os.path.exists(decl_path):
        declared, why = read_declaration(decl_path)
        if declared is None:
            findings.append("%s: %s" % (DECLARATION, why))
        else:
            read = set()
            for where, var, pool in lanes:
                read.add(var)
                if var not in declared:
                    findings.append("%s: lane variable %s is not declared in %s"
                                    % (where, var, DECLARATION))
                elif pool_key(declared[var]) != pool_key(pool):
                    findings.append("%s: forced-lane pool %s != %s's declared pool %s for %s"
                                    % (where, pool, DECLARATION, declared[var], var))
            for var in sorted(set(declared) - read):
                findings.append("%s: declares %s but no routed runs-on reads it"
                                % (DECLARATION, var))
    summary = "%d routed job(s), %d label-set site(s), %d pin(s)" % (routed, len(flags), len(pins))
    return summary, findings


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..")
    summary, findings = check(root)
    if summary is None:
        print("check-ci-routing: " + findings[0], file=sys.stderr)
        return 2
    for f in findings:
        print("::error title=CI routing drift::" + f)
    print("check-ci-routing: %s -- %s" % (summary, "DRIFT" if findings else "consistent"))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
