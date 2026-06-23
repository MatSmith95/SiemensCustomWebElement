(function () {
    'use strict';

    const DEFAULTS = {
        JoyX: 0,
        JoyY: 0,
        JoyActive: false,
        JoyHeartbeat: 0,
        JoyFault: false,
        Enabled: true,
        Deadband: 5,
        MaxOutput: 100,
        UpdateMs: 50,
        InvertY: true,
        AxisMode: 'XY',
        ShowValues: true
    };

    const state = {
        active: false,
        pointerId: null,
        x: 0,
        y: 0,
        heartbeat: 0,
        fault: false,
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

        return {
            enabled: toBool(readProperty('Enabled'), true),
            deadband: clamp(Math.abs(toNumber(readProperty('Deadband'), DEFAULTS.Deadband)), 0, maxOutput),
            maxOutput: maxOutput,
            updateMs: clamp(toNumber(readProperty('UpdateMs'), DEFAULTS.UpdateMs), 20, 1000),
            invertY: toBool(readProperty('InvertY'), true),
            axisMode: axisMode,
            showValues: toBool(readProperty('ShowValues'), true)
        };
    }

    function cacheElements() {
        els.app = document.getElementById('joystickApp');
        els.card = document.querySelector('.joystick-card');
        els.area = document.getElementById('joystickArea');
        els.knob = document.getElementById('joystickKnob');
        els.values = document.getElementById('valuePanel');
        els.xText = document.getElementById('xText');
        els.yText = document.getElementById('yText');
        els.activeText = document.getElementById('activeText');
        els.heartbeatText = document.getElementById('heartbeatText');
        els.faultText = document.getElementById('faultText');
    }

    function resizeJoystick() {
        if (!els.card || !els.area || !els.values) return;

        const cfg = readConfig();
        const cardRect = els.card.getBoundingClientRect();
        const valuesHeight = cfg.showValues ? els.values.getBoundingClientRect().height : 0;

        const availableWidth = Math.max(80, cardRect.width - 24);
        const availableHeight = Math.max(80, cardRect.height - valuesHeight - 36);
        const size = Math.floor(clamp(Math.min(availableWidth, availableHeight), 80, 260));
        const knob = Math.floor(clamp(size * 0.34, 34, 86));

        document.documentElement.style.setProperty('--joy-size', size + 'px');
        document.documentElement.style.setProperty('--knob-size', knob + 'px');

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
    }

    function setKnob(dx, dy) {
        els.knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    }

    function centreKnob() {
        setKnob(0, 0);
    }

    function getGeometry() {
        const rect = els.area.getBoundingClientRect();
        const knobRect = els.knob.getBoundingClientRect();
        const radius = Math.max(1, (Math.min(rect.width, rect.height) - Math.max(knobRect.width, knobRect.height)) / 2);
        return {
            centreX: rect.left + rect.width / 2,
            centreY: rect.top + rect.height / 2,
            radius: radius
        };
    }

    function applyDeadband(value, deadband) {
        return Math.abs(value) < deadband ? 0 : value;
    }

    function calculateFromPointer(clientX, clientY) {
        const cfg = readConfig();
        const g = getGeometry();

        let dx = clientX - g.centreX;
        let dy = clientY - g.centreY;

        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > g.radius) {
            const scale = g.radius / distance;
            dx *= scale;
            dy *= scale;
        }

        let x = (dx / g.radius) * cfg.maxOutput;
        let y = (dy / g.radius) * cfg.maxOutput;

        if (cfg.invertY) y *= -1;
        if (cfg.axisMode === 'X_ONLY') y = 0;
        if (cfg.axisMode === 'Y_ONLY') x = 0;

        x = applyDeadband(clamp(x, -cfg.maxOutput, cfg.maxOutput), cfg.deadband);
        y = applyDeadband(clamp(y, -cfg.maxOutput, cfg.maxOutput), cfg.deadband);

        return { x: x, y: y, dx: dx, dy: dy };
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

        if (data.key === 'Enabled' && !toBool(data.value, true)) {
            stopJoystick('disabled', false);
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
                Deadband: 5,
                MaxOutput: 100,
                UpdateMs: 50,
                InvertY: true,
                AxisMode: 'XY',
                ShowValues: true
            }
        },
        [],
        10000
    );
})();