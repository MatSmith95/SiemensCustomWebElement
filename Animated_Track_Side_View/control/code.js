(function () {
    'use strict';

    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    const BASE_PATH_SPEED = 260;
    const DEFAULTS = {
        TrackSpeed: 0,
        MaxSpeed: 100,
        AnimationScale: 1,
        Enabled: true,
        ReverseDirection: false,
        RotationAngle: 0,
        TreadCount: 38,
        ShowValues: true,
        Alarm: false,
        BackgroundColor: 0,
        TrackColor: 4280297784,
        TreadColor: 4282074711,
        WheelColor: 4283127139,
        WheelInnerColor: 4279771180,
        HubColor: 4287931320,
        AccentColor: 4281908728,
        AlarmColor: 4293870660
    };

    const state = {
        offset: 0,
        pathLength: 0,
        treadCount: 0,
        treadElements: [],
        wheelElements: [],
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
        const inputSpeed = toNumber(readProperty('TrackSpeed'), DEFAULTS.TrackSpeed);
        const reverseDirection = toBoolean(
            readProperty('ReverseDirection'),
            DEFAULTS.ReverseDirection
        );
        const directionMultiplier = reverseDirection ? -1 : 1;

        return {
            trackSpeed: inputSpeed,
            normalizedSpeed: clamp(inputSpeed / maxSpeed, -1, 1),
            animationScale: clamp(
                Math.abs(toNumber(readProperty('AnimationScale'), DEFAULTS.AnimationScale)),
                0,
                10
            ),
            enabled: toBoolean(readProperty('Enabled'), DEFAULTS.Enabled),
            reverseDirection: reverseDirection,
            rotationAngle: toNumber(readProperty('RotationAngle'), DEFAULTS.RotationAngle),
            displayDirection: Math.sign(inputSpeed * directionMultiplier),
            treadCount: Math.round(clamp(
                toNumber(readProperty('TreadCount'), DEFAULTS.TreadCount),
                12,
                72
            )),
            showValues: toBoolean(readProperty('ShowValues'), DEFAULTS.ShowValues),
            alarm: toBoolean(readProperty('Alarm'), DEFAULTS.Alarm)
        };
    }

    function cacheElements() {
        elements.app = document.getElementById('trackApp');
        elements.svg = document.getElementById('trackSvg');
        elements.guide = document.getElementById('trackGuide');
        elements.treads = document.getElementById('treadAssembly');
        state.wheelElements = Array.prototype.slice.call(document.querySelectorAll('[data-wheel-pitch-radius]'));
    }

    function applyColors() {
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--background-color', toColor(readProperty('BackgroundColor'), DEFAULTS.BackgroundColor));
        rootStyle.setProperty('--track-color', toColor(readProperty('TrackColor'), DEFAULTS.TrackColor));
        rootStyle.setProperty('--tread-color', toColor(readProperty('TreadColor'), DEFAULTS.TreadColor));
        rootStyle.setProperty('--wheel-color', toColor(readProperty('WheelColor'), DEFAULTS.WheelColor));
        rootStyle.setProperty('--wheel-inner-color', toColor(readProperty('WheelInnerColor'), DEFAULTS.WheelInnerColor));
        rootStyle.setProperty('--hub-color', toColor(readProperty('HubColor'), DEFAULTS.HubColor));
        rootStyle.setProperty('--accent-color', toColor(readProperty('AccentColor'), DEFAULTS.AccentColor));
        rootStyle.setProperty('--alarm-color', toColor(readProperty('AlarmColor'), DEFAULTS.AlarmColor));
    }

    function buildTreads(count) {
        while (elements.treads.firstChild) {
            elements.treads.removeChild(elements.treads.firstChild);
        }

        state.treadElements = [];
        state.treadCount = count;
        state.pathLength = elements.guide.getTotalLength();

        const spacing = state.pathLength / count;
        const width = clamp(spacing * 0.68, 12, 34);

        for (let index = 0; index < count; index++) {
            const tread = document.createElementNS(SVG_NAMESPACE, 'rect');
            tread.setAttribute('class', 'tread-plate');
            tread.setAttribute('x', String(-width / 2));
            tread.setAttribute('y', '-24');
            tread.setAttribute('width', String(width));
            tread.setAttribute('height', '48');
            tread.setAttribute('rx', '3');
            tread.dataset.baseDistance = String(index * spacing);
            elements.treads.appendChild(tread);
            state.treadElements.push(tread);
        }
    }

    function normalizedDistance(distance) {
        const length = state.pathLength;
        return ((distance % length) + length) % length;
    }

    function renderMotion() {
        if (!state.pathLength) return;

        state.treadElements.forEach(function (tread) {
            const distance = normalizedDistance(Number(tread.dataset.baseDistance) + state.offset);
            const point = elements.guide.getPointAtLength(distance);
            const previousPoint = elements.guide.getPointAtLength(normalizedDistance(distance - 1));
            const nextPoint = elements.guide.getPointAtLength(normalizedDistance(distance + 1));
            const angle = Math.atan2(
                nextPoint.y - previousPoint.y,
                nextPoint.x - previousPoint.x
            ) * 180 / Math.PI;

            tread.setAttribute('transform',
                'translate(' + point.x.toFixed(2) + ' ' + point.y.toFixed(2) + ') rotate(' + angle.toFixed(2) + ')');
        });

        state.wheelElements.forEach(function (wheel) {
            const radius = toNumber(wheel.dataset.wheelPitchRadius, 1);
            const centreX = wheel.dataset.wheelCx;
            const centreY = wheel.dataset.wheelCy;
            const angle = state.offset / radius * 180 / Math.PI;
            wheel.setAttribute('transform',
                'rotate(' + angle.toFixed(2) + ' ' + centreX + ' ' + centreY + ')');
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
        if (config.displayDirection > 0) return 'FORWARD';
        if (config.displayDirection < 0) return 'REVERSE';
        return 'STOPPED';
    }

    function applyRotation(angle) {
        const width = elements.svg.clientWidth;
        const height = elements.svg.clientHeight;
        const radians = angle * Math.PI / 180;
        const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
        const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
        const scale = rotatedWidth > 0 && rotatedHeight > 0
            ? Math.min(width / rotatedWidth, height / rotatedHeight)
            : 1;

        elements.svg.style.transform = 'rotate(' + angle.toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';
    }

    function updateStatus(config) {
        const moving = isMoving(config);
        const description = describeMotion(config);

        elements.app.classList.toggle('moving', moving);
        elements.app.classList.toggle('disabled', !config.enabled);
        elements.app.classList.toggle('alarm', config.alarm);
        applyRotation(config.rotationAngle);
    }

    function publishState(reason) {
        const config = readConfig();
        const moving = isMoving(config);
        const payload = {
            speed: config.trackSpeed,
            moving: moving,
            direction: describeMotion(config),
            enabled: config.enabled,
            reversed: config.reverseDirection,
            alarm: config.alarm,
            reason: reason || '',
            timestamp: Date.now()
        };
        const signature = JSON.stringify([
            payload.speed,
            payload.moving,
            payload.direction,
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
        const velocity = config.normalizedSpeed * directionMultiplier * config.animationScale * BASE_PATH_SPEED;

        state.offset += velocity * elapsedSeconds;
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
        const value = toNumber(speed, 0);
        writeProperty('TrackSpeed', value);
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
        window.addEventListener('resize', function () {
            refresh('resize');
        });
        WebCC.onPropertyChanged.subscribe(setProperty);
    }

    WebCC.start(
        function (result) {
            if (result) {
                initializeTrack();
            } else {
                console.error('Animated Track Side View failed to connect to WebCC.');
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
