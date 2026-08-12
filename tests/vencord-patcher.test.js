"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
    installInstalledVencord,
    restoreInstalledVencord,
    statusInstalledVencord
} = require("../patcher.js");

const IPC_MARKER = "/* FILESPLITTER_IPC */";
const PATCH_START = "/* FILESPLITTER_VENCORD_PATCH_START */";
const META_ENTRY = 'FileSplitter:{folderName:"src/userplugins/fileSplitter",userPlugin:true},';

function countOccurrences(source, needle) {
    return source.split(needle).length - 1;
}

function rendererFixture() {
    return [
        "(()=>{",
        'var One={name:"One"},Two={name:"Two"},Three={name:"Three"};',
        "var Plugins={[One.name]:One,[Two.name]:Two,[Three.name]:Three};",
        'var PluginMeta={[One.name]:{folderName:"one",userPlugin:!1},',
        '[Two.name]:{folderName:"two",userPlugin:false},',
        '[Three.name]:{folderName:"three",userPlugin:true}};',
        "void Plugins;void PluginMeta;",
        "})();"
    ].join("");
}

function preloadFixture() {
    return [
        "(()=>{",
        "var $electron={ipcRenderer:{invoke:function(){}}};",
        "var $context={contextBridge:{exposeInMainWorld:function(){}}};",
        "var $native={pluginHelpers:{}};",
        '$electron.ipcRenderer.invoke ("probe");',
        '$context.contextBridge.exposeInMainWorld ( "VencordNative" , $native );',
        "})();"
    ].join("");
}

function createVencordFixture(preloadCode) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "filesplitter-vencord-patcher-"));
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);

    const originals = {
        renderer: rendererFixture(),
        patcher: '(()=>{})();\n/*! For license information please see patcher.js.LEGAL.txt */\n',
        preload: preloadCode
    };

    fs.writeFileSync(path.join(dist, "renderer.js"), originals.renderer);
    fs.writeFileSync(path.join(dist, "patcher.js"), originals.patcher);
    fs.writeFileSync(path.join(dist, "preload.js"), originals.preload);

    return { root, dist, originals };
}

function readFixture(fixture) {
    return {
        renderer: fs.readFileSync(path.join(fixture.dist, "renderer.js"), "utf8"),
        patcher: fs.readFileSync(path.join(fixture.dist, "patcher.js"), "utf8"),
        preload: fs.readFileSync(path.join(fixture.dist, "preload.js"), "utf8")
    };
}

function cleanupFixture(root) {
    const resolved = path.resolve(root);
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(tempRoot + path.sep), "fixture must stay inside the temp directory");
    fs.rmSync(resolved, { recursive: true, force: true });
}

function testSuccessfulInstallAndRestore() {
    const fixture = createVencordFixture(preloadFixture());
    try {
        const result = installInstalledVencord({ vencordRoot: fixture.root });
        assert.strictEqual(result.ipcInjected, true);
        assert.strictEqual(result.pluginMetaInjected, true);

        let patched = readFixture(fixture);
        assert.ok(patched.renderer.includes(PATCH_START));
        assert.strictEqual(countOccurrences(patched.renderer, META_ENTRY), 1);
        assert.ok(patched.patcher.includes('_fsIpc.handle("FileSplitterFetchBlob"'));
        assert.strictEqual(countOccurrences(patched.patcher, IPC_MARKER), 2);
        assert.ok(patched.preload.includes('$native.fileSplitter={fetchBlob:function'));
        assert.strictEqual(countOccurrences(patched.preload, IPC_MARKER), 2);

        let status = statusInstalledVencord({ vencordRoot: fixture.root });
        assert.strictEqual(status.fullyPatched, true);
        assert.strictEqual(status.pluginMetaPresent, true);
        assert.strictEqual(status.ipcHandlerPresent, true);
        assert.strictEqual(status.preloadBridgePresent, true);

        installInstalledVencord({ vencordRoot: fixture.root });
        patched = readFixture(fixture);
        assert.strictEqual(countOccurrences(patched.renderer, META_ENTRY), 1);
        assert.strictEqual(countOccurrences(patched.renderer, PATCH_START), 1);
        assert.strictEqual(countOccurrences(patched.patcher, IPC_MARKER), 2);
        assert.strictEqual(countOccurrences(patched.preload, IPC_MARKER), 2);

        restoreInstalledVencord({ vencordRoot: fixture.root });
        assert.deepStrictEqual(readFixture(fixture), fixture.originals);

        status = statusInstalledVencord({ vencordRoot: fixture.root });
        assert.strictEqual(status.fullyPatched, false);
    } finally {
        cleanupFixture(fixture.root);
    }
}

function testUnsupportedPreloadDoesNotPartiallyPatch() {
    const fixture = createVencordFixture("(()=>{var native={pluginHelpers:{}};void native;})();");
    try {
        assert.throws(
            () => installInstalledVencord({ vencordRoot: fixture.root }),
            /does not expose a recognizable "VencordNative" object/
        );
        assert.deepStrictEqual(readFixture(fixture), fixture.originals);
        assert.strictEqual(fs.existsSync(path.join(fixture.dist, "renderer.js.filesplitter.bak")), false);
        assert.strictEqual(fs.existsSync(path.join(fixture.dist, "patcher.js.filesplitter.bak")), false);
        assert.strictEqual(fs.existsSync(path.join(fixture.dist, "preload.js.filesplitter.bak")), false);
    } finally {
        cleanupFixture(fixture.root);
    }
}

testSuccessfulInstallAndRestore();
testUnsupportedPreloadDoesNotPartiallyPatch();

console.log(JSON.stringify({
    passed: true,
    cases: [
        "minified identifier and whitespace variants",
        "PluginMeta registration",
        "idempotent reinstall",
        "full restore",
        "no partial write on unsupported preload"
    ]
}, null, 2));
