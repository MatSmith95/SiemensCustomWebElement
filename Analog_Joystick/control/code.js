(function () {
    'use strict';

    const DEFAULTS = {
        JoyX: 0,
        JoyY: 0,
        JoyActive: false,
        JoyHeartbeat: 0,
        JoyFault: false,
        Enabled: true,
        MimicMode: false,
        iDigitalOnly: false,
        MimicX: 0,
        MimicY: 0,
        EnableX: true,
        EnableY: true,
        XDeadband: 20,
        YDeadband: 20,
        MaxOutput: 100,
        UpdateMs: 50,
        InvertY: true,
        AxisMode: 'XY',
        MovementAreaColor: 4279574320,
        KnobColor: 4280393437,
        MimicKnobColor: 4286611584,
        KnobBorderColor: 4286615978,
        LimitBorderColor: 4288655562,
        HighlightColor: 4284270847,
        DeadbandColor: 4284270847,
        ActiveColor: 4284270847
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
        const minimumDeadband = maxOutput * 0.2;
        let axisMode = String(readProperty('AxisMode') || 'XY').toUpperCase().trim();
        if (axisMode !== 'XY' && axisMode !== 'X_ONLY' && axisMode !== 'Y_ONLY') axisMode = 'XY';
        const enableX = toBool(readProperty('EnableX'), true) && axisMode !== 'Y_ONLY';
        const enableY = toBool(readProperty('EnableY'), true) && axisMode !== 'X_ONLY';

        return {
            enabled: toBool(readProperty('Enabled'), true),
            mimicMode: toBool(readProperty('MimicMode'), false),
            digitalOnly: toBool(readProperty('iDigitalOnly'), false),
            mimicX: toNumber(readProperty('MimicX'), DEFAULTS.MimicX),
            mimicY: toNumber(readProperty('MimicY'), DEFAULTS.MimicY),
            enableX: enableX,
            enableY: enableY,
            xDeadband: clamp(Math.abs(toNumber(readProperty('XDeadband'), DEFAULTS.XDeadband)), minimumDeadband, maxOutput),
            yDeadband: clamp(Math.abs(toNumber(readProperty('YDeadband'), DEFAULTS.YDeadband)), minimumDeadband, maxOutput),
            maxOutput: maxOutput,
            updateMs: clamp(toNumber(readProperty('UpdateMs'), DEFAULTS.UpdateMs), 20, 1000),
            invertY: toBool(readProperty('InvertY'), true),
            axisMode: axisMode
        };
    }

    function cacheElements() {
        els.app = document.getElementById('joystickApp');
        els.card = document.querySelector('.joystick-card');
        els.area = document.getElementById('joystickArea');
        els.knob = document.getElementById('joystickKnob');
        els.limitRing = document.querySelector('.limit-ring');
        els.directionZones = document.querySelectorAll('.direction-zone');
        els.directionArrows = document.querySelectorAll('.direction-arrow');
        els.digitalButtons = document.querySelectorAll('.digital-button');
        els.verticalDeadband = document.getElementById('verticalDeadband');
        els.horizontalDeadband = document.getElementById('horizontalDeadband');
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
        setColor('--mimic-knob-color', 'MimicKnobColor');
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
    }

    function resizeJoystick() {
        if (!els.card || !els.area) return;

        const cfg = readConfig();
        const cardRect = els.card.getBoundingClientRect();

        const availableWidth = Math.max(80, cardRect.width - 4);
        const availableHeight = Math.max(80, cardRect.height - 4);
        const size = Math.floor(clamp(Math.min(availableWidth, availableHeight), 80, 450));
        const knob = 45;

        document.documentElement.style.setProperty('--joy-size', size + 'px');
        document.documentElement.style.setProperty('--knob-size', knob + 'px');
        updateDeadbandGuides(cfg);

        if (cfg.mimicMode) {
            positionMimicKnob(cfg);
        } else if (!state.active) {
            centreKnob();
        }
    }

    function updateStatus() {
        const cfg = readConfig();
        const visual = getVisualState(cfg);

        els.area.classList.toggle('disabled', !cfg.enabled && !cfg.mimicMode);
        els.area.classList.toggle('mimic', cfg.mimicMode);
        els.area.classList.toggle('digital-only', cfg.digitalOnly && !cfg.mimicMode);
        els.area.classList.toggle('active', visual.active);

        if (cfg.mimicMode) {
            positionMimicKnob(cfg);
        }

        const hasCommand = visual.x !== 0 || visual.y !== 0;
        els.verticalDeadband.classList.toggle('active', hasCommand && visual.inXDeadband);
        els.horizontalDeadband.classList.toggle('active', hasCommand && visual.inYDeadband);
        els.verticalDeadband.classList.toggle('positive', visual.y > 0);
        els.verticalDeadband.classList.toggle('negative', visual.y < 0);
        els.horizontalDeadband.classList.toggle('positive', visual.x > 0);
        els.horizontalDeadband.classList.toggle('negative', visual.x < 0);

        Array.prototype.forEach.call(els.directionZones, function (zone) {
            const xMatches = visual.x === 0 || zone.dataset.x === (visual.x > 0 ? 'positive' : 'negative');
            const yMatches = visual.y === 0 || zone.dataset.y === (visual.y > 0 ? 'positive' : 'negative');
            const showDirection = hasCommand && !visual.inXDeadband && !visual.inYDeadband;
            zone.classList.toggle('active', showDirection && xMatches && yMatches);
        });

        Array.prototype.forEach.call(els.directionArrows, function (arrow) {
            const xMatches = arrow.dataset.x === 'zero'
                ? visual.x === 0
                : visual.x !== 0 && arrow.dataset.x === (visual.x > 0 ? 'positive' : 'negative');
            const yMatches = arrow.dataset.y === 'zero'
                ? visual.y === 0
                : visual.y !== 0 && arrow.dataset.y === (visual.y > 0 ? 'positive' : 'negative');
            arrow.classList.toggle('active', hasCommand && xMatches && yMatches);
        });

        Array.prototype.forEach.call(els.digitalButtons, function (button) {
            const buttonX = Number(button.dataset.x) * cfg.maxOutput;
            let buttonY = Number(button.dataset.y) * cfg.maxOutput;
            if (!cfg.invertY) buttonY *= -1;

            button.hidden =
                (buttonX !== 0 && !cfg.enableX) ||
                (buttonY !== 0 && !cfg.enableY);
            button.classList.toggle(
                'active',
                visual.active && visual.x === buttonX && visual.y === buttonY
            );
        });
    }

    function getVisualState(cfg) {
        if (!cfg.mimicMode) return state;

        const rawX = cfg.enableX ? clamp(cfg.mimicX, -cfg.maxOutput, cfg.maxOutput) : 0;
        const rawY = cfg.enableY ? clamp(cfg.mimicY, -cfg.maxOutput, cfg.maxOutput) : 0;
        const inXDeadband = !cfg.enableX || Math.abs(rawX) <= cfg.xDeadband;
        const inYDeadband = !cfg.enableY || Math.abs(rawY) <= cfg.yDeadband;

        return {
            active: true,
            x: applyDeadband(rawX, cfg.xDeadband, cfg.maxOutput),
            y: applyDeadband(rawY, cfg.yDeadband, cfg.maxOutput),
            inXDeadband: inXDeadband,
            inYDeadband: inYDeadband
        };
    }

    function setKnob(dx, dy) {
        els.knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    }

    function centreKnob() {
        setKnob(0, 0);
    }

    function positionMimicKnob(cfg) {
        const g = getGeometry();
        const x = cfg.enableX ? clamp(cfg.mimicX, -cfg.maxOutput, cfg.maxOutput) : 0;
        const y = cfg.enableY ? clamp(cfg.mimicY, -cfg.maxOutput, cfg.maxOutput) : 0;
        const dx = x / cfg.maxOutput * g.maxX;
        const dy = (cfg.invertY ? -y : y) / cfg.maxOutput * g.maxY;

        setKnob(dx, dy);
    }

    function getGeometry() {
        const rect = els.limitRing.getBoundingClientRect();
        const knobRadius = els.knob.getBoundingClientRect().width / 2;
        return {
            centreX: rect.left + rect.width / 2,
            centreY: rect.top + rect.height / 2,
            maxX: Math.max(1, rect.width / 2 - knobRadius),
            maxY: Math.max(1, rect.height / 2 - knobRadius)
        };
    }

    function updateDeadbandGuides(cfg) {
        const g = getGeometry();
        const verticalWidth = 2 * g.maxX * cfg.xDeadband / cfg.maxOutput;
        const horizontalHeight = 2 * g.maxY * cfg.yDeadband / cfg.maxOutput;

        els.verticalDeadband.style.width = verticalWidth + 'px';
        els.verticalDeadband.style.display = cfg.enableX ? '' : 'none';
        els.horizontalDeadband.style.height = horizontalHeight + 'px';
        els.horizontalDeadband.style.display = cfg.enableY ? '' : 'none';
        document.documentElement.style.setProperty('--x-deadband-half', verticalWidth / 2 + 'px');
        document.documentElement.style.setProperty('--y-deadband-half', horizontalHeight / 2 + 'px');
        Array.prototype.forEach.call(els.directionZones, function (zone) {
            zone.style.width = 'calc(50% - var(--movement-inset) - ' + verticalWidth / 2 + 'px)';
            zone.style.height = 'calc(50% - var(--movement-inset) - ' + horizontalHeight / 2 + 'px)';
        });
        positionDirectionArrows(verticalWidth, horizontalHeight);
    }

    function positionDirectionArrows(verticalWidth, horizontalHeight) {
        const areaRect = els.area.getBoundingClientRect();
        const ringRect = els.limitRing.getBoundingClientRect();
        const ringLeft = ringRect.left - areaRect.left;
        const ringTop = ringRect.top - areaRect.top;
        const halfLeftWidth = ringRect.width / 2 - verticalWidth / 2;
        const halfTopHeight = ringRect.height / 2 - horizontalHeight / 2;
        const positionsX = {
            negative: ringLeft + halfLeftWidth / 2,
            zero: ringLeft + ringRect.width / 2,
            positive: ringLeft + ringRect.width - halfLeftWidth / 2
        };
        const positionsY = {
            positive: ringTop + halfTopHeight / 2,
            zero: ringTop + ringRect.height / 2,
            negative: ringTop + ringRect.height - halfTopHeight / 2
        };
        const arrowSize = clamp(Math.min(halfLeftWidth, halfTopHeight) * 0.45, 16, 96);

        Array.prototype.forEach.call(els.directionArrows, function (arrow) {
            arrow.style.left = positionsX[arrow.dataset.x] + 'px';
            arrow.style.top = positionsY[arrow.dataset.y] + 'px';
            arrow.style.fontSize = arrowSize + 'px';
        });
    }

    function enforceDeadbandMinimums() {
        const maxOutput = Math.max(1, Math.abs(toNumber(readProperty('MaxOutput'), DEFAULTS.MaxOutput)));
        const minimumDeadband = maxOutput * 0.2;

        ['XDeadband', 'YDeadband'].forEach(function (name) {
            const current = Math.abs(toNumber(readProperty(name), DEFAULTS[name]));
            const corrected = clamp(current, minimumDeadband, maxOutput);
            if (current !== corrected) {
                writeProperty(name, corrected);
            }
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

    function moveDigital(button, cfg) {
        state.x = Number(button.dataset.x) * cfg.maxOutput;
        state.y = Number(button.dataset.y) * cfg.maxOutput;
        if (!cfg.invertY) state.y *= -1;
        state.inXDeadband = state.x === 0;
        state.inYDeadband = state.y === 0;
        updateStatus();
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
        if (!cfg.enabled || cfg.mimicMode || state.active) return;

        const digitalButton = event.target.closest('.digital-button');
        if (cfg.digitalOnly && (!digitalButton || digitalButton.hidden)) return;

        event.preventDefault();

        state.active = true;
        state.fault = false;
        state.pointerId = event.pointerId;

        try {
            els.area.setPointerCapture(event.pointerId);
        } catch (e) {}

        if (cfg.digitalOnly) {
            moveDigital(digitalButton, cfg);
        } else {
            moveTo(event.clientX, event.clientY);
        }
        requestEmit('start', true);
    }

    function movePointer(event) {
        if (!state.active || event.pointerId !== state.pointerId) return;
        event.preventDefault();
        if (readConfig().digitalOnly) return;
        moveTo(event.clientX, event.clientY);
    }

    function setProperty(data) {
        if (!data || !data.key) return;

        if (data.key === 'XDeadband' || data.key === 'YDeadband' || data.key === 'MaxOutput') {
            enforceDeadbandMinimums();
        }

        applyColors();

        if (data.key === 'Enabled' && !toBool(data.value, true)) {
            stopJoystick('disabled', false);
        }

        if (data.key === 'MimicMode') {
            if (toBool(data.value, false)) {
                stopJoystick('mimic_mode', false);
            } else {
                centreKnob();
            }
        }

        if (
            state.active &&
            (
                data.key === 'EnableX' ||
                data.key === 'EnableY' ||
                data.key === 'AxisMode' ||
                data.key === 'iDigitalOnly' ||
                data.key === 'MaxOutput' ||
                data.key === 'XDeadband' ||
                data.key === 'YDeadband' ||
                data.key === 'InvertY'
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
        els.area.addEventListener('pointerup', function (event) {
            if (event.pointerId === state.pointerId) stopJoystick('release', false);
        });
        els.area.addEventListener('pointercancel', function (event) {
            if (event.pointerId === state.pointerId) stopJoystick('pointer_cancel', true);
        });
        els.area.addEventListener('lostpointercapture', function (event) {
            if (state.active && event.pointerId === state.pointerId) {
                stopJoystick('lost_pointer_capture', true);
            }
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
        enforceDeadbandMinimums();
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
                MimicMode: false,
                iDigitalOnly: false,
                MimicX: 0,
                MimicY: 0,
                EnableX: true,
                EnableY: true,
                XDeadband: 20,
                YDeadband: 20,
                MaxOutput: 100,
                UpdateMs: 50,
                InvertY: true,
                AxisMode: 'XY',
                MovementAreaColor: 4279574320,
                KnobColor: 4280393437,
                MimicKnobColor: 4286611584,
                KnobBorderColor: 4286615978,
                LimitBorderColor: 4288655562,
                HighlightColor: 4284270847,
                DeadbandColor: 4284270847,
                ActiveColor: 4284270847
            }
        },
        [],
        10000
    );
})();