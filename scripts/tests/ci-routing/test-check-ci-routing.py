# Tests for scripts/check-ci-routing.py, run against copies of THIS tree's
# workflows: the real tree must pass, and each kind of drift the checker exists
# to catch, injected into a copy, must fail it. No network, no git.
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
CHECK = os.path.join(ROOT, "scripts", "check-ci-routing.py")
FORCED = '\'["self-hosted","Linux","X64","ram-16g"]\''
failures = 0


def run(root):
    p = subprocess.run([sys.executable, "-B", CHECK, root], capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def copy_tree():
    d = tempfile.mkdtemp(prefix="ci-routing-")
    shutil.copytree(os.path.join(ROOT, ".github"), os.path.join(d, ".github"))
    return d


def mutate(root, name, old, new, count=1):
    path = os.path.join(root, ".github", "workflows", name)
    text = open(path, encoding="utf-8").read()
    assert old in text, "fixture text not found in %s: %r" % (name, old)
    open(path, "w", encoding="utf-8").write(text.replace(old, new, count))


def case(label, want_rc, want_text, setup=None):
    global failures
    root = copy_tree()
    try:
        if setup:
            setup(root)
        rc, out = run(root)
    finally:
        shutil.rmtree(root)
    ok = rc == want_rc and want_text in out
    print("%s  %s" % ("PASS" if ok else "FAIL", label))
    if not ok:
        failures += 1
        print("    rc=%d (want %d), output:\n    %s" % (rc, want_rc, out.replace("\n", "\n    ")))


# The real tree: consistent (an empty tree exits 2, so this is not vacuous).
case("committed tree is consistent", 0, "-- consistent")

case("typo'd forced-lane literal", 1, "forced-lane literal",
     lambda r: mutate(r, "smoke-test.yml", FORCED, FORCED.replace("ram-16g", "ram-16")))

case("coord-pools line disagrees with runs-on", 1, "forced-lane literal",
     lambda r: mutate(r, "qontinui-ci.yml", "# coord-pools: [self-hosted, Linux, X64, ram-16g]",
                      "# coord-pools: [self-hosted, Linux, X64, ram-8g]"))

case("routed runs-on with no coord-pools line", 1, "not directly under",
     lambda r: mutate(r, "ci-integrity-selftest.yml",
                      "    # coord-pools: [self-hosted, Linux, X64, ram-16g] | [ubuntu-latest]\n", ""))

case("--self-hosted-labels differs between workflows", 1, "pool label set",
     lambda r: mutate(r, "ci.yml", "--self-hosted-labels self-hosted,Linux,X64,ram-16g",
                      "--self-hosted-labels self-hosted,Linux,X64,ram-32g"))

case("pin is not the committed router blob", 1, "!= committed",
     lambda r: mutate(r, "ci.yml", "want=c67b16e79f3bfaa9b92cd5e1702aa8e03e818c83",
                      "want=" + "0" * 40))


def edit_router(r):
    with open(os.path.join(r, ".github", "scripts", "route-ci-lane.py"), "a") as f:
        f.write("# local edit\n")


case("router edited without re-pinning", 1, "!= committed", edit_router)

case("router invocation with its pin removed", 1, "router invocation(s) but 0",
     lambda r: mutate(r, "smoke-test.yml",
                      "          want=c67b16e79f3bfaa9b92cd5e1702aa8e03e818c83\n",
                      "          want=c67b16e79f3bfaa9b92cd5e1702aa8e03e818c83-\n"))

case("hosted floor literal changed", 1, "hosted-floor literal",
     lambda r: mutate(r, "smoke-test.yml", "|| '[\"ubuntu-latest\"]') }}",
                      "|| '[\"ubuntu-22.04\"]') }}"))


def no_routing(r):
    d = os.path.join(r, ".github", "workflows")
    for n in os.listdir(d):
        os.remove(os.path.join(d, n))
    open(os.path.join(d, "x.yml"), "w").write("on: push\njobs: {}\n")


case("no routing sites at all is not a pass", 2, "no routing sites", no_routing)

print("%d failure(s)" % failures)
sys.exit(1 if failures else 0)
