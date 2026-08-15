"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const patcher = path.join(root, "patcher.js");

function runPatcher(args) {
    return spawnSync(process.execPath, [patcher, ...args], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1024 * 1024
    });
}

function cleanupFixture(fixtureRoot) {
    const resolved = path.resolve(fixtureRoot);
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(tempRoot + path.sep), "fixture must stay inside the temp directory");
    fs.rmSync(resolved, { recursive: true, force: true });
}

function testLegalAssetsAndMetadata() {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.strictEqual(packageJson.license, "GPL-3.0-or-later");
    assert.strictEqual(packageJson.devDependencies["@yao-pkg/pkg"], "6.22.0");
    assert.strictEqual(packageJson.devDependencies.pkg, undefined);
    assert.match(packageJson.scripts["build:exe"], /node22-win-x64/);
    assert.match(packageJson.scripts["build:mac-arm64"], /node22-macos-arm64/);

    const expectedAssets = [
        "LICENSE",
        "LEGAL_NOTICE.md",
        "THIRD_PARTY_NOTICES.md",
        "licenses/yao-pkg-pkg-LICENSE",
        "licenses/Node.js-LICENSE"
    ];
    for (const asset of expectedAssets) {
        assert.ok(packageJson.pkg.assets.includes(asset), asset + " must be embedded in release binaries");
        assert.ok(fs.statSync(path.join(root, asset)).size > 0, asset + " must not be empty");
    }

    assert.match(fs.readFileSync(path.join(root, "LICENSE"), "utf8"), /GNU GENERAL PUBLIC LICENSE/);
    assert.match(fs.readFileSync(path.join(root, "LEGAL_NOTICE.md"), "utf8"), /not affiliated with[\s\S]*Discord/i);
    assert.match(fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8"), /Copyright \(c\) 2022 Jack Hogan/);
}

function testCliConsentGate() {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "filesplitter-legal-surface-"));
    const userPlugins = path.join(fixtureRoot, "src", "userplugins");
    fs.mkdirSync(userPlugins, { recursive: true });

    try {
        const denied = runPatcher(["--install-source", "--repo", fixtureRoot]);
        assert.notStrictEqual(denied.status, 0);
        assert.match(denied.stderr, /--accept-risk/);
        assert.strictEqual(fs.existsSync(path.join(userPlugins, "fileSplitter")), false);

        const accepted = runPatcher(["--install-source", "--repo", fixtureRoot, "--accept-risk"]);
        assert.strictEqual(accepted.status, 0, accepted.stderr);
        assert.match(accepted.stdout, /Installed FileSplitter source plugin/);
        assert.ok(fs.existsSync(path.join(userPlugins, "fileSplitter", "index.tsx")));

        const status = runPatcher(["--status-source", "--repo", fixtureRoot]);
        assert.strictEqual(status.status, 0, status.stderr);
        assert.match(status.stdout, /FileSplitter source plugin status/);
    } finally {
        cleanupFixture(fixtureRoot);
    }
}

function testLegalOutputAndGuiConsent() {
    const legal = runPatcher(["--legal"]);
    assert.strictEqual(legal.status, 0, legal.stderr);
    assert.match(legal.stdout, /===== Project license =====/);
    assert.match(legal.stdout, /^Runtime: Node\.js v\d+\.\d+\.\d+ \(.+\)$/m);
    assert.match(legal.stdout, /===== Build tool license =====/);
    assert.match(legal.stdout, /===== Node\.js runtime license =====/);
    assert.match(legal.stdout, /Copyright \(c\) 2022 Jack Hogan/);

    const windowsGui = fs.readFileSync(path.join(root, "patcher-gui.ps1"), "utf8");
    assert.match(windowsGui, /riskAccepted\s*=\s*\$riskCheck\.Checked/);
    assert.match(windowsGui, /accept responsibility/);

    const macGui = fs.readFileSync(path.join(root, "patcher-gui.applescript"), "utf8");
    assert.match(macGui, /\\"riskAccepted\\":/);
    assert.match(macGui, /I Understand/);
}

testLegalAssetsAndMetadata();
testCliConsentGate();
testLegalOutputAndGuiConsent();

console.log(JSON.stringify({
    passed: true,
    cases: [
        "GPL and bundled notice assets",
        "CLI install acknowledgement gate",
        "source install and status behavior",
        "Windows and macOS GUI acknowledgement"
    ]
}, null, 2));