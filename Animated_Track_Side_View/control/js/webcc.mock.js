(function (global) {
    'use strict';

    const query = new URLSearchParams(global.location.search);
    const explicitlyRequested = query.has('mock') || global.location.hash === '#mock';
    const standaloneLocalFile =
        global.location.protocol === 'file:' &&
        global.parent === global;

    if ((!explicitlyRequested && !standaloneLocalFile) || global.WebCC) return;

    const subscribers = [];
    const eventLog = [];
    const propertyWriteLog = [];
    const propertyValues = {};
    let methods = {};
    let writeSource = 'control';

    function clone(value) {
        if (value === undefined || value === null) return value;

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function makeEntry(values) {
        return Object.assign({
            timestamp: new Date().toISOString()
        }, values);
    }

    const properties = new Proxy(propertyValues, {
        set: function (target, key, value) {
            target[key] = clone(value);
            propertyWriteLog.push(makeEntry({
                name: String(key),
                value: clone(value),
                source: writeSource
            }));
            return true;
        }
    });

    function setProperty(name, value) {
        if (!(name in propertyValues)) {
            console.warn('[WebCC mock] Setting undeclared property:', name);
        }

        writeSource = 'container';
        properties[name] = value;
        writeSource = 'control';

        const change = { key: name, value: clone(value) };
        subscribers.slice().forEach(function (subscriber) {
            subscriber(change);
        });

        return properties[name];
    }

    function setProperties(values) {
        Object.keys(values || {}).forEach(function (name) {
            setProperty(name, values[name]);
        });
    }

    function callMethod(name) {
        const method = methods[name];
        const args = Array.prototype.slice.call(arguments, 1);

        if (typeof method !== 'function') {
            throw new Error('[WebCC mock] Unknown method: ' + name);
        }

        return method.apply(null, args);
    }

    function clearLogs() {
        eventLog.length = 0;
        propertyWriteLog.length = 0;
    }

    function snapshot() {
        return {
            properties: clone(propertyValues),
            events: clone(eventLog),
            propertyWrites: clone(propertyWriteLog),
            methods: Object.keys(methods)
        };
    }

    function help() {
        const commands = {
            'WebCC._mock.setProperty(name, value)': 'Simulate a property update from Unified.',
            'WebCC._mock.setProperties({ ... })': 'Simulate several property updates.',
            'WebCC._mock.callMethod(name, ...args)': 'Call a method exposed to Unified.',
            'WebCC._mock.events': 'Inspect events fired by the control.',
            'WebCC._mock.propertyWrites': 'Inspect property values written by the control.',
            'WebCC._mock.snapshot()': 'Capture all current mock state.',
            'WebCC._mock.clearLogs()': 'Clear event and property-write history.'
        };

        console.table(commands);
        return commands;
    }

    const mock = {
        active: true,
        setProperty: setProperty,
        setProperties: setProperties,
        callMethod: callMethod,
        clearLogs: clearLogs,
        snapshot: snapshot,
        help: help
    };

    Object.defineProperties(mock, {
        events: {
            enumerable: true,
            get: function () {
                return clone(eventLog);
            }
        },
        propertyWrites: {
            enumerable: true,
            get: function () {
                return clone(propertyWriteLog);
            }
        },
        methods: {
            enumerable: true,
            get: function () {
                return Object.keys(methods);
            }
        }
    });

    global.WebCC = {
        version: 'mock',
        Properties: properties,
        Extensions: {
            HMI: {}
        },
        Events: {
            fire: function (name) {
                const args = Array.prototype.slice.call(arguments, 1);
                const entry = makeEntry({
                    name: name,
                    arguments: clone(args)
                });

                eventLog.push(entry);
                console.info('[WebCC mock] Event:', name, args);
            }
        },
        onPropertyChanged: {
            subscribe: function (callback) {
                if (typeof callback !== 'function') {
                    throw new TypeError('[WebCC mock] Property subscriber must be a function.');
                }

                subscribers.push(callback);
            }
        },
        start: function (callback, contract) {
            const controlContract = contract || {};
            methods = controlContract.methods || {};

            Object.keys(controlContract.properties || {}).forEach(function (name) {
                propertyValues[name] = clone(controlContract.properties[name]);
            });

            global.setTimeout(function () {
                callback(true);
                console.info('[WebCC mock] Connected. Run WebCC._mock.help() for commands.');
            }, 0);
        },
        _mock: mock
    };
})(window);
