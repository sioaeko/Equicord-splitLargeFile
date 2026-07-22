const fs = require("fs");
const path = require("path");
const Module = require("module");
const vm = require("vm");

const patcherPath = path.resolve(__dirname, "..", "patcher.js");
const patcherSource = `${fs.readFileSync(patcherPath, "utf8")}\nmodule.exports.__buildPlugin = buildInstalledVencordPluginDef;`;
const patcherModule = new Module(patcherPath, module);
patcherModule.filename = patcherPath;
patcherModule.paths = Module._nodeModulePaths(path.dirname(patcherPath));
patcherModule._compile(patcherSource, patcherPath);
const pluginSource = patcherModule.exports.__buildPlugin();

function createHarness() {
    const nodes = [];
    let timerId = 0;

    function matches(node, selector) {
        selector = selector.trim();
        if (selector === "[data-filesplitter-preview]") return node.dataset.filesplitterPreview !== undefined;
        if (selector === "[data-filesplitter-result-mount]") return node.dataset.filesplitterResultMount !== undefined;
        if (selector === "[data-filesplitter-hidden='true']") return node.dataset.filesplitterHidden === "true";
        if (selector === "[data-filesplitter-result-mount], [data-filesplitter-preview]")
            return node.dataset.filesplitterResultMount !== undefined || node.dataset.filesplitterPreview !== undefined;
        if (selector === "a[href]") return node.tagName === "A" && Boolean(node.href);
        if (selector.startsWith("[id^='message-content-']")) return node.id.startsWith("message-content-");
        return selector === "article" && node.tagName === "ARTICLE";
    }

    class Element {
        constructor(tagName = "div") {
            this.tagName = tagName.toUpperCase();
            this.id = "";
            this.dataset = {};
            this.style = {};
            this.children = [];
            this.parentElement = null;
            this.attributes = {};
            this.removed = false;
            this.textContent = "";
            this.href = "";
            nodes.push(this);
        }

        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name === "id") this.id = String(value);
        }

        appendChild(child) {
            child.parentElement = this;
            child.removed = false;
            this.children.push(child);
            return child;
        }

        replaceChildren(...children) {
            for (const child of this.children) {
                child.parentElement = null;
                child.removed = true;
            }
            this.children = [];
            for (const child of children) this.appendChild(child);
        }

        remove() {
            this.removed = true;
            if (!this.parentElement) return;
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }

        querySelectorAll(selector) {
            const selectors = selector.split(",").map(value => value.trim());
            const result = [];
            const visit = node => {
                for (const child of node.children) {
                    if (!child.removed && selectors.some(value => matches(child, value))) result.push(child);
                    visit(child);
                }
            };
            visit(this);
            return result;
        }

        querySelector(selector) {
            return this.querySelectorAll(selector)[0] ?? null;
        }

        closest(selector) {
            let current = this;
            while (current) {
                if (selector.split(",").some(value => matches(current, value.trim()))) return current;
                current = current.parentElement;
            }
            return null;
        }
    }

    const document = {
        head: new Element("head"),
        body: new Element("body"),
        createElement: tag => new Element(tag),
        createElementNS: (_, tag) => new Element(tag),
        getElementById: id => nodes.find(node => !node.removed && node.id === id) ?? null,
        querySelectorAll: selector => nodes.filter(node =>
            !node.removed && selector.split(",").some(value => matches(node, value.trim()))
        )
    };
    document.querySelector = selector => document.querySelectorAll(selector)[0] ?? null;

    const channelId = "channel-1";
    const messageNodes = ["message-1", "message-2"].map(messageId => {
        const node = new Element("li");
        node.id = `chat-messages-${channelId}-${messageId}`;
        document.body.appendChild(node);
        return node;
    });
    const metadata = {
        type: "FileSplitterChunk",
        total: 2,
        originalName: "archive.zip",
        originalSize: 15 * 1024 * 1024,
        timestamp: 1770000000000
    };
    const messages = [0, 1].map(index => ({
        id: `message-${index + 1}`,
        channel_id: channelId,
        content: JSON.stringify({ ...metadata, index }),
        attachments: [{
            url: `https://cdn.discordapp.com/attachments/100/200/archive.zip.part00${index + 1}`
        }]
    }));
    const React = {
        createElement: (component, props) => typeof component === "function" ? component(props) : null,
        useState: initial => [initial, () => {}],
        useEffect: callback => callback()
    };
    const common = {
        React,
        FluxDispatcher: { subscribe() {}, unsubscribe() {}, dispatch() {} },
        MessageStore: { getMessages: () => ({ toArray: () => messages }) },
        RestAPI: { post: () => Promise.resolve() },
        Constants: { Endpoints: { MESSAGES: id => `/channels/${id}/messages` } },
        SelectedChannelStore: { getChannelId: () => channelId },
        SnowflakeUtils: { fromTimestamp: value => String(value) },
        Toasts: { show() {}, genId: () => "toast", Type: { MESSAGE: 0, SUCCESS: 1, FAILURE: 2 } },
        CloudUploader: function () {}
    };
    const context = vm.createContext({
        console,
        URL,
        Blob,
        File: globalThis.File || class File extends Blob {
            constructor(parts, name, options) {
                super(parts, options);
                this.name = name;
            }
        },
        HTMLElement: Element,
        HTMLAnchorElement: Element,
        document,
        globalThis: null,
        Vencord: {
            Webpack: {
                Common: common,
                findByProps: (...props) => {
                    if (props.includes("createElement")) return React;
                    return Object.values(common).find(value => value && props.every(prop => prop in value));
                },
                find: () => common.CloudUploader
            },
            Api: {
                ChatButtons: {
                    ChatBarButton: () => null,
                    addChatBarButton() {},
                    removeChatBarButton() {}
                }
            }
        },
        VencordNative: undefined,
        fetch: async () => { throw new Error("Unexpected fetch"); },
        setTimeout: callback => {
            const id = ++timerId;
            queueMicrotask(callback);
            return id;
        },
        clearTimeout() {},
        setInterval: () => ++timerId,
        clearInterval() {},
        requestAnimationFrame: callback => {
            const id = ++timerId;
            queueMicrotask(callback);
            return id;
        },
        cancelAnimationFrame() {}
    });
    context.globalThis = context;
    vm.runInContext(`${pluginSource}\n;globalThis.__fileSplitter=_FS_;`, context);

    return {
        plugin: context.__fileSplitter,
        cardCount: () => nodes.filter(node => !node.removed && node.dataset.filesplitterPreview !== undefined).length,
        secondMessage: messageNodes[1],
        messages
    };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

async function main() {
    const harness = createHarness();
    harness.plugin.start();
    harness.plugin.renderMessageAccessory({ message: harness.messages[0] });
    await flush();
    const afterRestart = {
        cards: harness.cardCount(),
        secondChunkHidden: harness.secondMessage.dataset.filesplitterHidden === "true"
    };

    harness.plugin.stop();
    await flush();
    const afterStop = {
        cards: harness.cardCount(),
        secondChunkHidden: harness.secondMessage.dataset.filesplitterHidden === "true"
    };

    harness.plugin.start();
    harness.plugin.renderMessageAccessory({ message: harness.messages[0] });
    await flush();
    const afterReenable = {
        cards: harness.cardCount(),
        secondChunkHidden: harness.secondMessage.dataset.filesplitterHidden === "true"
    };

    const passed = afterRestart.cards === 1
        && afterRestart.secondChunkHidden
        && afterStop.cards === 0
        && !afterStop.secondChunkHidden
        && afterReenable.cards === 1
        && afterReenable.secondChunkHidden;

    console.log(JSON.stringify({ passed, afterRestart, afterStop, afterReenable }, null, 2));
    if (!passed) process.exitCode = 1;
}

void main();
