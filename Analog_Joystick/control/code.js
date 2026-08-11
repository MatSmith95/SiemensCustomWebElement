(function () {
    'use strict';

    const DEFAULTS = {
        JoyX: 0,
        JoyY: 0,
        JoyActive: false,
        JoyHeartbeat: 0,
        JoyFault: false,
        Enabled: true,
        EnableX: true,
        EnableY: true,
        XDeadband: 20,
        YDeadband: 20,
        MaxOutput: 100,
        UpdateMs: 50,
        InvertY: true,
        AxisMode: 'XY',
        ShowValues: false,
        MovementAreaColor: 4279574320,
        KnobColor: 4280393437,
        KnobBorderColor: 4286615978,
        LimitBorderColor: 4288655562,
        HighlightColor: 4284270847,
        DeadbandColor: 4284270847,
        ActiveColor: 4284270847,
        TextColor: 4294113279,
        MutedTextColor: 4288655562,
        StatusBackgroundColor: 4278322711,
        StatusBorderColor: 4288655562,
        FaultColor: 4294941514
    };

    const state = {
        active: false,
        pointerId: null,
        x: 0,
        y: 0,
        heartbeat: 0,
        fault: false,
        inXDeadband: true,
        inYDeadband: true,
        lastEmitMs: 0,
        flushTimer: null
    };

    const els = {};

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function toBool(value, fallback) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (v === 'true' || v === '1' || v === 'yes') return true;
            if (v === 'false' || v === '0' || v === 'no') return false;
        }
        return fallback;
    }

    function toNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function toColor(value, fallback, opacityScale) {
        let number = toNumber(value, fallback);
        number >>>= 0;

        const blue = number & 0xFF;
        const green = (number & 0xFF00) >>> 8;
        const red = (number & 0xFF0000) >>> 16;
        const alpha = ((number & 0xFF000000) >>> 24) / 255;
        const scaledAlpha = alpha * (opacityScale === undefined ? 1 : opacityScale);

        return 'rgba(' + [red, green, blue, scaledAlpha].join(',') + ')';
    }

    function readProperty(name) {
        if (window.WebCC && window.WebCC.Properties && name in window.WebCC.Properties) {
            return window.WebCC.Properties[name];
        }
        return DEFAULTS[name];
    }

    function writeProperty(name, value) {
        if (window.WebCC && window.WebCC.Properties) {
            window.WebCC.Properties[name] = value;
        }
    }

    function fireEvent(name) {
        const args = Array.prototype.slice.call(arguments, 1);
        if (window.WebCC && window.WebCC.Events && typeof window.WebCC.Events.fire === 'function') {
            WebCC.Events.fire.apply(WebCC.Events, [name].concat(args));
        }
    }

    function readConfig() {
        const maxOutput = Math.max(1, Math.abs(toNumber(readProperty('MaxOutput'), DEFAULTS.MaxOutput)));
        let axisMode = String(readProperty('AxisMode') || 'XY').toUpperCase().trim();
        if (axisMode !== 'XY' && axisMode !== 'X_ONLY' && axisMode !== 'Y_ONLY') axisMode = 'XY';
        const enableX = toBool(readProperty('EnableX'), true) && axisMode !== 'Y_ONLY';
        const enableY = toBool(readProperty('EnableY'), true) && axisMode !== 'X_ONLY';

        return {
            enabled: toBool(readProperty('Enabled'), true),
            enableX: enableX,
            enableY: enableY,
            xDeadband: clamp(Math.abs(toNumber(readProperty('XDeadband'), DEFAULTS.XDeadband)), 0, maxOutput),
            yDeadband: clamp(Math.abs(toNumber(readProperty('YDeadband'), DEFAULTS.YDeadband)), 0, maxOutput),
            maxOutput: maxOutput,
            updateMs: clamp(toNumber(readProperty('UpdateMs'), DEFAULTS.UpdateMs), 20, 1000),
            invertY: toBool(readProperty('InvertY'), true),
            axisMode: axisMode,
            showValues: toBool(readProperty('ShowValues'), false)
        };
    }

    function cacheElements() {
        els.app = document.getElementById('joystickApp');
        els.card = document.querySelector('.joystick-card');
        els.area = document.getElementById('joystickArea');
        els.knob = document.getElementById('joystickKnob');
        els.limitRing = document.querySelector('.limit-ring');
        els.directionZones = document.querySelectorAll('.direction-zone');
        els.verticalDeadband = document.getElementById('verticalDeadband');
        els.horizontalDeadband = document.getElementById('horizontalDeadband');
        els.values = document.getElementById('valuePanel');
        els.xText = document.getElementById('xText');
        els.yText = document.getElementById('yText');
        els.activeText = document.getElementById('activeText');
        els.heartbeatText = document.getElementById('heartbeatText');
        els.faultText = document.getElementById('faultText');
    }

    function applyColors() {
        const rootStyle = document.documentElement.style;
        const setColor = function (variable, property, opacityScale) {
            rootStyle.setProperty(
                variable,
                toColor(readProperty(property), DEFAULTS[property], opacityScale)
            );
        };

        setColor('--movement-area', 'MovementAreaColor');
        setColor('--knob-color', 'KnobColor');
        setColor('--knob-edge', 'KnobBorderColor');
        setColor('--limit-border', 'LimitBorderColor', 0.25);
        setColor('--highlight-active', 'HighlightColor', 0.22);
        setColor('--deadband-fill', 'DeadbandColor', 0.06);
        setColor('--deadband-edge', 'DeadbandColor', 0.16);
        setColor('--deadband-active', 'DeadbandColor', 0.22);
        setColor('--deadband-active-edge', 'DeadbandColor', 0.48);
        setColor('--active-color', 'ActiveColor');
        setColor('--active-glow-inner', 'ActiveColor', 0.20);
        setColor('--active-glow-outer', 'ActiveColor', 0.22);
        setColor('--center-marker', 'ActiveColor', 0.16);
        setColor('--text-main', 'TextColor');
        setColor('--text-muted', 'MutedTextColor');
        setColor('--status-background', 'StatusBackgroundColor', 0.25);
        setColor('--status-border', 'StatusBorderColor', 0.30);
        setColor('--danger', 'FaultColor');
    }

    function resizeJoystick() {
        if (!els.card || !els.area || !els.values) return;

        const cfg = readConfig();
        const cardRect = els.card.getBoundingClientRect();
        const valuesHeight = cfg.showValues ? els.values.getBoundingClientRect().height : 0;

        const availableWidth = Math.max(80, cardRect.width - 24);
        const availableHeight = Math.max(80, cardRect.height - valuesHeight - 36);
        const size = Math.floor(clamp(Math.min(availableWidth, availableHeight), 80, 450));
        const knob = 45;

        document.documentElement.style.setProperty('--joy-size', size + 'px');
        document.documentElement.style.setProperty('--knob-size', knob + 'px');
        updateDeadbandGuides(cfg);

        if (!state.active) {
            centreKnob();
        }
    }

    function updateStatus() {
        const cfg = readConfig();

        els.values.classList.toggle('hidden', !cfg.showValues);
        els.area.classList.toggle('disabled', !cfg.enabled);
        els.area.classList.toggle('active', state.active);

        els.xText.textContent = state.x.toFixed(1);
        els.yText.textContent = state.y.toFixed(1);
        els.activeText.textContent = state.active ? 'TRUE' : 'FALSE';
        els.heartbeatText.textContent = String(state.heartbeat);
        els.faultText.textContent = state.fault ? 'TRUE' : 'FALSE';
        els.faultText.classList.toggle('fault', state.fault);
        const hasCommand = state.active && (state.x !== 0 || state.y !== 0);
        els.verticalDeadband.classList.toggle('active', hasCommand && state.inXDeadband);
        els.horizontalDeadband.classList.toggle('active', hasCommand && state.inYDeadband);
        els.verticalDeadband.classList.toggle('positive', state.y > 0);
        els.verticalDeadband.classList.toggle('negative', state.y < 0);
        els.horizontalDeadband.classList.toggle('positive', state.x > 0);
        els.horizontalDeadband.classList.toggle('negative', state.x < 0);

        Array.prototype.forEach.call(els.directionZones, function (zone) {
            const xMatches = state.x === 0 || zone.dataset.x === (state.x > 0 ? 'positive' : 'negative');
            const yMatches = state.y === 0 || zone.dataset.y === (state.y > 0 ? 'positive' : 'negative');
            const showDirection = hasCommand && !state.inXDeadband && !state.inYDeadband;
            zone.classList.toggle('active', showDirection && xMatches && yMatches);
        });
    }

    function setKnob(dx, dy) {
        els.knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    }

    function centreKnob() {
        setKnob(0, 0);
    }

    function getGeometry() {
        const rect = els.limitRing.getBoundingClientRect();
        return {
            centreX: rect.left + rect.width / 2,
            centreY: rect.top + rect.height / 2,
            maxX: Math.max(1, rect.width / 2),
            maxY: Math.max(1, rect.height / 2)
        };
    }

    function updateDeadbandGuides(cfg) {
        const g = getGeometry();
        const verticalWidth = 2 * g.maxX * cfg.xDeadband / cfg.maxOutput;
        const horizontalHeight = 2 * g.maxY * cfg.yDeadband / cfg.maxOutput;

        els.verticalDeadband.style.width = verticalWidth + 'px';
        els.verticalDeadband.style.display = cfg.enableY ? '' : 'none';
        els.horizontalDeadband.style.height = horizontalHeight + 'px';
        els.horizontalDeadband.style.display = cfg.enableX ? '' : 'none';
        document.documentElement.style.setProperty('--x-deadband-half', verticalWidth / 2 + 'px');
        document.documentElement.style.setProperty('--y-deadband-half', horizontalHeight / 2 + 'px');
        Array.prototype.forEach.call(els.directionZones, function (zone) {
            zone.style.width = 'calc(40% - ' + verticalWidth / 2 + 'px)';
            zone.style.height = 'calc(40% - ' + horizontalHeight / 2 + 'px)';
        });
    }

    function applyDeadband(value, deadband, maxOutput) {
        const magnitude = Math.abs(value);
        if (magnitude <= deadband || deadband >= maxOutput) return 0;

        const scaledMagnitude = (magnitude - deadband) / (maxOutput - deadband) * maxOutput;
        return Math.sign(value) * scaledMagnitude;
    }

    function calculateFromPointer(clientX, clientY) {
        const cfg = readConfig();
        const g = getGeometry();

        const pointerDx = clamp(clientX - g.centreX, -g.maxX, g.maxX);
        const pointerDy = clamp(clientY - g.centreY, -g.maxY, g.maxY);
        const dx = cfg.enableX ? pointerDx : 0;
        const dy = cfg.enableY ? pointerDy : 0;

        let x = (dx / g.maxX) * cfg.maxOutput;
        let y = (dy / g.maxY) * cfg.maxOutput;

        if (cfg.invertY) y *= -1;
        const inXDeadband = !cfg.enableX || Math.abs(x) <= cfg.xDeadband;
        const inYDeadband = !cfg.enableY || Math.abs(y) <= cfg.yDeadband;

        x = applyDeadband(
            clamp(x, -cfg.maxOutput, cfg.maxOutput),
            cfg.xDeadband,
            cfg.maxOutput
        );
        y = applyDeadband(
            clamp(y, -cfg.maxOutput, cfg.maxOutput),
            cfg.yDeadband,
            cfg.maxOutput
        );

        return {
            x: x,
            y: y,
            dx: dx,
            dy: dy,
            inXDeadband: inXDeadband,
            inYDeadband: inYDeadband
        };
    }

    function emitNow(reason) {
        if (state.active) {
            state.heartbeat = (state.heartbeat + 1) % 2147483647;
        }

        const payload = {
            x: Number(state.x.toFixed(2)),
            y: Number(state.y.toFixed(2)),
            active: state.active,
            heartbeat: state.heartbeat,
            fault: state.fault,
            reason: reason || '',
            ts: Date.now()
        };

        writeProperty('JoyX', payload.x);
        writeProperty('JoyY', payload.y);
        writeProperty('JoyActive', payload.active);
        writeProperty('JoyHeartbeat', payload.heartbeat);
        writeProperty('JoyFault', payload.fault);

        state.lastEmitMs = performance.now();

        fireEvent('JoystickChanged', JSON.stringify(payload));

        if (!payload.active && reason) {
            fireEvent('JoystickReleased');
        }

        updateStatus();
    }

    function requestEmit(reason, force) {
        const cfg = readConfig();
        const now = performance.now();

        if (force || now - state.lastEmitMs >= cfg.updateMs) {
            emitNow(reason);
            return;
        }

        clearTimeout(state.flushTimer);
        state.flushTimer = setTimeout(function () {
            emitNow(reason);
        }, cfg.updateMs - (now - state.lastEmitMs));
    }

    function moveTo(clientX, clientY) {
        const result = calculateFromPointer(clientX, clientY);
        state.x = result.x;
        state.y = result.y;
        state.inXDeadband = result.inXDeadband;
        state.inYDeadband = result.inYDeadband;
        setKnob(result.dx, result.dy);
        updateStatus();
        requestEmit('move', false);
    }

    function stopJoystick(reason, isFault) {
        if (!state.active && state.x === 0 && state.y === 0) {
            updateStatus();
            return;
        }

        state.active = false;
        state.pointerId = null;
        state.x = 0;
        state.y = 0;
        state.fault = Boolean(isFault);
        state.inXDeadband = true;
        state.inYDeadband = true;

        centreKnob();
        clearTimeout(state.flushTimer);

        if (isFault) {
            fireEvent('JoystickFault', reason || 'safe_stop');
        }

        requestEmit(reason || 'release', true);
    }

    function startPointer(event) {
        const cfg = readConfig();
        if (!cfg.enabled) return;

        event.preventDefault();

        state.active = true;
        state.fault = false;
        state.pointerId = event.pointerId;

        try {
            els.area.setPointerCapture(event.pointerId);
        } catch (e) {}

        moveTo(event.clientX, event.clientY);
        requestEmit('start', true);
    }

    function movePointer(event) {
        if (!state.active || event.pointerId !== state.pointerId) return;
        event.preventDefault();
        moveTo(event.clientX, event.clientY);
    }

    function setProperty(data) {
        if (!data || !data.key) return;

        applyColors();

        if (data.key === 'Enabled' && !toBool(data.value, true)) {
            stopJoystick('disabled', false);
        }

        if (
            state.active &&
            (
                data.key === 'EnableX' ||
                data.key === 'EnableY' ||
                data.key === 'AxisMode'
            )
        ) {
            stopJoystick('axis_configuration_changed', false);
        }

        updateStatus();
        resizeJoystick();
    }

    function resetJoystick() {
        stopJoystick('method_reset', false);
    }

    function setEnabled(enabled) {
        writeProperty('Enabled', Boolean(enabled));
        if (!enabled) {
            stopJoystick('method_disabled', false);
        }
        updateStatus();
        resizeJoystick();
    }

    function attachEvents() {
        els.area.addEventListener('pointerdown', startPointer);
        els.area.addEventListener('pointermove', movePointer);
        els.area.addEventListener('pointerup', function () { stopJoystick('release', false); });
        els.area.addEventListener('pointercancel', function () { stopJoystick('pointer_cancel', true); });
        els.area.addEventListener('lostpointercapture', function () {
            if (state.active) stopJoystick('lost_pointer_capture', true);
        });

        window.addEventListener('blur', function () {
            if (state.active) stopJoystick('window_blur', true);
        });

        document.addEventListener('visibilitychange', function () {
            if (document.hidden && state.active) stopJoystick('document_hidden', true);
        });

        window.addEventListener('resize', resizeJoystick);
    }

    function initializeJoystick() {
        cacheElements();
        attachEvents();
        applyColors();
        resizeJoystick();
        centreKnob();
        updateStatus();
        emitNow('init');

        setTimeout(resizeJoystick, 100);
        setTimeout(resizeJoystick, 500);
    }

    WebCC.start(
        function (result) {
            if (result) {
                console.log('MSDigitalJoystickV2 connected successfully');
                initializeJoystick();
                WebCC.onPropertyChanged.subscribe(setProperty);
            } else {
                console.log('MSDigitalJoystickV2 connection failed');
            }
        },
        {
            methods: {
                ResetJoystick: resetJoystick,
                SetEnabled: setEnabled
            },
            events: ['JoystickChanged', 'JoystickReleased', 'JoystickFault'],
            properties: {
                JoyX: 0,
                JoyY: 0,
                JoyActive: false,
                JoyHeartbeat: 0,
                JoyFault: false,
                Enabled: true,
                EnableX: true,
                EnableY: true,
                XDeadband: 20,
                YDeadband: 20,
                MaxOutput: 100,
                UpdateMs: 50,
                InvertY: true,
                AxisMode: 'XY',
                ShowValues: false,
                MovementAreaColor: 4279574320,
                KnobColor: 4280393437,
                KnobBorderColor: 4286615978,
                LimitBorderColor: 4288655562,
                HighlightColor: 4284270847,
                DeadbandColor: 4284270847,
                ActiveColor: 4284270847,
                TextColor: 4294113279,
                MutedTextColor: 4288655562,
                StatusBackgroundColor: 4278322711,
                StatusBorderColor: 4288655562,
                FaultColor: 4294941514
            }
        },
        [],
        10000
    );
})();