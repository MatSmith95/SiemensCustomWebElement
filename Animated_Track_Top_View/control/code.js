(function () {
    'use strict';

    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    // Wrap pads outside the visible clip (y=28 to y=772). This lets each pad
    // fully leave the control before it is recycled at the opposite end.
    const TRACK_START = 0;
    const TRACK_END = 800;
    const TRACK_LENGTH = TRACK_END - TRACK_START;
    const TREAD_X = 20;
    const TREAD_WIDTH = 460;
    const BASE_TRACK_SPEED = 230;
    const DEFAULTS = {
        TrackSpeed: 0,
        MaxSpeed: 100,
        AnimationScale: 1,
        Enabled: true,
        ReverseDirection: false,
        TreadCount: 18,
        ShowValues: false,
        Alarm: false,
        BackgroundColor: 0,
        TrackColor: 4280297784,
        TreadColor: 4282074711,
        AccentColor: 4281908728,
        AlarmColor: 4293870660
    };

    const state = {
        offset: 0,
        treadCount: 0,
        treads: [],
        animationFrame: null,
        previousTime: null,
        lastPublishedState: ''
    };

    const elements = {};

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function toNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

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

    function fireEvent(name) {
        const args = Array.prototype.slice.call(arguments, 1);
        if (window.WebCC && WebCC.Events && typeof WebCC.Events.fire === 'function') {
            WebCC.Events.fire.apply(WebCC.Events, [name].concat(args));
        }
    }

    function readConfig() {
        const maxSpeed = Math.max(0.001, Math.abs(toNumber(readProperty('MaxSpeed'), DEFAULTS.MaxSpeed)));
        const trackSpeed = toNumber(readProperty('TrackSpeed'), DEFAULTS.TrackSpeed);

        return {
            trackSpeed: trackSpeed,
            normalizedSpeed: clamp(trackSpeed / maxSpeed, -1, 1),
            animationScale: clamp(
                Math.abs(toNumber(readProperty('AnimationScale'), DEFAULTS.AnimationScale)),
                0,
                10
            ),
            enabled: toBoolean(readProperty('Enabled'), DEFAULTS.Enabled),
            reverseDirection: toBoolean(
                readProperty('ReverseDirection'),
                DEFAULTS.ReverseDirection
            ),
            treadCount: Math.round(clamp(
                toNumber(readProperty('TreadCount'), DEFAULTS.TreadCount),
                8,
                36
            )),
            showValues: toBoolean(readProperty('ShowValues'), DEFAULTS.ShowValues),
            alarm: toBoolean(readProperty('Alarm'), DEFAULTS.Alarm)
        };
    }

    function cacheElements() {
        elements.app = document.getElementById('trackApp');
        elements.treads = document.getElementById('treadAssembly');
    }

    function applyColors() {
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--background-color', toColor(readProperty('BackgroundColor'), DEFAULTS.BackgroundColor));
        rootStyle.setProperty('--track-color', toColor(readProperty('TrackColor'), DEFAULTS.TrackColor));
        rootStyle.setProperty('--tread-color', toColor(readProperty('TreadColor'), DEFAULTS.TreadColor));
        rootStyle.setProperty('--accent-color', toColor(readProperty('AccentColor'), DEFAULTS.AccentColor));
        rootStyle.setProperty('--alarm-color', toColor(readProperty('AlarmColor'), DEFAULTS.AlarmColor));
    }

    function clearElement(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    function createTread(container, height, baseOffset) {
        const group = document.createElementNS(SVG_NAMESPACE, 'g');
        const pad = document.createElementNS(SVG_NAMESPACE, 'rect');
        const firstGroove = document.createElementNS(SVG_NAMESPACE, 'line');
        const secondGroove = document.createElementNS(SVG_NAMESPACE, 'line');

        group.dataset.baseOffset = String(baseOffset);

        pad.setAttribute('class', 'tread-pad');
        pad.setAttribute('x', String(TREAD_X));
        pad.setAttribute('y', String(-height / 2));
        pad.setAttribute('width', String(TREAD_WIDTH));
        pad.setAttribute('height', String(height));
        pad.setAttribute('rx', '4');

        [firstGroove, secondGroove].forEach(function (groove, index) {
            const grooveX = index === 0 ? TREAD_X + 42 : TREAD_X + TREAD_WIDTH - 42;
            groove.setAttribute('class', 'tread-groove');
            groove.setAttribute('x1', String(grooveX));
            groove.setAttribute('x2', String(grooveX));
            groove.setAttribute('y1', String(-height / 2 + 5));
            groove.setAttribute('y2', String(height / 2 - 5));
        });

        group.appendChild(pad);
        group.appendChild(firstGroove);
        group.appendChild(secondGroove);
        container.appendChild(group);
        return group;
    }

    function buildTreads(count) {
        clearElement(elements.treads);
        state.treads = [];
        state.treadCount = count;

        const spacing = TRACK_LENGTH / count;
        const height = clamp(spacing * 0.72, 16, 34);

        for (let index = 0; index < count; index++) {
            state.treads.push(createTread(elements.treads, height, index * spacing));
        }
    }

    function normalizeOffset(value) {
        return ((value % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
    }

    function renderMotion() {
        state.treads.forEach(function (tread) {
            const baseOffset = toNumber(tread.dataset.baseOffset, 0);
            const y = TRACK_START + normalizeOffset(baseOffset + state.offset);
            tread.setAttribute('transform', 'translate(0 ' + y.toFixed(2) + ')');
        });
    }

    function isMoving(config) {
        return config.enabled &&
            config.normalizedSpeed !== 0 &&
            config.animationScale > 0;
    }

    function describeMotion(config) {
        if (!config.enabled) return 'PAUSED';
        if (!isMoving(config)) return 'STOPPED';
        const directionMultiplier = config.reverseDirection ? -1 : 1;
        const displayedSpeed = config.trackSpeed * directionMultiplier;
        if (displayedSpeed > 0) return 'FORWARD';
        if (displayedSpeed < 0) return 'REVERSE';
        return 'STOPPED';
    }

    function updateStatus(config) {
        const moving = isMoving(config);

        elements.app.classList.toggle('moving', moving);
        elements.app.classList.toggle('disabled', !config.enabled);
        elements.app.classList.toggle('alarm', config.alarm);
    }

    function publishState(reason) {
        const config = readConfig();
        const moving = isMoving(config);
        const payload = {
            speed: config.trackSpeed,
            direction: describeMotion(config),
            moving: moving,
            enabled: config.enabled,
            reversed: config.reverseDirection,
            alarm: config.alarm,
            reason: reason || '',
            timestamp: Date.now()
        };
        const signature = JSON.stringify([
            payload.speed,
            payload.direction,
            payload.moving,
            payload.enabled,
            payload.reversed,
            payload.alarm
        ]);

        if (signature !== state.lastPublishedState || reason === 'init') {
            state.lastPublishedState = signature;
            fireEvent('TrackStateChanged', JSON.stringify(payload));
        }
    }

    function stopAnimationLoop() {
        if (state.animationFrame !== null) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }
        state.previousTime = null;
    }

    function animationTick(timestamp) {
        const config = readConfig();
        const moving = isMoving(config) && !document.hidden;

        if (!moving) {
            stopAnimationLoop();
            return;
        }

        if (state.previousTime === null) {
            state.previousTime = timestamp;
        }

        const elapsedSeconds = clamp((timestamp - state.previousTime) / 1000, 0, 0.1);
        const directionMultiplier = config.reverseDirection ? -1 : 1;
        const distance = config.normalizedSpeed * directionMultiplier * config.animationScale *
            BASE_TRACK_SPEED * elapsedSeconds;

        state.offset = normalizeOffset(state.offset - distance);
        state.previousTime = timestamp;
        renderMotion();
        state.animationFrame = requestAnimationFrame(animationTick);
    }

    function syncAnimationLoop() {
        const config = readConfig();
        const shouldAnimate = isMoving(config) && !document.hidden;

        if (shouldAnimate && state.animationFrame === null) {
            state.previousTime = null;
            state.animationFrame = requestAnimationFrame(animationTick);
        } else if (!shouldAnimate) {
            stopAnimationLoop();
        }
    }

    function refresh(reason) {
        const config = readConfig();
        if (config.treadCount !== state.treadCount) {
            buildTreads(config.treadCount);
        }

        applyColors();
        updateStatus(config);
        renderMotion();
        syncAnimationLoop();
        publishState(reason);
    }

    function setProperty(data) {
        if (!data || !data.key) return;
        refresh('property:' + data.key);
    }

    function setSpeed(speed) {
        writeProperty('TrackSpeed', toNumber(speed, 0));
        refresh('method:SetSpeed');
    }

    function stopAnimation() {
        writeProperty('TrackSpeed', 0);
        refresh('method:StopAnimation');
    }

    function setEnabled(enabled) {
        writeProperty('Enabled', toBoolean(enabled, true));
        refresh('method:SetEnabled');
    }

    function initializeTrack() {
        cacheElements();
        refresh('init');

        document.addEventListener('visibilitychange', syncAnimationLoop);
        WebCC.onPropertyChanged.subscribe(setProperty);
    }

    WebCC.start(
        function (result) {
            if (result) {
                initializeTrack();
            } else {
                console.error('Animated Track Top View failed to connect to WebCC.');
            }
        },
        {
            methods: {
                SetSpeed: setSpeed,
                StopAnimation: stopAnimation,
                SetEnabled: setEnabled
            },
            events: ['TrackStateChanged'],
            properties: Object.assign({}, DEFAULTS)
        },
        [],
        10000
    );
})();
