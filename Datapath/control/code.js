(function () {
    'use strict';

    const FILES = {
        config: 'wall-config.json',
        inputs: 'datapath-inputs.json',
        state: 'datapath-state.json',
        command: 'pending-command.json',
        result: 'command-result.json'
    };

    const DEFAULTS = {
        JsonFolderPath: '',
        EditPermit: false,
        Enabled: true,
        RefreshIntervalMs: 2000,
        SelectedSourceId: '',
        SelectedTargetId: '',
        SelectedLayoutId: '',
        PendingCommandJson: '',
        CommandSequence: 0,
        StatusText: 'Ready',
        BackgroundColor: 4278190080,
        AccentColor: 4280457183
    };

    const FALLBACK_CONFIG = {
        version: 1,
        wallName: 'Datapath Video Wall',
        sections: [],
        layouts: [],
        sourcePresentation: []
    };

    const state = {
        config: FALLBACK_CONFIG,
        inputs: { inputs: [] },
        assignments: { targets: [] },
        result: { message: 'Ready' },
        selectedSourceId: '',
        selectedTargetId: '',
        selectedLayouts: {},
        commandSequence: 0,
        refreshTimer: null,
        localStoragePrefix: 'datapath-wall-control:'
    };

    const elements = {};

    function toBoolean(value, fallback) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
            if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        }
        return fallback;
    }

    function toNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function toColor(value, fallback) {
        let number = toNumber(value, fallback);
        number >>>= 0;

        const blue = number & 0xFF;
        const green = (number & 0xFF00) >>> 8;
        const red = (number & 0xFF0000) >>> 16;
        const alpha = ((number & 0xFF000000) >>> 24) / 255;

        return 'rgba(' + [red, green, blue, alpha].join(',') + ')';
    }

    function readProperty(name) {
        if (window.WebCC && WebCC.Properties && name in WebCC.Properties) {
            return WebCC.Properties[name];
        }
        return DEFAULTS[name];
    }

    function writeProperty(name, value) {
        if (window.WebCC && WebCC.Properties) {
            WebCC.Properties[name] = value;
        }
    }

    function fireEvent(name, payload) {
        if (window.WebCC && WebCC.Events && typeof WebCC.Events.fire === 'function') {
            WebCC.Events.fire(name, payload);
        }
    }

    function getJsonFolderPath() {
        return String(readProperty('JsonFolderPath') || '').trim();
    }

    function joinPath(folderPath, fileName) {
        if (!folderPath) return '../json/' + fileName;
        const separator = folderPath.indexOf('\\') >= 0 ? '\\' : '/';
        return folderPath.endsWith('\\') || folderPath.endsWith('/')
            ? folderPath + fileName
            : folderPath + separator + fileName;
    }

    function toFileUrl(path) {
        if (/^https?:\/\//i.test(path) || path.startsWith('./') || path.startsWith('../') || path.startsWith('/')) {
            return path;
        }

        if (/^[a-zA-Z]:[\\/]/.test(path)) {
            return 'file:///' + path.replace(/\\/g, '/');
        }

        return path;
    }

    function getFileSystem() {
        return window.HMIRuntime && window.HMIRuntime.FileSystem
            ? window.HMIRuntime.FileSystem
            : null;
    }

    function callFileSystem(methodNames, args) {
        const fileSystem = getFileSystem();
        if (!fileSystem) return null;

        for (let index = 0; index < methodNames.length; index++) {
            const method = fileSystem[methodNames[index]];
            if (typeof method === 'function') {
                return method.apply(fileSystem, args);
            }
        }

        return null;
    }

    function readText(path) {
        const fileSystemResult = callFileSystem(['ReadFile', 'readFile', 'ReadTextFile', 'readTextFile'], [path, 'utf8']);
        if (fileSystemResult) return Promise.resolve(fileSystemResult);

        const cached = window.localStorage.getItem(state.localStoragePrefix + path);
        if (cached !== null) return Promise.resolve(cached);

        return fetch(toFileUrl(path), { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        });
    }

    function writeText(path, text) {
        const fileSystemResult = callFileSystem(['WriteFile', 'writeFile', 'WriteTextFile', 'writeTextFile'], [path, text, 'utf8']);
        if (fileSystemResult) return Promise.resolve(fileSystemResult);

        window.localStorage.setItem(state.localStoragePrefix + path, text);
        return Promise.resolve();
    }

    function readJson(fileName, fallback) {
        const path = joinPath(getJsonFolderPath(), fileName);
        return readText(path)
            .then(function (text) {
                return JSON.parse(text);
            })
            .catch(function (error) {
                publishFileError('read', fileName, error);
                return fallback;
            });
    }

    function writeJson(fileName, value) {
        const path = joinPath(getJsonFolderPath(), fileName);
        const text = JSON.stringify(value, null, 2);
        return writeText(path, text).catch(function (error) {
            publishFileError('write', fileName, error);
            throw error;
        });
    }

    function publishFileError(action, fileName, error) {
        const message = 'Could not ' + action + ' ' + fileName + ': ' + error.message;
        setStatus(message);
        fireEvent('FileError', JSON.stringify({
            action: action,
            fileName: fileName,
            message: error.message,
            timestamp: new Date().toISOString()
        }));
    }

    function setStatus(message) {
        const text = message || 'Ready';
        elements.statusText.textContent = text;
        elements.studioStatus.textContent = text;
        writeProperty('StatusText', text);
    }

    function clearElement(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    function getLayoutsById() {
        return (state.config.layouts || []).reduce(function (lookup, layout) {
            lookup[layout.id] = layout;
            return lookup;
        }, {});
    }

    function getSources() {
        const presentationById = (state.config.sourcePresentation || []).reduce(function (lookup, item) {
            lookup[item.inputId] = item;
            return lookup;
        }, {});

        return (state.inputs.inputs || [])
            .map(function (input, index) {
                const presentation = presentationById[input.inputId] || {};
                return {
                    id: input.inputId,
                    name: presentation.label || input.name || input.inputId,
                    available: input.available !== false,
                    visible: presentation.visible !== false,
                    order: toNumber(presentation.order, index + 1000)
                };
            })
            .sort(function (left, right) {
                return left.order - right.order || left.name.localeCompare(right.name);
            });
    }

    function getAssignment(targetId) {
        return (state.assignments.targets || []).find(function (target) {
            return target.targetId === targetId;
        }) || null;
    }

    function getSourceName(sourceId) {
        const source = getSources().find(function (item) {
            return item.id === sourceId;
        });
        return source ? source.name : sourceId;
    }

    function getTargetId(screenId, layoutId, zoneId) {
        return screenId + ':' + layoutId + ':' + zoneId;
    }

    function selectSource(sourceId) {
        state.selectedSourceId = sourceId;
        writeProperty('SelectedSourceId', sourceId);
        renderSources();
    }

    function selectLayout(screenId, layoutId) {
        state.selectedLayouts[screenId] = layoutId;
        writeProperty('SelectedLayoutId', layoutId);
        render();
    }

    function selectTarget(targetId) {
        state.selectedTargetId = targetId;
        writeProperty('SelectedTargetId', targetId);
    }

    function isEnabled() {
        return toBoolean(readProperty('Enabled'), DEFAULTS.Enabled);
    }

    function isEditPermitted() {
        return toBoolean(readProperty('EditPermit'), DEFAULTS.EditPermit);
    }

    function createButton(className, text, onClick) {
        const button = document.createElement('button');
        button.className = className;
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    function renderLayoutRail(rail, screen) {
        const group = document.createElement('div');
        const layouts = state.config.layouts || [];

        group.className = 'layout-group';
        layouts.forEach(function (layout) {
            const layoutId = state.selectedLayouts[screen.id] || screen.defaultLayoutId || layout.id;
            const button = createButton('layout-button', layout.name || layout.id, function () {
                selectLayout(screen.id, layout.id);
            });

            button.classList.toggle('active', layoutId === layout.id);
            group.appendChild(button);
        });

        group.appendChild(createButton('save-button', 'Save', function () {
            saveWallConfig();
        }));
        rail.appendChild(group);
    }

    function renderRails() {
        clearElement(elements.leftLayouts);
        clearElement(elements.rightLayouts);

        (state.config.sections || []).forEach(function (section) {
            const rail = section.layoutRail === 'left'
                ? elements.leftLayouts
                : section.layoutRail === 'right'
                    ? elements.rightLayouts
                    : null;

            if (!rail) return;
            (section.screens || []).forEach(function (screen) {
                renderLayoutRail(rail, screen);
            });
        });
    }

    function renderZone(screen, layout, zone) {
        const targetId = getTargetId(screen.id, layout.id, zone.id);
        const assignment = getAssignment(targetId);
        const zoneElement = document.createElement('button');
        const sourceName = assignment && (assignment.sourceName || getSourceName(assignment.sourceId));

        zoneElement.className = 'screen-zone';
        zoneElement.type = 'button';
        zoneElement.style.left = zone.x + '%';
        zoneElement.style.top = zone.y + '%';
        zoneElement.style.width = zone.w + '%';
        zoneElement.style.height = zone.h + '%';
        zoneElement.classList.toggle('selected', targetId === state.selectedTargetId);
        zoneElement.disabled = !isEnabled();

        zoneElement.innerHTML =
            '<span class="zone-source">' + escapeHtml(sourceName || 'No Input') + '</span>' +
            '<span class="zone-label">' + escapeHtml(zone.label || targetId) + '</span>';

        zoneElement.addEventListener('click', function () {
            selectTarget(targetId);
            routeSelectedSource(screen, layout, zone, targetId);
            render();
        });

        return zoneElement;
    }

    function renderScreen(screen) {
        const layouts = getLayoutsById();
        const selectedLayoutId = state.selectedLayouts[screen.id] || screen.defaultLayoutId || 'layout_1';
        const layout = layouts[selectedLayoutId] || (state.config.layouts || [])[0] || { id: 'layout_1', zones: [] };
        const screenElement = document.createElement('div');

        state.selectedLayouts[screen.id] = layout.id;
        screenElement.className = 'screen';

        (layout.zones || []).forEach(function (zone) {
            screenElement.appendChild(renderZone(screen, layout, zone));
        });

        return screenElement;
    }

    function renderSection(section) {
        const sectionElement = document.createElement('section');
        const title = document.createElement('div');
        const stack = document.createElement('div');

        sectionElement.className = 'wall-section';
        title.className = 'section-title';
        title.textContent = section.title || section.id;
        stack.className = 'screen-stack';
        stack.style.gridTemplateRows = 'repeat(' + Math.max(1, (section.screens || []).length) + ', minmax(0, 1fr))';

        (section.screens || []).forEach(function (screen) {
            stack.appendChild(renderScreen(screen));
        });

        sectionElement.appendChild(title);
        sectionElement.appendChild(stack);
        return sectionElement;
    }

    function renderWall() {
        clearElement(elements.wallCanvas);
        (state.config.sections || []).forEach(function (section) {
            elements.wallCanvas.appendChild(renderSection(section));
        });
    }

    function renderSources() {
        clearElement(elements.sourceGrid);

        getSources().forEach(function (source) {
            const button = createButton('source-button', source.name, function () {
                selectSource(source.id);
            });

            button.disabled = !isEnabled() || !source.available;
            button.classList.toggle('selected', source.id === state.selectedSourceId);
            button.classList.toggle('hidden-source', !source.visible);
            elements.sourceGrid.appendChild(button);
        });
    }

    function render() {
        elements.app.classList.toggle('disabled', !isEnabled());
        elements.editButton.hidden = !isEditPermitted();
        elements.wallTitle.textContent = state.config.wallName || 'Datapath Video Wall';
        document.documentElement.style.setProperty('--background-color', toColor(readProperty('BackgroundColor'), DEFAULTS.BackgroundColor));
        document.documentElement.style.setProperty('--accent-color', toColor(readProperty('AccentColor'), DEFAULTS.AccentColor));
        renderRails();
        renderWall();
        renderSources();
        refreshStudioEditors();
    }

    function routeSelectedSource(screen, layout, zone, targetId) {
        if (!isEnabled() || !state.selectedSourceId) {
            setStatus('Select a video source first.');
            return;
        }

        const sourceName = getSourceName(state.selectedSourceId);
        const command = {
            commandId: 'cmd-' + Date.now(),
            action: 'route-input',
            sourceId: state.selectedSourceId,
            sourceName: sourceName,
            targetId: targetId,
            screenId: screen.id,
            layoutId: layout.id,
            zoneId: zone.id,
            requestedAt: new Date().toISOString()
        };

        writeJson(FILES.command, command).then(function () {
            state.commandSequence += 1;
            writeProperty('PendingCommandJson', JSON.stringify(command));
            writeProperty('CommandSequence', state.commandSequence);
            fireEvent('CommandWritten', JSON.stringify(command));
            setStatus('Command written: ' + sourceName + ' to ' + targetId);
        });
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function refreshStudioEditors() {
        if (document.activeElement === elements.configEditor || document.activeElement === elements.inputsEditor) return;
        elements.configEditor.value = JSON.stringify(state.config, null, 2);
        elements.inputsEditor.value = JSON.stringify(state.inputs, null, 2);
    }

    function showStudioPanel(panelName) {
        const showConfig = panelName === 'config';
        elements.configTab.classList.toggle('active', showConfig);
        elements.inputsTab.classList.toggle('active', !showConfig);
        elements.configPanel.classList.toggle('active', showConfig);
        elements.inputsPanel.classList.toggle('active', !showConfig);
    }

    function openStudio() {
        if (!isEditPermitted()) return;
        refreshStudioEditors();
        if (typeof elements.studioDialog.showModal === 'function') {
            elements.studioDialog.showModal();
        } else {
            elements.studioDialog.setAttribute('open', 'open');
        }
    }

    function closeStudio() {
        elements.studioDialog.close();
    }

    function parseEditor(text, name) {
        try {
            return JSON.parse(text);
        } catch (error) {
            setStatus(name + ' JSON is not valid: ' + error.message);
            throw error;
        }
    }

    function saveWallConfig() {
        const config = parseEditor(elements.configEditor.value, 'wall-config');
        state.config = config;
        return writeJson(FILES.config, config).then(function () {
            fireEvent('ConfigurationSaved', JSON.stringify({
                fileName: FILES.config,
                timestamp: new Date().toISOString()
            }));
            setStatus('Saved ' + FILES.config);
            render();
        });
    }

    function saveInputs() {
        const inputs = parseEditor(elements.inputsEditor.value, 'datapath-inputs');
        state.inputs = inputs;
        return writeJson(FILES.inputs, inputs).then(function () {
            fireEvent('ConfigurationSaved', JSON.stringify({
                fileName: FILES.inputs,
                timestamp: new Date().toISOString()
            }));
            setStatus('Saved ' + FILES.inputs);
            render();
        });
    }

    function loadAllFiles() {
        return Promise.all([
            readJson(FILES.config, state.config),
            readJson(FILES.inputs, state.inputs),
            readJson(FILES.state, state.assignments),
            readJson(FILES.result, state.result)
        ]).then(function (results) {
            state.config = normalizeConfig(results[0]);
            state.inputs = normalizeInputs(results[1]);
            state.assignments = normalizeAssignments(results[2]);
            state.result = results[3] || {};
            setStatus(state.result.message || 'Ready');
            render();
        });
    }

    function normalizeConfig(config) {
        config = config && typeof config === 'object' ? config : FALLBACK_CONFIG;
        config.sections = Array.isArray(config.sections) ? config.sections : [];
        config.layouts = Array.isArray(config.layouts) ? config.layouts : [];
        config.sourcePresentation = Array.isArray(config.sourcePresentation) ? config.sourcePresentation : [];
        return config;
    }

    function normalizeInputs(inputs) {
        inputs = inputs && typeof inputs === 'object' ? inputs : { inputs: [] };
        inputs.inputs = Array.isArray(inputs.inputs) ? inputs.inputs : [];
        return inputs;
    }

    function normalizeAssignments(assignments) {
        assignments = assignments && typeof assignments === 'object' ? assignments : { targets: [] };
        assignments.targets = Array.isArray(assignments.targets) ? assignments.targets : [];
        return assignments;
    }

    function scheduleRefresh() {
        const interval = Math.max(500, toNumber(readProperty('RefreshIntervalMs'), DEFAULTS.RefreshIntervalMs));

        if (state.refreshTimer) {
            window.clearInterval(state.refreshTimer);
        }

        state.refreshTimer = window.setInterval(function () {
            Promise.all([
                readJson(FILES.inputs, state.inputs),
                readJson(FILES.state, state.assignments),
                readJson(FILES.result, state.result)
            ]).then(function (results) {
                state.inputs = normalizeInputs(results[0]);
                state.assignments = normalizeAssignments(results[1]);
                state.result = results[2] || {};
                setStatus(state.result.message || 'Ready');
                render();
            });
        }, interval);
    }

    function bindEvents() {
        elements.editButton.addEventListener('click', openStudio);
        elements.configTab.addEventListener('click', function () {
            showStudioPanel('config');
        });
        elements.inputsTab.addEventListener('click', function () {
            showStudioPanel('inputs');
        });
        elements.reloadConfigButton.addEventListener('click', loadAllFiles);
        elements.reloadInputsButton.addEventListener('click', loadAllFiles);
        elements.saveConfigButton.addEventListener('click', saveWallConfig);
        elements.saveInputsButton.addEventListener('click', saveInputs);
    }

    function handlePropertyChanged(change) {
        if (!change || !change.key) return;

        if (change.key === 'JsonFolderPath') {
            loadAllFiles();
        }

        if (change.key === 'RefreshIntervalMs') {
            scheduleRefresh();
        }

        render();
    }

    function cacheElements() {
        elements.app = document.getElementById('app');
        elements.wallTitle = document.getElementById('wallTitle');
        elements.statusText = document.getElementById('statusText');
        elements.leftLayouts = document.getElementById('leftLayouts');
        elements.rightLayouts = document.getElementById('rightLayouts');
        elements.wallCanvas = document.getElementById('wallCanvas');
        elements.sourceGrid = document.getElementById('sourceGrid');
        elements.editButton = document.getElementById('editButton');
        elements.studioDialog = document.getElementById('studioDialog');
        elements.studioStatus = document.getElementById('studioStatus');
        elements.configTab = document.getElementById('configTab');
        elements.inputsTab = document.getElementById('inputsTab');
        elements.configPanel = document.getElementById('configPanel');
        elements.inputsPanel = document.getElementById('inputsPanel');
        elements.configEditor = document.getElementById('configEditor');
        elements.inputsEditor = document.getElementById('inputsEditor');
        elements.reloadConfigButton = document.getElementById('reloadConfigButton');
        elements.reloadInputsButton = document.getElementById('reloadInputsButton');
        elements.saveConfigButton = document.getElementById('saveConfigButton');
        elements.saveInputsButton = document.getElementById('saveInputsButton');
    }

    function registerWebCcCallbacks() {
        if (!window.WebCC) return;

        if (typeof WebCC.start === 'function') {
            WebCC.start(
                function (result) {
                    if (!result) {
                        setStatus('Failed to connect to WebCC.');
                        return;
                    }

                    WebCC.onPropertyChanged.subscribe(handlePropertyChanged);
                    loadAllFiles();
                    scheduleRefresh();
                },
                {
                    methods: {
                        ReloadJson: loadAllFiles,
                        OpenConfigurationStudio: openStudio,
                        CloseConfigurationStudio: closeStudio
                    },
                    events: ['CommandWritten', 'ConfigurationSaved', 'FileError'],
                    properties: Object.assign({}, DEFAULTS)
                },
                [],
                10000
            );
        }
    }

    function init() {
        cacheElements();
        bindEvents();
        state.selectedSourceId = String(readProperty('SelectedSourceId') || '');
        state.selectedTargetId = String(readProperty('SelectedTargetId') || '');
        state.commandSequence = toNumber(readProperty('CommandSequence'), DEFAULTS.CommandSequence);
        render();
        registerWebCcCallbacks();
        loadAllFiles();
        scheduleRefresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
