# Tests for scripts/check-ci-routing.py, run against copies of THIS tree's
# workflows: the real tree must pass, and each kind of drift the checker exists
# to catch, injected into a copy, must fail it. No network, no git.
import hashlib, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
CHECK = os.path.join(ROOT, "scripts", "check-ci-routing.py")
with open(os.path.join(ROOT, ".github", "scripts", "route-ci-lane.py"), "rb") as _f:
    _data = _f.read()
PIN = "want=" + hashlib.sha1(b"blob %d\0" % len(_data) + _data).hexdigest()
FORCED = '\'["self-hosted","Linux","X64","ram-16g"]\''
failures = 0


def run(root):
    p = subprocess.run([sys.executable, "-B", CHECK, root], capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def copy_tree():
    d = tempfile.mkdtemp(prefix="ci-routing-")
    shutil.copytree(os.path.join(ROOT, ".github"), os.path.join(d, ".github"))
    shutil.copytree(os.path.join(ROOT, ".qontinui"), os.path.join(d, ".qontinui"))
    return d


DECL = os.path.join(".qontinui", "ci-pool-variables.toml")


def mutate_decl(root, old, new):
    path = os.path.join(root, DECL)
    text = open(path, encoding="utf-8").read()
    if old not in text:
        raise LookupError("fixture text not found in %s: %r" % (DECL, old))
    open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))


def mutate(root, name, old, new, count=1):
    path = os.path.join(root, ".github", "workflows", name)
    text = open(path, encoding="utf-8").read()
    if old not in text:
        raise LookupError("fixture text not found in %s: %r" % (name, old))
    open(path, "w", encoding="utf-8").write(text.replace(old, new, count))


def case(label, want_rc, want_text, setup=None):
    global failures
    root = copy_tree()
    try:
        if setup:
            setup(root)
        rc, out = run(root)
    except LookupError as e:
        rc, out = -1, "fixture out of date with the workflows: %s" % e
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

case("coord-pools line disagrees with runs-on", 1, "coord-pools pool",
     lambda r: mutate(r, "qontinui-ci.yml", "# coord-pools: [self-hosted, Linux, X64, ram-16g]",
                      "# coord-pools: [self-hosted, Linux, X64, ram-8g]"))

case("routed runs-on with no coord-pools line", 1, "not directly under",
     lambda r: mutate(r, "ci-integrity-selftest.yml",
                      "    # coord-pools: [self-hosted, Linux, X64, ram-16g] | [ubuntu-24.04]\n", ""))

case("--self-hosted-labels differs between workflows", 1, "pool label set",
     lambda r: mutate(r, "ci.yml", "--self-hosted-labels self-hosted,Linux,X64,ram-16g",
                      "--self-hosted-labels self-hosted,Linux,X64,ram-32g"))

case("pin is not the committed router blob", 1, "route-ci-lane.py blob",
     lambda r: mutate(r, "ci.yml", PIN, "want=" + "0" * 40))


def edit_router(r):
    with open(os.path.join(r, ".github", "scripts", "route-ci-lane.py"), "a") as f:
        f.write("# local edit\n")


case("router edited without re-pinning", 1, "route-ci-lane.py blob", edit_router)

case("router invocation with its pin removed", 1, "router invocation(s) but 0",
     lambda r: mutate(r, "smoke-test.yml",
                      "          %s\n" % PIN, "          %s-\n" % PIN))

case("hosted floor literal changed", 1, "hosted-floor literal",
     lambda r: mutate(r, "smoke-test.yml", "|| '[\"ubuntu-24.04\"]') }}",
                      "|| '[\"ubuntu-22.04\"]') }}"))


case("job hard-wired to the pool outside the routed form", 1, "outside the routed form",
     lambda r: mutate(r, "docs.yml", "runs-on: ubuntu-latest",
                      "runs-on: [self-hosted, Linux, X64, ram-16g]"))

case("runs-on folded over several lines", 1, "spans several lines",
     lambda r: mutate(r, "docs.yml", "runs-on: ubuntu-latest", "runs-on: >-\n      ubuntu-latest"))

case("router invoked but no job routed", 1, "no job's runs-on reads",
     lambda r: mutate(r, "smoke-test.yml", "needs.route.outputs.labels", "'[\"ubuntu-24.04\"]'"))


case("routed runs-on forces the pool under no lane variable", 1, "under no",
     lambda r: mutate(r, "smoke-test.yml", "vars.UIBRIDGE_CI_LINUX_LANE == 'self-hosted'",
                      "vars.UIBRIDGE_CI_LINUX_LANE == 'forced'"))

case("lane-variable declaration missing", 1, "ci-pool-variables.toml: missing",
     lambda r: os.remove(os.path.join(r, DECL)))

case("declared pool differs from the forced-lane literal", 1, "declared pool",
     lambda r: mutate_decl(r, '"ram-16g"]', '"ram-8g"]'))

case("declared pool in another order and case is the same pool", 0, "-- consistent",
     lambda r: mutate_decl(r, 'pool = ["self-hosted", "Linux", "X64", "ram-16g"]',
                           'pool = ["ram-16g", "x64", "linux", "self-hosted"]'))

case("routed job reads an undeclared lane variable", 1, "is not declared in",
     lambda r: mutate_decl(r, '"UIBRIDGE_CI_LINUX_LANE"', '"UIBRIDGE_CI_OTHER_LANE"'))

case("declared variable no routed job reads", 1, "no routed runs-on reads it",
     lambda r: open(os.path.join(r, DECL), "a").write(
         '\n[[variables]]\nname = "UIBRIDGE_CI_STALE_LANE"\npool = ["self-hosted", "Linux"]\n'))

case("declaration that does not parse", 1, "does not parse",
     lambda r: open(os.path.join(r, DECL), "a").write("\n[[variables]\n"))


case("declaration entry with an unknown key", 1, "unknown key(s)",
     lambda r: mutate_decl(r, 'name = "UIBRIDGE_CI_LINUX_LANE"',
                           'name = "UIBRIDGE_CI_LINUX_LANE"\nnote = "x"'))

case("declaration with an unknown top-level key", 1, "unknown top-level key(s)",
     lambda r: mutate_decl(r, "[[variables]]", 'comment = "x"\n\n[[variables]]'))

case("variable declared twice", 1, "declared more than once",
     lambda r: open(os.path.join(r, DECL), "a").write(
         '\n[[variables]]\nname = "uibridge_ci_linux_lane"\npool = ["self-hosted", "Linux", "X64", "ram-16g"]\n'))

case("variables written as a single table", 1, "array of tables",
     lambda r: mutate_decl(r, "[[variables]]", "[variables]"))

case("declaration entry that is not a table", 1, "is not a table",
     lambda r: open(os.path.join(r, DECL), "w").write('variables = ["x"]\n'))


def no_routing(r):
    d = os.path.join(r, ".github", "workflows")
    for n in os.listdir(d):
        os.remove(os.path.join(d, n))
    open(os.path.join(d, "x.yml"), "w").write("on: push\njobs: {}\n")


case("no routing sites at all is not a pass", 2, "no routing sites", no_routing)

print("%d failure(s)" % failures)
sys.exit(1 if failures else 0)
