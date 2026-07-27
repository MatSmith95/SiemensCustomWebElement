(function () {
    'use strict';

    /*
     * These limits are intentionally kept together so they can be adjusted for
     * a particular Unified target without changing the editor logic.
     */
    const LIMITS = {
        MIN_ROWS: 1,
        MAX_ROWS: 8,
        MIN_COLUMNS: 1,
        MAX_COLUMNS: 12,
        MAX_CELLS: 64,
        MIN_GAP: 0,
        MAX_GAP: 40,
        MAX_WALL_NAME_LENGTH: 80,
        MAX_FEEDS: 256
    };

    const DEFAULTS = {
        WallName: '',
        Rows: 2,
        Columns: 3,
        DisplayGap: 8,
        AvailableFeedsJson: '[]',
        LayoutJson: '',
        AllowDuplicateFeeds: false,
        EditEnabled: true,
        SelectedCell: '',
        StatusText: 'Ready',
        HasUnsavedChanges: false,
        BackgroundColor: 4278915616,
        CellColor: 4279771956,
        SelectedCellColor: 4279150057,
        AssignedCellColor: 4279522923,
        TextColor: 4294507260
    };

    const state = {
        initialized: false,
        destroyed: false,
        rows: DEFAULTS.Rows,
        columns: DEFAULTS.Columns,
        gap: DEFAULTS.DisplayGap,
        wallName: DEFAULTS.WallName,
        allowDuplicates: DEFAULTS.AllowDuplicateFeeds,
        editEnabled: DEFAULTS.EditEnabled,
        feeds: [],
        feedMap: Object.create(null),
        cells: Object.create(null),
        spans: Object.create(null),
        selectedKey: null,
        baseline: null,
        hasUnsavedChanges: false,
        statusText: DEFAULTS.StatusText,
        statusLevel: 'ok',
        pendingWrites: Object.create(null),
        resizeFrame: null
    };

    const elements = {};
    const handlers = {};

    function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
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

    function valueSignature(value) {
        return typeof value + ':' + JSON.stringify(value);
    }

    function readProperty(name) {
        if (window.WebCC && WebCC.Properties && name in WebCC.Properties) {
            return WebCC.Properties[name];
        }
        return DEFAULTS[name];
    }

    function writeProperty(name, value, force) {
        if (!window.WebCC || !WebCC.Properties) return;

        const signature = valueSignature(value);
        if (!force && valueSignature(WebCC.Properties[name]) === signature) return;

        state.pendingWrites[name] = {
            signature: signature,
            expires: Date.now() + 1500
        };
        WebCC.Properties[name] = value;
    }

    function isOwnPropertyEcho(name, value) {
        const pending = state.pendingWrites[name];
        if (!pending) return false;

        delete state.pendingWrites[name];
        return pending.expires >= Date.now() && pending.signature === valueSignature(value);
    }

    function fireEvent(name, payload) {
        if (state.destroyed) return;
        if (window.WebCC && WebCC.Events && typeof WebCC.Events.fire === 'function') {
            WebCC.Events.fire(name, JSON.stringify(payload));
        }
    }

    function eventPayload(values) {
        const payload = {
            timestamp: Date.now()
        };

        Object.keys(values || {}).forEach(function (name) {
            payload[name] = values[name];
        });

        return payload;
    }

    function setStatus(message, level) {
        const text = String(message || 'Ready');
        const normalizedLevel = level === 'error' || level === 'warning' ? level : 'ok';

        state.statusText = text;
        state.statusLevel = normalizedLevel;
        writeProperty('StatusText', text);

        if (elements.statusText) {
            elements.statusText.textContent = text;
            elements.statusRegion.classList.toggle('error', normalizedLevel === 'error');
            elements.statusRegion.classList.toggle('warning', normalizedLevel === 'warning');
        }
    }

    function reportConfigurationError(code, messages, context) {
        const issueList = Array.isArray(messages) ? messages : [String(messages)];
        const message = issueList.join(' ');

        setStatus(message, 'error');
        fireEvent('ConfigurationError', eventPayload({
            code: code,
            message: message,
            issues: issueList,
            context: context || ''
        }));
    }

    function screenId(row, column) {
        return 'R' + (row + 1) + 'C' + (column + 1);
    }

    function cellKey(row, column) {
        return row + ',' + column;
    }

    function keyToPosition(key, rows, columns) {
        if (!key && key !== 0) return null;
        const parts = String(key).split(',');
        if (parts.length !== 2) return null;

        const row = Number(parts[0]);
        const column = Number(parts[1]);
        if (!Number.isInteger(row) || !Number.isInteger(column)) return null;
        if (row < 0 || row >= rows || column < 0 || column >= columns) return null;

        return {
            row: row,
            column: column,
            screenId: screenId(row, column)
        };
    }

    function getSpan(key, spans) {
        const span = (spans || state.spans)[key];
        return span || {
            rowSpan: 1,
            columnSpan: 1
        };
    }

    function findAnchorKey(row, column, spans) {
        const spanMap = spans || state.spans;
        const keys = Object.keys(spanMap);

        for (let index = 0; index < keys.length; index++) {
            const anchorKey = keys[index];
            const anchor = keyToPosition(anchorKey, state.rows, state.columns);
            const span = spanMap[anchorKey];
            if (!anchor || !span) continue;

            if (row >= anchor.row && row < anchor.row + span.rowSpan &&
                column >= anchor.column && column < anchor.column + span.columnSpan) {
                return anchorKey;
            }
        }

        return cellKey(row, column);
    }

    function keyToCell(key) {
        const position = keyToPosition(key, state.rows, state.columns);
        if (!position) return null;

        const anchorKey = findAnchorKey(position.row, position.column);
        const anchor = keyToPosition(anchorKey, state.rows, state.columns);
        const span = getSpan(anchorKey);
        return {
            row: anchor.row,
            column: anchor.column,
            screenId: anchor.screenId,
            feedId: state.cells[anchorKey] || null,
            rowSpan: span.rowSpan,
            columnSpan: span.columnSpan,
            anchorKey: anchorKey
        };
    }

    function screenIdToKey(value) {
        const match = /^R([1-9][0-9]*)C([1-9][0-9]*)$/i.exec(String(value || '').trim());
        if (!match) return null;

        const row = Number(match[1]) - 1;
        const column = Number(match[2]) - 1;
        if (row < 0 || row >= state.rows || column < 0 || column >= state.columns) return null;

        return findAnchorKey(row, column);
    }

    function cellEventData(key) {
        const cell = keyToCell(key);
        if (!cell) return null;

        const feed = cell.feedId ? state.feedMap[cell.feedId] : null;
        return {
            row: cell.row,
            column: cell.column,
            screenId: cell.screenId,
            feedId: cell.feedId,
            feedName: feed ? feed.displayName : null,
            rowSpan: cell.rowSpan,
            columnSpan: cell.columnSpan
        };
    }

    function validateDimensions(rows, columns) {
        if (!Number.isInteger(rows) || rows < LIMITS.MIN_ROWS || rows > LIMITS.MAX_ROWS) {
            return {
                valid: false,
                message: 'Rows must be a whole number from ' + LIMITS.MIN_ROWS + ' to ' + LIMITS.MAX_ROWS + '.'
            };
        }

        if (!Number.isInteger(columns) || columns < LIMITS.MIN_COLUMNS || columns > LIMITS.MAX_COLUMNS) {
            return {
                valid: false,
                message: 'Columns must be a whole number from ' + LIMITS.MIN_COLUMNS + ' to ' + LIMITS.MAX_COLUMNS + '.'
            };
        }

        if (rows * columns > LIMITS.MAX_CELLS) {
            return {
                valid: false,
                message: 'The wall cannot contain more than ' + LIMITS.MAX_CELLS + ' display cells.'
            };
        }

        return { valid: true };
    }

    function normalizeGap(value) {
        const gap = toNumber(value, NaN);
        if (!Number.isFinite(gap) || gap < LIMITS.MIN_GAP || gap > LIMITS.MAX_GAP) {
            return null;
        }
        return Math.round(gap);
    }

    function normalizeWallName(value) {
        return String(value === undefined || value === null ? '' : value)
            .trim()
            .slice(0, LIMITS.MAX_WALL_NAME_LENGTH);
    }

    function normalizeThumbnailUrl(value) {
        const url = String(value || '').trim();
        if (!url) return '';

        if (/^data:image\/(?:png|jpeg|gif|webp)[;,]/i.test(url)) return url;
        if (/^(?:\.\.\/assets\/|\.\/|assets\/)[A-Za-z0-9._~!$&'()+,;=@%/-]+$/.test(url)) return url;
        return null;
    }

    function parseFeedsJson(rawValue) {
        const issues = [];
        let parsed;

        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
            return { ok: true, feeds: [], issues: [] };
        }

        try {
            parsed = JSON.parse(String(rawValue));
        } catch (error) {
            return {
                ok: false,
                feeds: [],
                issues: ['AvailableFeedsJson is not valid JSON: ' + error.message]
            };
        }

        const source = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.feeds) ? parsed.feeds : null;
        if (!source) {
            return {
                ok: false,
                feeds: [],
                issues: ['AvailableFeedsJson must be a JSON array or an object containing a feeds array.']
            };
        }

        if (source.length > LIMITS.MAX_FEEDS) {
            issues.push('Only the first ' + LIMITS.MAX_FEEDS + ' feeds were accepted.');
        }

        const feeds = [];
        const identifiers = Object.create(null);

        source.slice(0, LIMITS.MAX_FEEDS).forEach(function (item, index) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                issues.push('Feed at index ' + index + ' was ignored because it is not an object.');
                return;
            }

            const rawId = item.id !== undefined ? item.id : item.feedId;
            const id = rawId === undefined || rawId === null ? '' : String(rawId).trim();
            if (!id) {
                issues.push('Feed at index ' + index + ' was ignored because it has no ID.');
                return;
            }

            if (identifiers[id]) {
                issues.push('Duplicate feed ID "' + id + '" was ignored.');
                return;
            }

            const thumbnailUrl = normalizeThumbnailUrl(item.thumbnailUrl || item.thumbnail || '');
            if (thumbnailUrl === null) {
                issues.push(
                    'Thumbnail for feed "' + id +
                    '" was ignored because only packaged relative paths or data image URLs are allowed.'
                );
            }

            identifiers[id] = true;
            feeds.push({
                id: id,
                displayName: String(item.displayName || item.name || id),
                description: String(item.description || ''),
                thumbnailUrl: thumbnailUrl || ''
            });
        });

        return {
            ok: true,
            feeds: feeds,
            issues: issues
        };
    }

    function setFeeds(feeds) {
        const feedMap = Object.create(null);
        feeds.forEach(function (feed) {
            feedMap[feed.id] = feed;
        });

        state.feeds = feeds;
        state.feedMap = feedMap;
    }

    function parseLayoutJson(rawValue) {
        let parsed;
        const issues = [];

        try {
            parsed = JSON.parse(String(rawValue));
        } catch (error) {
            return {
                ok: false,
                issues: ['LayoutJson is not valid JSON: ' + error.message]
            };
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {
                ok: false,
                issues: ['LayoutJson must contain a JSON object.']
            };
        }

        const version = parsed.version === undefined ? 1 : Number(parsed.version);
        if (version !== 1) {
            return {
                ok: false,
                issues: ['LayoutJson version ' + parsed.version + ' is not supported. Expected version 1.']
            };
        }

        const rows = parsed.rows === undefined ? state.rows : Number(parsed.rows);
        const columns = parsed.columns === undefined ? state.columns : Number(parsed.columns);
        const dimensionResult = validateDimensions(rows, columns);
        if (!dimensionResult.valid) {
            return {
                ok: false,
                issues: ['LayoutJson has invalid dimensions. ' + dimensionResult.message]
            };
        }

        const gap = parsed.displayGap === undefined ? state.gap : normalizeGap(parsed.displayGap);
        if (gap === null) {
            return {
                ok: false,
                issues: [
                    'LayoutJson displayGap must be from ' + LIMITS.MIN_GAP + ' to ' + LIMITS.MAX_GAP + ' pixels.'
                ]
            };
        }

        const sourceCells = parsed.cells === undefined ? [] : parsed.cells;
        if (!Array.isArray(sourceCells)) {
            return {
                ok: false,
                issues: ['LayoutJson cells must be an array when supplied.']
            };
        }

        const cells = Object.create(null);
        const spans = Object.create(null);
        const seenPositions = Object.create(null);
        const assignedFeeds = Object.create(null);
        const records = [];
        const coverage = Object.create(null);

        sourceCells.forEach(function (item, index) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                issues.push('Layout cell at index ' + index + ' was ignored because it is not an object.');
                return;
            }

            const row = Number(item.row);
            const column = Number(item.column);
            if (!Number.isInteger(row) || !Number.isInteger(column) ||
                row < 0 || row >= rows || column < 0 || column >= columns) {
                issues.push('Layout cell at index ' + index + ' has an invalid row or column and was ignored.');
                return;
            }

            const key = cellKey(row, column);
            if (seenPositions[key]) {
                issues.push('Duplicate layout position ' + screenId(row, column) + ' was ignored.');
                return;
            }
            seenPositions[key] = true;
            records.push({
                item: item,
                index: index,
                row: row,
                column: column,
                key: key
            });
        });

        records.forEach(function (record) {
            const item = record.item;
            const rowSpan = item.rowSpan === undefined ? 1 : Number(item.rowSpan);
            const columnSpan = item.columnSpan === undefined ? 1 : Number(item.columnSpan);

            if (!Number.isInteger(rowSpan) || rowSpan < 1 ||
                !Number.isInteger(columnSpan) || columnSpan < 1) {
                issues.push(
                    'Layout cell ' + screenId(record.row, record.column) +
                    ' has an invalid rowSpan or columnSpan and was treated as 1 × 1.'
                );
                return;
            }

            if (record.row + rowSpan > rows || record.column + columnSpan > columns) {
                issues.push(
                    'Merged area at ' + screenId(record.row, record.column) +
                    ' extends outside the wall and was treated as 1 × 1.'
                );
                return;
            }

            if (rowSpan === 1 && columnSpan === 1) return;

            let overlap = false;
            for (let row = record.row; row < record.row + rowSpan; row++) {
                for (let column = record.column; column < record.column + columnSpan; column++) {
                    if (coverage[cellKey(row, column)]) overlap = true;
                }
            }

            if (overlap) {
                issues.push(
                    'Merged area at ' + screenId(record.row, record.column) +
                    ' overlaps another merged area and was ignored.'
                );
                return;
            }

            spans[record.key] = {
                rowSpan: rowSpan,
                columnSpan: columnSpan
            };
            for (let row = record.row; row < record.row + rowSpan; row++) {
                for (let column = record.column; column < record.column + columnSpan; column++) {
                    coverage[cellKey(row, column)] = record.key;
                }
            }
        });

        records.forEach(function (record) {
            const item = record.item;
            const coveringAnchor = coverage[record.key];
            const mergedInto = item.mergedInto === undefined || item.mergedInto === null
                ? ''
                : String(item.mergedInto).trim();

            if (coveringAnchor && coveringAnchor !== record.key) {
                const anchorPosition = keyToPosition(coveringAnchor, rows, columns);
                const expectedAnchor = anchorPosition.screenId;
                if (mergedInto && mergedInto.toUpperCase() !== expectedAnchor.toUpperCase()) {
                    issues.push(
                        'Layout cell ' + screenId(record.row, record.column) +
                        ' has mergedInto "' + mergedInto + '"; expected "' + expectedAnchor + '".'
                    );
                }
                if (item.feedId !== undefined && item.feedId !== null && String(item.feedId).trim() !== '') {
                    issues.push(
                        'Feed assignment on covered cell ' + screenId(record.row, record.column) +
                        ' was ignored; assign the feed to merged area ' + expectedAnchor + '.'
                    );
                }
                return;
            }

            if (mergedInto) {
                issues.push(
                    'Layout cell ' + screenId(record.row, record.column) +
                    ' references mergedInto "' + mergedInto + '" but is not covered by that merged area.'
                );
            }

            if (item.feedId === undefined || item.feedId === null || String(item.feedId).trim() === '') {
                return;
            }

            const feedId = String(item.feedId).trim();
            if (!state.feedMap[feedId]) {
                issues.push(
                    'Feed "' + feedId + '" referenced by ' + screenId(record.row, record.column) +
                    ' is unavailable and was not assigned.'
                );
                return;
            }

            if (!state.allowDuplicates && assignedFeeds[feedId]) {
                issues.push(
                    'Duplicate assignment of feed "' + feedId + '" at ' + screenId(record.row, record.column) +
                    ' was not accepted.'
                );
                return;
            }

            cells[record.key] = feedId;
            assignedFeeds[feedId] = record.key;
        });

        return {
            ok: true,
            issues: issues,
            model: {
                wallName: parsed.wallName === undefined ? state.wallName : normalizeWallName(parsed.wallName),
                rows: rows,
                columns: columns,
                gap: gap,
                cells: cells,
                spans: spans
            }
        };
    }

    function snapshotModel() {
        const cells = Object.create(null);
        const spans = Object.create(null);
        Object.keys(state.cells).forEach(function (key) {
            cells[key] = state.cells[key];
        });
        Object.keys(state.spans).forEach(function (key) {
            spans[key] = {
                rowSpan: state.spans[key].rowSpan,
                columnSpan: state.spans[key].columnSpan
            };
        });

        return {
            wallName: state.wallName,
            rows: state.rows,
            columns: state.columns,
            gap: state.gap,
            cells: cells,
            spans: spans
        };
    }

    function restoreSnapshot(snapshot) {
        const cells = Object.create(null);
        const spans = Object.create(null);
        Object.keys(snapshot.cells || {}).forEach(function (key) {
            cells[key] = snapshot.cells[key];
        });
        Object.keys(snapshot.spans || {}).forEach(function (key) {
            spans[key] = {
                rowSpan: snapshot.spans[key].rowSpan,
                columnSpan: snapshot.spans[key].columnSpan
            };
        });

        state.wallName = snapshot.wallName;
        state.rows = snapshot.rows;
        state.columns = snapshot.columns;
        state.gap = snapshot.gap;
        state.cells = cells;
        state.spans = spans;

        if (state.selectedKey) {
            const selectedCell = keyToCell(state.selectedKey);
            state.selectedKey = selectedCell ? selectedCell.anchorKey : null;
        }
    }

    function serializeLayout() {
        const cells = [];

        for (let row = 0; row < state.rows; row++) {
            for (let column = 0; column < state.columns; column++) {
                const key = cellKey(row, column);
                const anchorKey = findAnchorKey(row, column);

                if (anchorKey !== key) {
                    const anchor = keyToPosition(anchorKey, state.rows, state.columns);
                    cells.push({
                        row: row,
                        column: column,
                        screenId: screenId(row, column),
                        feedId: null,
                        mergedInto: anchor.screenId
                    });
                    continue;
                }

                const span = getSpan(key);
                cells.push({
                    row: row,
                    column: column,
                    screenId: screenId(row, column),
                    feedId: state.cells[key] || null,
                    rowSpan: span.rowSpan,
                    columnSpan: span.columnSpan
                });
            }
        }

        return JSON.stringify({
            version: 1,
            wallName: state.wallName,
            rows: state.rows,
            columns: state.columns,
            displayGap: state.gap,
            cells: cells
        });
    }

    function setDirty(value) {
        state.hasUnsavedChanges = Boolean(value);
        writeProperty('HasUnsavedChanges', state.hasUnsavedChanges);
    }

    function syncModelProperties() {
        writeProperty('WallName', state.wallName);
        writeProperty('Rows', state.rows);
        writeProperty('Columns', state.columns);
        writeProperty('DisplayGap', state.gap);
        writeProperty('SelectedCell', state.selectedKey ? keyToCell(state.selectedKey).screenId : '');
    }

    function publishLayout(action, dirty) {
        const serialized = serializeLayout();
        writeProperty('LayoutJson', serialized);
        setDirty(dirty !== false);

        fireEvent('LayoutChanged', eventPayload({
            action: action,
            layout: JSON.parse(serialized),
            hasUnsavedChanges: state.hasUnsavedChanges
        }));
    }

    function assignedKeysForFeed(feedId) {
        return Object.keys(state.cells).filter(function (key) {
            return state.cells[key] === feedId;
        });
    }

    function currentAssignmentIssues() {
        const issues = [];
        const seenFeeds = Object.create(null);

        Object.keys(state.cells).forEach(function (key) {
            const feedId = state.cells[key];
            const cell = keyToCell(key);
            if (!cell) return;

            if (cell.anchorKey !== key) {
                issues.push(
                    'Feed "' + feedId + '" is assigned to covered cell ' +
                    keyToPosition(key, state.rows, state.columns).screenId + '.'
                );
            }

            if (!state.feedMap[feedId]) {
                issues.push('Feed "' + feedId + '" assigned to ' + cell.screenId + ' is unavailable.');
            }

            if (!state.allowDuplicates && seenFeeds[feedId]) {
                issues.push(
                    'Feed "' + feedId + '" is assigned to both ' +
                    keyToCell(seenFeeds[feedId]).screenId + ' and ' + cell.screenId + '.'
                );
            } else {
                seenFeeds[feedId] = key;
            }
        });

        return issues;
    }

    function cacheElements() {
        elements.app = document.getElementById('datapathApp');
        elements.configurationForm = document.getElementById('configurationForm');
        elements.wallTitle = document.getElementById('wallTitle');
        elements.dimensionSummary = document.getElementById('dimensionSummary');
        elements.wallNameInput = document.getElementById('wallNameInput');
        elements.rowsInput = document.getElementById('rowsInput');
        elements.columnsInput = document.getElementById('columnsInput');
        elements.gapInput = document.getElementById('gapInput');
        elements.updateLayoutButton = document.getElementById('updateLayoutButton');
        elements.selectionHint = document.getElementById('selectionHint');
        elements.editModeBadge = document.getElementById('editModeBadge');
        elements.spanToolbar = document.getElementById('spanToolbar');
        elements.spanSummary = document.getElementById('spanSummary');
        elements.rowSpanInput = document.getElementById('rowSpanInput');
        elements.columnSpanInput = document.getElementById('columnSpanInput');
        elements.mergeCellsButton = document.getElementById('mergeCellsButton');
        elements.splitCellsButton = document.getElementById('splitCellsButton');
        elements.wallGrid = document.getElementById('wallGrid');
        elements.feedSummary = document.getElementById('feedSummary');
        elements.feedList = document.getElementById('feedList');
        elements.statusRegion = document.getElementById('statusRegion');
        elements.statusText = document.getElementById('statusText');
        elements.clearCellButton = document.getElementById('clearCellButton');
        elements.clearWallButton = document.getElementById('clearWallButton');
        elements.resetButton = document.getElementById('resetButton');
        elements.applyButton = document.getElementById('applyButton');

        elements.rowsInput.min = String(LIMITS.MIN_ROWS);
        elements.rowsInput.max = String(LIMITS.MAX_ROWS);
        elements.columnsInput.min = String(LIMITS.MIN_COLUMNS);
        elements.columnsInput.max = String(LIMITS.MAX_COLUMNS);
        elements.gapInput.min = String(LIMITS.MIN_GAP);
        elements.gapInput.max = String(LIMITS.MAX_GAP);
    }

    function appendTextElement(parent, className, text) {
        const element = document.createElement('span');
        element.className = className;
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function renderWall() {
        const fragment = document.createDocumentFragment();
        const selectedCell = state.selectedKey ? keyToCell(state.selectedKey) : null;

        elements.wallGrid.style.gridTemplateColumns =
            'repeat(' + state.columns + ', minmax(88px, 1fr))';
        elements.wallGrid.style.setProperty('--display-gap', state.gap + 'px');
        elements.wallGrid.setAttribute('aria-rowcount', String(state.rows));
        elements.wallGrid.setAttribute('aria-colcount', String(state.columns));

        while (elements.wallGrid.firstChild) {
            elements.wallGrid.removeChild(elements.wallGrid.firstChild);
        }

        for (let row = 0; row < state.rows; row++) {
            for (let column = 0; column < state.columns; column++) {
                const key = cellKey(row, column);
                const anchorKey = findAnchorKey(row, column);
                if (anchorKey !== key) continue;

                const span = getSpan(key);
                const assignedFeedId = state.cells[key] || null;
                const feed = assignedFeedId ? state.feedMap[assignedFeedId] : null;
                const id = screenId(row, column);
                const button = document.createElement('button');
                const position = document.createElement('span');
                const dot = document.createElement('span');

                button.type = 'button';
                button.className = 'wall-cell ' + (assignedFeedId ? 'assigned' : 'unassigned');
                button.dataset.cellKey = key;
                button.setAttribute('role', 'gridcell');
                button.setAttribute('aria-rowindex', String(row + 1));
                button.setAttribute('aria-colindex', String(column + 1));
                button.setAttribute('aria-rowspan', String(span.rowSpan));
                button.setAttribute('aria-colspan', String(span.columnSpan));
                button.setAttribute('aria-selected', state.selectedKey === key ? 'true' : 'false');
                button.style.gridRow = (row + 1) + ' / span ' + span.rowSpan;
                button.style.gridColumn = (column + 1) + ' / span ' + span.columnSpan;
                button.setAttribute(
                    'aria-label',
                    id + (span.rowSpan > 1 || span.columnSpan > 1
                        ? ', merged area ' + span.rowSpan + ' rows by ' + span.columnSpan + ' columns'
                        : '') +
                    ', ' + (assignedFeedId ? (feed ? feed.displayName : 'unavailable feed ' + assignedFeedId) : 'unassigned')
                );

                if (state.selectedKey === key) button.classList.add('selected');
                if (assignedFeedId && !feed) button.classList.add('invalid');
                if (span.rowSpan > 1 || span.columnSpan > 1) button.classList.add('merged');

                position.className = 'wall-cell-position';
                appendTextElement(position, 'screen-number', id);
                if (span.rowSpan > 1 || span.columnSpan > 1) {
                    appendTextElement(position, 'span-badge', span.rowSpan + ' × ' + span.columnSpan);
                } else {
                    appendTextElement(position, 'position-label', 'Row ' + (row + 1) + ' · Col ' + (column + 1));
                }
                button.appendChild(position);

                appendTextElement(
                    button,
                    'feed-name',
                    assignedFeedId ? (feed ? feed.displayName : 'Unavailable feed') : 'No feed assigned'
                );
                appendTextElement(button, 'feed-id', assignedFeedId || 'Touch to select');

                dot.className = 'assignment-dot';
                dot.setAttribute('aria-hidden', 'true');
                position.appendChild(dot);

                fragment.appendChild(button);
            }
        }

        elements.wallGrid.appendChild(fragment);

        if (selectedCell) {
            const selectedFeed = selectedCell.feedId ? state.feedMap[selectedCell.feedId] : null;
            elements.selectionHint.textContent =
                selectedCell.screenId + ' selected' +
                (selectedCell.rowSpan > 1 || selectedCell.columnSpan > 1
                    ? ' · ' + selectedCell.rowSpan + ' × ' + selectedCell.columnSpan + ' merged area'
                    : '') +
                (selectedCell.feedId
                    ? ' · ' + (selectedFeed ? selectedFeed.displayName : 'Unavailable feed ' + selectedCell.feedId)
                    : ' · no feed assigned');
        } else {
            elements.selectionHint.textContent = state.editEnabled
                ? 'Select a display, then choose a feed.'
                : 'Read-only wall preview.';
        }
    }

    function logicalAreaCount() {
        let count = state.rows * state.columns;
        Object.keys(state.spans).forEach(function (key) {
            const span = state.spans[key];
            count -= span.rowSpan * span.columnSpan - 1;
        });
        return count;
    }

    function renderSpanControls() {
        const selected = state.selectedKey ? keyToCell(state.selectedKey) : null;
        const enabled = state.editEnabled && Boolean(selected);
        const span = selected ? getSpan(selected.anchorKey) : { rowSpan: 1, columnSpan: 1 };

        elements.rowSpanInput.disabled = !enabled;
        elements.columnSpanInput.disabled = !enabled;
        elements.mergeCellsButton.disabled = !enabled;
        elements.splitCellsButton.disabled =
            !enabled || (span.rowSpan === 1 && span.columnSpan === 1);

        elements.rowSpanInput.value = String(span.rowSpan);
        elements.columnSpanInput.value = String(span.columnSpan);
        elements.rowSpanInput.max = selected ? String(state.rows - selected.row) : '1';
        elements.columnSpanInput.max = selected ? String(state.columns - selected.column) : '1';

        if (!selected) {
            elements.spanSummary.textContent = 'Select a display to merge cells';
        } else if (span.rowSpan > 1 || span.columnSpan > 1) {
            elements.spanSummary.textContent =
                selected.screenId + ' is a ' + span.rowSpan + ' × ' + span.columnSpan + ' merged area';
        } else {
            elements.spanSummary.textContent =
                'Merge from ' + selected.screenId + ' as the top-left cell';
        }
    }

    function renderFeeds() {
        const fragment = document.createDocumentFragment();
        const selectedCell = state.selectedKey ? keyToCell(state.selectedKey) : null;
        const currentFeedId = selectedCell ? selectedCell.feedId : null;

        while (elements.feedList.firstChild) {
            elements.feedList.removeChild(elements.feedList.firstChild);
        }

        elements.feedSummary.textContent =
            state.feeds.length + (state.feeds.length === 1 ? ' feed configured' : ' feeds configured');

        if (!state.feeds.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No feeds are available. Supply AvailableFeedsJson from WinCC Unified.';
            elements.feedList.appendChild(empty);
            return;
        }

        state.feeds.forEach(function (feed) {
            const usedKeys = assignedKeysForFeed(feed.id);
            const usedElsewhere = usedKeys.some(function (key) {
                return key !== state.selectedKey;
            });
            const button = document.createElement('button');
            const thumbnail = document.createElement('span');
            const copy = document.createElement('span');

            button.type = 'button';
            button.className = 'feed-item';
            button.dataset.feedId = feed.id;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', currentFeedId === feed.id ? 'true' : 'false');
            button.setAttribute('aria-label', 'Assign feed ' + feed.displayName);

            if (currentFeedId === feed.id) button.classList.add('current');
            button.disabled =
                !state.editEnabled ||
                !selectedCell ||
                (!state.allowDuplicates && usedElsewhere);

            thumbnail.className = 'feed-thumbnail';
            if (feed.thumbnailUrl) {
                const image = document.createElement('img');
                image.src = feed.thumbnailUrl;
                image.alt = '';
                image.draggable = false;
                image.addEventListener('error', function () {
                    if (image.parentNode) {
                        image.parentNode.removeChild(image);
                        thumbnail.textContent = 'NO PREVIEW';
                    }
                });
                thumbnail.appendChild(image);
            } else {
                thumbnail.textContent = 'FEED';
            }

            copy.className = 'feed-copy';
            appendTextElement(copy, 'feed-item-name', feed.displayName);
            appendTextElement(copy, 'feed-item-id', feed.id);
            if (feed.description) appendTextElement(copy, 'feed-item-description', feed.description);
            if (usedKeys.length) {
                appendTextElement(
                    copy,
                    'feed-in-use',
                    'In use: ' + usedKeys.map(function (key) {
                        return keyToCell(key).screenId;
                    }).join(', ')
                );
            }

            button.appendChild(thumbnail);
            button.appendChild(copy);
            fragment.appendChild(button);
        });

        elements.feedList.appendChild(fragment);
    }

    function applyTheme() {
        const root = document.documentElement;
        root.style.setProperty('--background', toColor(readProperty('BackgroundColor'), DEFAULTS.BackgroundColor));
        root.style.setProperty('--cell', toColor(readProperty('CellColor'), DEFAULTS.CellColor));
        root.style.setProperty('--cell-selected', toColor(readProperty('SelectedCellColor'), DEFAULTS.SelectedCellColor));
        root.style.setProperty('--cell-assigned', toColor(readProperty('AssignedCellColor'), DEFAULTS.AssignedCellColor));
        root.style.setProperty('--text', toColor(readProperty('TextColor'), DEFAULTS.TextColor));
    }

    function renderConfiguration() {
        const areaCount = logicalAreaCount();
        elements.wallTitle.textContent = state.wallName || 'Video Wall';
        elements.dimensionSummary.textContent =
            state.rows + ' × ' + state.columns + ' physical · ' +
            areaCount + (areaCount === 1 ? ' area' : ' areas');
        elements.wallNameInput.value = state.wallName;
        elements.rowsInput.value = String(state.rows);
        elements.columnsInput.value = String(state.columns);
        elements.gapInput.value = String(state.gap);

        elements.wallNameInput.disabled = !state.editEnabled;
        elements.rowsInput.disabled = !state.editEnabled;
        elements.columnsInput.disabled = !state.editEnabled;
        elements.gapInput.disabled = !state.editEnabled;
        elements.updateLayoutButton.disabled = !state.editEnabled;

        elements.app.classList.toggle('read-only', !state.editEnabled);
        elements.editModeBadge.classList.toggle('read-only', !state.editEnabled);
        elements.editModeBadge.textContent = state.editEnabled ? 'EDIT' : 'READ ONLY';
    }

    function renderActions() {
        const selected = state.selectedKey ? keyToCell(state.selectedKey) : null;
        const assignmentCount = Object.keys(state.cells).length;

        elements.clearCellButton.disabled =
            !state.editEnabled || !selected || !selected.feedId;
        elements.clearWallButton.disabled =
            !state.editEnabled || assignmentCount === 0;
        elements.resetButton.disabled =
            !state.editEnabled || !state.hasUnsavedChanges;
        elements.applyButton.disabled =
            !state.editEnabled || !state.hasUnsavedChanges;
    }

    function renderAll() {
        if (!state.initialized || state.destroyed) return;
        applyTheme();
        renderConfiguration();
        renderWall();
        renderSpanControls();
        renderFeeds();
        renderActions();
        setStatus(state.statusText, state.statusLevel);
        resizeControl();
    }

    function selectCell(key, reason) {
        if (key !== null && !keyToCell(key)) {
            reportConfigurationError('INVALID_CELL', ['The requested wall cell does not exist.'], reason || 'selection');
            return false;
        }

        const selectedCell = key ? keyToCell(key) : null;
        state.selectedKey = selectedCell ? selectedCell.anchorKey : null;
        writeProperty('SelectedCell', selectedCell ? selectedCell.screenId : '');
        renderWall();
        renderSpanControls();
        renderFeeds();
        renderActions();

        fireEvent('CellSelected', eventPayload({
            reason: reason || 'operator',
            cell: state.selectedKey ? cellEventData(state.selectedKey) : null
        }));
        return true;
    }

    function assignFeed(feedId) {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'assign');
            return;
        }

        const cell = state.selectedKey ? keyToCell(state.selectedKey) : null;
        const feed = state.feedMap[feedId];
        if (!cell) {
            reportConfigurationError('NO_CELL_SELECTED', ['Select a wall cell before choosing a feed.'], 'assign');
            return;
        }
        if (!feed) {
            reportConfigurationError('UNKNOWN_FEED', ['Feed "' + feedId + '" is unavailable.'], 'assign');
            return;
        }

        const usedElsewhere = assignedKeysForFeed(feedId).filter(function (key) {
            return key !== state.selectedKey;
        });
        if (!state.allowDuplicates && usedElsewhere.length) {
            reportConfigurationError(
                'DUPLICATE_FEED',
                [
                    'Feed "' + feed.displayName + '" is already assigned to ' +
                    keyToCell(usedElsewhere[0]).screenId + '.'
                ],
                'assign'
            );
            return;
        }

        const previousFeedId = cell.feedId;
        if (previousFeedId === feedId) {
            setStatus(feed.displayName + ' is already assigned to ' + cell.screenId + '.', 'ok');
            return;
        }

        if (previousFeedId) {
            fireEvent('FeedRemoved', eventPayload({
                reason: 'replaced',
                cell: cellEventData(state.selectedKey),
                feedId: previousFeedId
            }));
        }

        state.cells[state.selectedKey] = feedId;
        syncModelProperties();
        publishLayout(previousFeedId ? 'feed-replaced' : 'feed-assigned', true);
        renderAll();
        setStatus(feed.displayName + ' assigned to ' + cell.screenId + '.', 'ok');

        fireEvent('FeedAssigned', eventPayload({
            reason: previousFeedId ? 'replaced' : 'assigned',
            cell: cellEventData(state.selectedKey),
            feedId: feedId,
            feedName: feed.displayName,
            replacedFeedId: previousFeedId || null
        }));
    }

    function removeSelectedFeed(reason) {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'remove');
            return;
        }

        const cell = state.selectedKey ? keyToCell(state.selectedKey) : null;
        if (!cell || !cell.feedId) {
            setStatus('The selected cell has no feed to remove.', 'warning');
            return;
        }

        const removedFeedId = cell.feedId;
        const removedFeed = state.feedMap[removedFeedId];
        delete state.cells[state.selectedKey];

        publishLayout('feed-removed', true);
        renderAll();
        setStatus('Feed removed from ' + cell.screenId + '.', 'ok');
        fireEvent('FeedRemoved', eventPayload({
            reason: reason || 'operator',
            cell: cellEventData(state.selectedKey),
            feedId: removedFeedId,
            feedName: removedFeed ? removedFeed.displayName : null
        }));
    }

    function rectanglesOverlap(first, second) {
        return first.row < second.row + second.rowSpan &&
            first.row + first.rowSpan > second.row &&
            first.column < second.column + second.columnSpan &&
            first.column + first.columnSpan > second.column;
    }

    function mergeSelected(rowSpanValue, columnSpanValue, reason) {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'merge');
            return false;
        }

        const selected = state.selectedKey ? keyToCell(state.selectedKey) : null;
        if (!selected) {
            reportConfigurationError('NO_CELL_SELECTED', ['Select the top-left cell of the area to merge.'], 'merge');
            return false;
        }

        const rowSpan = Number(rowSpanValue);
        const columnSpan = Number(columnSpanValue);
        if (!Number.isInteger(rowSpan) || rowSpan < 1 ||
            !Number.isInteger(columnSpan) || columnSpan < 1) {
            reportConfigurationError(
                'INVALID_SPAN',
                ['Merge rows and columns must be positive whole numbers.'],
                'merge'
            );
            return false;
        }
        if (selected.row + rowSpan > state.rows || selected.column + columnSpan > state.columns) {
            reportConfigurationError(
                'SPAN_OUTSIDE_WALL',
                [
                    'A ' + rowSpan + ' × ' + columnSpan + ' area from ' + selected.screenId +
                    ' extends outside the wall.'
                ],
                'merge'
            );
            renderSpanControls();
            return false;
        }

        const previousSpan = getSpan(state.selectedKey);
        if (previousSpan.rowSpan === rowSpan && previousSpan.columnSpan === columnSpan) {
            setStatus(selected.screenId + ' already has that merged size.', 'ok');
            return true;
        }

        const target = {
            row: selected.row,
            column: selected.column,
            rowSpan: rowSpan,
            columnSpan: columnSpan
        };
        const overlappingArea = Object.keys(state.spans).find(function (key) {
            if (key === state.selectedKey) return false;
            const position = keyToPosition(key, state.rows, state.columns);
            const span = state.spans[key];
            return rectanglesOverlap(target, {
                row: position.row,
                column: position.column,
                rowSpan: span.rowSpan,
                columnSpan: span.columnSpan
            });
        });

        if (overlappingArea) {
            reportConfigurationError(
                'OVERLAPPING_MERGED_AREA',
                [
                    'The requested area overlaps merged area ' +
                    keyToPosition(overlappingArea, state.rows, state.columns).screenId +
                    '. Split that area first.'
                ],
                'merge'
            );
            return false;
        }

        const coveredKeys = [];
        for (let row = selected.row; row < selected.row + rowSpan; row++) {
            for (let column = selected.column; column < selected.column + columnSpan; column++) {
                const key = cellKey(row, column);
                if (key !== state.selectedKey) coveredKeys.push(key);
            }
        }

        const removedAssignments = coveredKeys.filter(function (key) {
            return Boolean(state.cells[key]);
        }).map(function (key) {
            return cellEventData(key);
        });

        if (removedAssignments.length && !window.confirm(
            'Merging this area will remove ' + removedAssignments.length +
            (removedAssignments.length === 1
                ? ' feed assignment from a covered cell. Continue?'
                : ' feed assignments from covered cells. Continue?')
        )) {
            setStatus('Merge cancelled.', 'warning');
            renderSpanControls();
            return false;
        }

        coveredKeys.forEach(function (key) {
            delete state.cells[key];
        });

        if (rowSpan === 1 && columnSpan === 1) {
            delete state.spans[state.selectedKey];
        } else {
            state.spans[state.selectedKey] = {
                rowSpan: rowSpan,
                columnSpan: columnSpan
            };
        }

        publishLayout(previousSpan.rowSpan === 1 && previousSpan.columnSpan === 1
            ? 'cells-merged'
            : 'merged-area-resized', true);
        renderAll();
        setStatus(
            selected.screenId + ' is now a ' + rowSpan + ' × ' + columnSpan + ' display area.',
            'ok'
        );

        removedAssignments.forEach(function (cell) {
            fireEvent('FeedRemoved', eventPayload({
                reason: 'cells-merged',
                cell: cell,
                feedId: cell.feedId,
                feedName: cell.feedName
            }));
        });
        fireEvent('CellsMerged', eventPayload({
            reason: reason || 'operator',
            cell: cellEventData(state.selectedKey),
            previousRowSpan: previousSpan.rowSpan,
            previousColumnSpan: previousSpan.columnSpan,
            removedAssignments: removedAssignments
        }));
        return true;
    }

    function splitSelected(reason) {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'split');
            return false;
        }

        const selected = state.selectedKey ? keyToCell(state.selectedKey) : null;
        if (!selected) {
            reportConfigurationError('NO_CELL_SELECTED', ['Select a merged area to split.'], 'split');
            return false;
        }

        const previousSpan = getSpan(state.selectedKey);
        if (previousSpan.rowSpan === 1 && previousSpan.columnSpan === 1) {
            setStatus(selected.screenId + ' is already an individual cell.', 'ok');
            return true;
        }

        delete state.spans[state.selectedKey];
        publishLayout('cells-split', true);
        renderAll();
        setStatus(selected.screenId + ' was split into individual cells.', 'ok');
        fireEvent('CellsSplit', eventPayload({
            reason: reason || 'operator',
            cell: cellEventData(state.selectedKey),
            previousRowSpan: previousSpan.rowSpan,
            previousColumnSpan: previousSpan.columnSpan
        }));
        return true;
    }

    function assignmentKeysOutside(rows, columns) {
        return Object.keys(state.cells).filter(function (key) {
            const parts = key.split(',');
            return Number(parts[0]) >= rows || Number(parts[1]) >= columns;
        });
    }

    function changeDimensions(rows, columns, requireConfirmation, reason) {
        const validation = validateDimensions(rows, columns);
        if (!validation.valid) {
            reportConfigurationError('INVALID_DIMENSIONS', [validation.message], reason || 'dimensions');
            renderConfiguration();
            return false;
        }

        if (rows === state.rows && columns === state.columns) return true;

        const removedKeys = assignmentKeysOutside(rows, columns);
        const clippedSpans = Object.keys(state.spans).filter(function (key) {
            const position = keyToPosition(key, state.rows, state.columns);
            const span = state.spans[key];
            return position.row >= rows || position.column >= columns ||
                position.row + span.rowSpan > rows ||
                position.column + span.columnSpan > columns;
        });

        if (requireConfirmation && (removedKeys.length || clippedSpans.length)) {
            let confirmation = 'Reducing the wall to ' + rows + ' × ' + columns + ' will';
            if (removedKeys.length) {
                confirmation += ' remove ' + removedKeys.length +
                    (removedKeys.length === 1 ? ' feed assignment' : ' feed assignments');
            }
            if (removedKeys.length && clippedSpans.length) confirmation += ' and';
            if (clippedSpans.length) {
                confirmation += ' resize or remove ' + clippedSpans.length +
                    (clippedSpans.length === 1 ? ' merged area' : ' merged areas');
            }
            confirmation += '. Continue?';

            const accepted = window.confirm(confirmation);
            if (!accepted) {
                setStatus('Wall size change cancelled.', 'warning');
                renderConfiguration();
                return false;
            }
        }

        const retainedCells = Object.create(null);
        Object.keys(state.cells).forEach(function (key) {
            if (removedKeys.indexOf(key) === -1) retainedCells[key] = state.cells[key];
        });

        const retainedSpans = Object.create(null);
        Object.keys(state.spans).forEach(function (key) {
            const position = keyToPosition(key, state.rows, state.columns);
            if (position.row >= rows || position.column >= columns) return;

            const oldSpan = state.spans[key];
            const rowSpan = Math.min(oldSpan.rowSpan, rows - position.row);
            const columnSpan = Math.min(oldSpan.columnSpan, columns - position.column);
            if (rowSpan > 1 || columnSpan > 1) {
                retainedSpans[key] = {
                    rowSpan: rowSpan,
                    columnSpan: columnSpan
                };
            }
        });

        state.rows = rows;
        state.columns = columns;
        state.cells = retainedCells;
        state.spans = retainedSpans;

        if (state.selectedKey) {
            const selectedPosition = keyToPosition(state.selectedKey, rows, columns);
            state.selectedKey = selectedPosition ? findAnchorKey(selectedPosition.row, selectedPosition.column) : null;
        }

        syncModelProperties();
        publishLayout('dimensions-changed', true);
        renderAll();

        if (removedKeys.length || clippedSpans.length) {
            let resultMessage = 'Wall resized to ' + rows + ' × ' + columns + '; ';
            if (removedKeys.length) {
                resultMessage += removedKeys.length +
                    (removedKeys.length === 1 ? ' assignment was removed' : ' assignments were removed');
            }
            if (removedKeys.length && clippedSpans.length) resultMessage += ' and ';
            if (clippedSpans.length) {
                resultMessage += clippedSpans.length +
                    (clippedSpans.length === 1 ? ' merged area was adjusted' : ' merged areas were adjusted');
            }
            setStatus(
                resultMessage + '.',
                'warning'
            );
        } else {
            setStatus('Wall resized to ' + rows + ' × ' + columns + '.', 'ok');
        }
        return true;
    }

    function changeGap(value, reason) {
        const gap = normalizeGap(value);
        if (gap === null) {
            reportConfigurationError(
                'INVALID_DISPLAY_GAP',
                ['Display gap must be from ' + LIMITS.MIN_GAP + ' to ' + LIMITS.MAX_GAP + ' pixels.'],
                reason || 'gap'
            );
            renderConfiguration();
            return false;
        }

        if (gap === state.gap) return true;
        state.gap = gap;
        writeProperty('DisplayGap', gap);
        publishLayout('display-gap-changed', true);
        renderAll();
        setStatus('Display gap set to ' + gap + ' px.', 'ok');
        return true;
    }

    function changeWallName(value, reason) {
        const wallName = normalizeWallName(value);
        if (wallName === state.wallName) return true;

        state.wallName = wallName;
        writeProperty('WallName', wallName);
        publishLayout('wall-name-changed', true);
        renderAll();
        setStatus(wallName ? 'Wall name updated.' : 'Wall name cleared.', 'ok');
        return true;
    }

    function clearWall() {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'clear-wall');
            return;
        }

        const assignedKeys = Object.keys(state.cells);
        if (!assignedKeys.length) {
            setStatus('The wall has no assignments to clear.', 'ok');
            return;
        }

        if (!window.confirm(
            'Clear all ' + assignedKeys.length +
            (assignedKeys.length === 1 ? ' feed assignment?' : ' feed assignments?')
        )) {
            setStatus('Clear wall cancelled.', 'warning');
            return;
        }

        const removed = assignedKeys.map(function (key) {
            return cellEventData(key);
        });
        state.cells = Object.create(null);

        publishLayout('wall-cleared', true);
        renderAll();
        setStatus('All feed assignments were cleared.', 'ok');

        removed.forEach(function (cell) {
            fireEvent('FeedRemoved', eventPayload({
                reason: 'wall-cleared',
                cell: cell,
                feedId: cell.feedId,
                feedName: cell.feedName
            }));
        });
    }

    function applyLayout() {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'apply');
            return;
        }

        const issues = currentAssignmentIssues();
        if (issues.length) {
            reportConfigurationError('LAYOUT_NOT_APPLICABLE', issues, 'apply');
            return;
        }

        state.baseline = snapshotModel();
        publishLayout('applied', false);
        renderAll();
        setStatus('Layout applied and sent to WinCC Unified.', 'ok');
    }

    function resetChanges() {
        if (!state.editEnabled) {
            reportConfigurationError('EDIT_DISABLED', ['The wall is read-only.'], 'reset');
            return;
        }
        if (!state.hasUnsavedChanges) {
            setStatus('There are no unsaved changes to reset.', 'ok');
            return;
        }
        if (!state.baseline) {
            reportConfigurationError('NO_BASELINE', ['No saved layout is available to restore.'], 'reset');
            return;
        }
        if (!window.confirm('Discard all unsaved wall changes and restore the last applied layout?')) {
            setStatus('Reset cancelled.', 'warning');
            return;
        }

        restoreSnapshot(state.baseline);
        syncModelProperties();
        publishLayout('reset', false);
        renderAll();

        const issues = currentAssignmentIssues();
        if (issues.length) {
            reportConfigurationError('RESET_LAYOUT_WARNING', issues, 'reset');
        } else {
            setStatus('Last applied layout restored.', 'ok');
        }
    }

    function applyIncomingLayout(rawValue) {
        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
            return false;
        }

        const result = parseLayoutJson(rawValue);
        if (!result.ok) {
            reportConfigurationError('INVALID_LAYOUT_JSON', result.issues, 'LayoutJson');
            return false;
        }

        restoreSnapshot(result.model);
        state.baseline = snapshotModel();
        setDirty(false);
        syncModelProperties();
        renderAll();

        if (result.issues.length) {
            reportConfigurationError('LAYOUT_REFERENCES_REJECTED', result.issues, 'LayoutJson');
        } else {
            setStatus('Layout loaded from WinCC Unified.', 'ok');
        }
        return true;
    }

    function applyIncomingFeeds(rawValue) {
        const result = parseFeedsJson(rawValue);
        if (!result.ok) {
            reportConfigurationError('INVALID_FEED_JSON', result.issues, 'AvailableFeedsJson');
            return false;
        }

        setFeeds(result.feeds);
        renderFeeds();
        renderWall();
        renderActions();

        const assignmentIssues = currentAssignmentIssues();
        const issues = result.issues.concat(assignmentIssues);
        if (issues.length) {
            reportConfigurationError('FEED_CONFIGURATION_WARNING', issues, 'AvailableFeedsJson');
        } else if (!result.feeds.length) {
            setStatus('No video feeds are configured.', 'warning');
        } else {
            setStatus(result.feeds.length + ' video feeds loaded.', 'ok');
        }
        return true;
    }

    function onConfigurationSubmit(event) {
        event.preventDefault();
        if (!state.editEnabled) return;

        const rows = Number(elements.rowsInput.value);
        const columns = Number(elements.columnsInput.value);
        const gap = normalizeGap(elements.gapInput.value);
        const wallName = elements.wallNameInput.value;
        const dimensionsChanged = rows !== state.rows || columns !== state.columns;

        if (gap === null) {
            changeGap(elements.gapInput.value, 'operator');
            return;
        }

        if (dimensionsChanged && !changeDimensions(rows, columns, true, 'operator')) return;
        changeWallName(wallName, 'operator');
        changeGap(gap, 'operator');

        if (!dimensionsChanged && normalizeWallName(wallName) === state.wallName && gap === state.gap) {
            setStatus('Wall settings are already up to date.', 'ok');
        }
    }

    function onDimensionInputChange() {
        if (!state.editEnabled) return;
        changeDimensions(
            Number(elements.rowsInput.value),
            Number(elements.columnsInput.value),
            true,
            'operator'
        );
    }

    function onWallClick(event) {
        const button = event.target.closest ? event.target.closest('.wall-cell') : null;
        if (!button || !elements.wallGrid.contains(button)) return;
        selectCell(button.dataset.cellKey, 'operator');
    }

    function onFeedClick(event) {
        const button = event.target.closest ? event.target.closest('.feed-item') : null;
        if (!button || !elements.feedList.contains(button) || button.disabled) return;
        assignFeed(button.dataset.feedId);
    }

    function resizeControl() {
        if (!elements.app || state.destroyed) return;

        const width = elements.app.clientWidth;
        const height = elements.app.clientHeight;
        elements.app.classList.toggle('narrow', width < 760);
        elements.app.classList.toggle('compact', height < 540);
        elements.app.classList.toggle('tiny', width < 470 || height < 360);
    }

    function requestResize() {
        if (state.resizeFrame !== null || state.destroyed) return;
        state.resizeFrame = window.requestAnimationFrame(function () {
            state.resizeFrame = null;
            resizeControl();
        });
    }

    function attachEvents() {
        handlers.configurationSubmit = onConfigurationSubmit;
        handlers.rowsChange = onDimensionInputChange;
        handlers.columnsChange = onDimensionInputChange;
        handlers.wallNameChange = function () {
            if (state.editEnabled) changeWallName(elements.wallNameInput.value, 'operator');
        };
        handlers.gapChange = function () {
            if (state.editEnabled) changeGap(elements.gapInput.value, 'operator');
        };
        handlers.wallClick = onWallClick;
        handlers.feedClick = onFeedClick;
        handlers.mergeCells = function () {
            mergeSelected(
                elements.rowSpanInput.value,
                elements.columnSpanInput.value,
                'operator'
            );
        };
        handlers.splitCells = function () {
            splitSelected('operator');
        };
        handlers.clearCell = function () {
            removeSelectedFeed('operator');
        };
        handlers.clearWall = clearWall;
        handlers.reset = resetChanges;
        handlers.apply = applyLayout;
        handlers.resize = requestResize;
        handlers.beforeUnload = destroyControl;

        elements.configurationForm.addEventListener('submit', handlers.configurationSubmit);
        elements.rowsInput.addEventListener('change', handlers.rowsChange);
        elements.columnsInput.addEventListener('change', handlers.columnsChange);
        elements.wallNameInput.addEventListener('change', handlers.wallNameChange);
        elements.gapInput.addEventListener('change', handlers.gapChange);
        elements.wallGrid.addEventListener('click', handlers.wallClick);
        elements.feedList.addEventListener('click', handlers.feedClick);
        elements.mergeCellsButton.addEventListener('click', handlers.mergeCells);
        elements.splitCellsButton.addEventListener('click', handlers.splitCells);
        elements.clearCellButton.addEventListener('click', handlers.clearCell);
        elements.clearWallButton.addEventListener('click', handlers.clearWall);
        elements.resetButton.addEventListener('click', handlers.reset);
        elements.applyButton.addEventListener('click', handlers.apply);
        window.addEventListener('resize', handlers.resize);
        window.addEventListener('pagehide', handlers.beforeUnload);
        window.addEventListener('beforeunload', handlers.beforeUnload);
    }

    function destroyControl() {
        if (state.destroyed) return;
        state.destroyed = true;

        if (state.resizeFrame !== null) {
            window.cancelAnimationFrame(state.resizeFrame);
            state.resizeFrame = null;
        }

        if (!state.initialized) return;
        elements.configurationForm.removeEventListener('submit', handlers.configurationSubmit);
        elements.rowsInput.removeEventListener('change', handlers.rowsChange);
        elements.columnsInput.removeEventListener('change', handlers.columnsChange);
        elements.wallNameInput.removeEventListener('change', handlers.wallNameChange);
        elements.gapInput.removeEventListener('change', handlers.gapChange);
        elements.wallGrid.removeEventListener('click', handlers.wallClick);
        elements.feedList.removeEventListener('click', handlers.feedClick);
        elements.mergeCellsButton.removeEventListener('click', handlers.mergeCells);
        elements.splitCellsButton.removeEventListener('click', handlers.splitCells);
        elements.clearCellButton.removeEventListener('click', handlers.clearCell);
        elements.clearWallButton.removeEventListener('click', handlers.clearWall);
        elements.resetButton.removeEventListener('click', handlers.reset);
        elements.applyButton.removeEventListener('click', handlers.apply);
        window.removeEventListener('resize', handlers.resize);
        window.removeEventListener('pagehide', handlers.beforeUnload);
        window.removeEventListener('beforeunload', handlers.beforeUnload);
    }

    function handlePropertyChange(data) {
        if (state.destroyed || !data || !data.key) return;
        if (isOwnPropertyEcho(data.key, data.value)) return;

        switch (data.key) {
            case 'AvailableFeedsJson':
                applyIncomingFeeds(data.value);
                break;
            case 'LayoutJson':
                applyIncomingLayout(data.value);
                break;
            case 'Rows': {
                const previousRows = state.rows;
                if (!changeDimensions(Number(data.value), state.columns, false, 'Rows property')) {
                    writeProperty('Rows', previousRows);
                }
                break;
            }
            case 'Columns': {
                const previousColumns = state.columns;
                if (!changeDimensions(state.rows, Number(data.value), false, 'Columns property')) {
                    writeProperty('Columns', previousColumns);
                }
                break;
            }
            case 'DisplayGap': {
                const previousGap = state.gap;
                if (!changeGap(data.value, 'DisplayGap property')) {
                    writeProperty('DisplayGap', previousGap);
                }
                break;
            }
            case 'WallName':
                changeWallName(data.value, 'WallName property');
                break;
            case 'AllowDuplicateFeeds':
                state.allowDuplicates = toBoolean(data.value, false);
                renderAll();
                {
                    const issues = currentAssignmentIssues();
                    if (issues.length) {
                        reportConfigurationError('DUPLICATE_ASSIGNMENTS', issues, 'AllowDuplicateFeeds');
                    } else {
                        setStatus(
                            state.allowDuplicates ? 'Duplicate feed assignments are allowed.' : 'Duplicate feed assignments are prevented.',
                            'ok'
                        );
                    }
                }
                break;
            case 'EditEnabled':
                state.editEnabled = toBoolean(data.value, true);
                renderAll();
                setStatus(state.editEnabled ? 'Editing enabled.' : 'Read-only mode enabled.', 'ok');
                break;
            case 'SelectedCell':
                if (data.value === undefined || data.value === null || String(data.value).trim() === '') {
                    selectCell(null, 'SelectedCell property');
                } else {
                    const key = screenIdToKey(data.value);
                    if (!key) {
                        reportConfigurationError(
                            'INVALID_SELECTED_CELL',
                            ['SelectedCell "' + data.value + '" is outside the current wall or is not in R1C1 format.'],
                            'SelectedCell'
                        );
                        writeProperty('SelectedCell', state.selectedKey ? keyToCell(state.selectedKey).screenId : '');
                    } else {
                        selectCell(key, 'SelectedCell property');
                    }
                }
                break;
            case 'BackgroundColor':
            case 'CellColor':
            case 'SelectedCellColor':
            case 'AssignedCellColor':
            case 'TextColor':
                applyTheme();
                break;
            case 'StatusText':
            case 'HasUnsavedChanges':
                // These values are outputs owned by the control.
                break;
            default:
                break;
        }
    }

    function selectCellMethod(value) {
        if (value === undefined || value === null || String(value).trim() === '') {
            selectCell(null, 'method');
            return;
        }

        const key = screenIdToKey(value);
        if (!key) {
            reportConfigurationError(
                'INVALID_SELECTED_CELL',
                ['SelectCell expected an existing screen ID such as R1C1.'],
                'method'
            );
            return;
        }
        selectCell(key, 'method');
    }

    function mergeSelectedMethod(rowSpan, columnSpan) {
        mergeSelected(rowSpan, columnSpan, 'method');
    }

    function splitSelectedMethod() {
        splitSelected('method');
    }

    function initializeControl() {
        cacheElements();

        state.rows = Number(readProperty('Rows'));
        state.columns = Number(readProperty('Columns'));
        const dimensionResult = validateDimensions(state.rows, state.columns);
        const initialIssues = [];

        if (!dimensionResult.valid) {
            initialIssues.push(dimensionResult.message);
            state.rows = DEFAULTS.Rows;
            state.columns = DEFAULTS.Columns;
        }

        const initialGap = normalizeGap(readProperty('DisplayGap'));
        if (initialGap === null) {
            initialIssues.push(
                'Display gap must be from ' + LIMITS.MIN_GAP + ' to ' + LIMITS.MAX_GAP + ' pixels.'
            );
            state.gap = DEFAULTS.DisplayGap;
        } else {
            state.gap = initialGap;
        }

        state.wallName = normalizeWallName(readProperty('WallName'));
        state.allowDuplicates = toBoolean(readProperty('AllowDuplicateFeeds'), DEFAULTS.AllowDuplicateFeeds);
        state.editEnabled = toBoolean(readProperty('EditEnabled'), DEFAULTS.EditEnabled);

        const feedResult = parseFeedsJson(readProperty('AvailableFeedsJson'));
        if (feedResult.ok) {
            setFeeds(feedResult.feeds);
            initialIssues.push.apply(initialIssues, feedResult.issues);
        } else {
            setFeeds([]);
            initialIssues.push.apply(initialIssues, feedResult.issues);
        }

        const incomingLayout = readProperty('LayoutJson');
        if (incomingLayout !== undefined && incomingLayout !== null && String(incomingLayout).trim() !== '') {
            const layoutResult = parseLayoutJson(incomingLayout);
            if (layoutResult.ok) {
                restoreSnapshot(layoutResult.model);
                initialIssues.push.apply(initialIssues, layoutResult.issues);
            } else {
                initialIssues.push.apply(initialIssues, layoutResult.issues);
            }
        }

        const selectedValue = readProperty('SelectedCell');
        if (selectedValue !== undefined && selectedValue !== null && String(selectedValue).trim() !== '') {
            const selectedKey = screenIdToKey(selectedValue);
            if (selectedKey) {
                state.selectedKey = selectedKey;
            } else {
                initialIssues.push(
                    'SelectedCell "' + selectedValue + '" is outside the current wall or is not in R1C1 format.'
                );
            }
        }

        state.baseline = snapshotModel();
        state.hasUnsavedChanges = false;
        state.initialized = true;

        attachEvents();
        syncModelProperties();
        setDirty(false);
        renderAll();
        WebCC.onPropertyChanged.subscribe(handlePropertyChange);

        if (initialIssues.length) {
            reportConfigurationError('INITIAL_CONFIGURATION_ERROR', initialIssues, 'initialization');
        } else if (!state.feeds.length) {
            setStatus('Ready. Configure AvailableFeedsJson to begin assigning feeds.', 'warning');
        } else {
            setStatus('Ready. Select a display, then choose a feed.', 'ok');
        }

        requestResize();
    }

    WebCC.start(
        function (result) {
            if (result) {
                initializeControl();
            } else {
                console.error('Datapath Video Wall Editor failed to connect to WebCC.');
            }
        },
        {
            methods: {
                ApplyLayout: applyLayout,
                ResetChanges: resetChanges,
                ClearWall: clearWall,
                SelectCell: selectCellMethod,
                MergeSelected: mergeSelectedMethod,
                SplitSelected: splitSelectedMethod
            },
            events: [
                'LayoutChanged',
                'CellSelected',
                'FeedAssigned',
                'FeedRemoved',
                'CellsMerged',
                'CellsSplit',
                'ConfigurationError'
            ],
            properties: Object.assign({}, DEFAULTS)
        },
        [],
        10000
    );
})();
