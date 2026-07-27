import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..', '..');
const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'Datapath', 'manifest.json'), 'utf8')
);
const chromeCandidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);

if (!chromePath) {
    throw new Error('Chrome/Chromium was not found. Set CHROME_PATH to run this smoke test.');
}
if (typeof WebSocket !== 'function') {
    throw new Error('This smoke test requires a Node.js version with the global WebSocket API.');
}

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function serveRepository() {
    const server = createServer((request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            const relativePath = normalize(pathname).replace(/^[/\\]+/, '');
            const filePath = resolve(repositoryRoot, relativePath);

            if (!filePath.startsWith(repositoryRoot + '/')) {
                response.writeHead(403);
                response.end('Forbidden');
                return;
            }
            if (!statSync(filePath).isFile()) {
                response.writeHead(404);
                response.end('Not found');
                return;
            }

            response.writeHead(200, {
                'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            response.end(readFileSync(filePath));
        } catch (error) {
            response.writeHead(404);
            response.end('Not found');
        }
    });

    return new Promise((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(0, '127.0.0.1', () => {
            resolvePromise(server);
        });
    });
}

function closeServer(server) {
    return new Promise(resolvePromise => {
        server.close(resolvePromise);
    });
}

async function findPageTarget(debugPort) {
    for (let attempt = 0; attempt < 80; attempt++) {
        try {
            const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list');
            const targets = await response.json();
            const target = targets.find(item =>
                item.type === 'page' && item.url.includes('/Datapath/control/index.html')
            );
            if (target) return target;
        } catch (error) {
            // Chrome is still starting.
        }
        await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
    throw new Error('Chrome DevTools target did not become available.');
}

async function connectToDevTools(target) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;

    await new Promise((resolvePromise, rejectPromise) => {
        socket.onopen = resolvePromise;
        socket.onerror = rejectPromise;
    });

    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;

        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
            request.reject(new Error(JSON.stringify(message.error)));
        } else {
            request.resolve(message.result);
        }
    };

    return {
        command(method, params = {}) {
            const id = nextId++;
            return new Promise((resolvePromise, rejectPromise) => {
                pending.set(id, {
                    resolve: resolvePromise,
                    reject: rejectPromise
                });
                socket.send(JSON.stringify({
                    id,
                    method,
                    params
                }));
            });
        },
        close() {
            socket.close();
        }
    };
}

const browserExpression = `(function () {
    const feeds = [
        { id: 'CAMERA_01', displayName: 'North Gate', description: 'Overview' },
        { id: 'CAMERA_02', displayName: 'Loading Bay' },
        { id: 'CAMERA_03', displayName: 'Assembly Line' },
        { id: 'SCADA_OVERVIEW', displayName: 'SCADA Overview' }
    ];

    WebCC._mock.clearLogs();
    WebCC._mock.setProperty('AvailableFeedsJson', JSON.stringify(feeds));
    WebCC._mock.setProperty('LayoutJson', JSON.stringify({
        version: 1,
        wallName: 'Main Wall',
        rows: 2,
        columns: 3,
        displayGap: 10,
        cells: [{ row: 0, column: 0, feedId: 'CAMERA_01' }]
    }));

    document.querySelector('[data-cell-key="0,1"]').click();
    document.querySelector('[data-feed-id="CAMERA_02"]').click();
    const afterAssignment = WebCC._mock.snapshot();
    const assignedLayout = JSON.parse(afterAssignment.properties.LayoutJson);

    document.querySelector('[data-cell-key="1,2"]').click();
    document.querySelector('[data-feed-id="CAMERA_03"]').click();

    const originalConfirm = window.confirm;
    const confirmationMessages = [];
    window.confirm = message => {
        confirmationMessages.push(message);
        return false;
    };
    document.getElementById('rowsInput').value = '1';
    document.getElementById('columnsInput').value = '2';
    document.getElementById('rowsInput').dispatchEvent(
        new Event('change', { bubbles: true })
    );
    const cellsAfterCancelledShrink = document.querySelectorAll('.wall-cell').length;

    window.confirm = message => {
        confirmationMessages.push(message);
        return true;
    };
    document.getElementById('rowsInput').value = '1';
    document.getElementById('columnsInput').value = '2';
    document.getElementById('rowsInput').dispatchEvent(
        new Event('change', { bubbles: true })
    );
    const shrunkLayout = JSON.parse(WebCC.Properties.LayoutJson);

    WebCC._mock.callMethod('ApplyLayout');
    const dirtyAfterApply = WebCC.Properties.HasUnsavedChanges;
    WebCC._mock.callMethod('SelectCell', 'R1C2');
    document.getElementById('clearCellButton').click();
    const dirtyBeforeReset = WebCC.Properties.HasUnsavedChanges;
    WebCC._mock.callMethod('ResetChanges');
    const resetLayout = JSON.parse(WebCC.Properties.LayoutJson);
    const resetFeed = resetLayout.cells.find(cell =>
        cell.row === 0 && cell.column === 1
    ).feedId;
    const dirtyAfterReset = WebCC.Properties.HasUnsavedChanges;
    window.confirm = originalConfirm;

    WebCC._mock.setProperty('LayoutJson', JSON.stringify({
        version: 1,
        rows: 2,
        columns: 3,
        cells: [
            { row: 0, column: 0, feedId: 'CAMERA_01' },
            { row: 1, column: 0, feedId: 'CAMERA_01' },
            { row: 9, column: 9, feedId: 'CAMERA_03' },
            { row: 0, column: 2, feedId: 'MISSING' }
        ]
    }));

    const rejectedAssignedCount = document.querySelectorAll('.wall-cell.assigned').length;
    WebCC._mock.setProperty('Rows', 99);
    const rowsAfterInvalidDimension = document.querySelectorAll('.wall-cell').length / 3;

    WebCC._mock.setProperty('LayoutJson', JSON.stringify({
        version: 1,
        wallName: 'Main Wall',
        rows: 4,
        columns: 4,
        cells: [
            { row: 0, column: 0, feedId: 'CAMERA_01' },
            { row: 1, column: 1, feedId: 'SCADA_OVERVIEW' },
            { row: 1, column: 2, feedId: 'CAMERA_02' }
        ]
    }));
    WebCC._mock.callMethod('SelectCell', 'R2C2');
    document.getElementById('rowSpanInput').value = '2';
    document.getElementById('columnSpanInput').value = '2';

    const mergeConfirmations = [];
    window.confirm = message => {
        mergeConfirmations.push(message);
        return false;
    };
    document.getElementById('mergeCellsButton').click();
    const cancelledMergeDomCount = document.querySelectorAll('.wall-cell').length;
    window.confirm = message => {
        mergeConfirmations.push(message);
        return true;
    };
    document.getElementById('rowSpanInput').value = '2';
    document.getElementById('columnSpanInput').value = '2';
    document.getElementById('mergeCellsButton').click();
    window.confirm = originalConfirm;

    const mergedLayout = JSON.parse(WebCC.Properties.LayoutJson);
    const mergedAnchor = mergedLayout.cells.find(cell =>
        cell.row === 1 && cell.column === 1
    );
    const mergedCoveredCells = mergedLayout.cells.filter(cell =>
        cell.mergedInto === 'R2C2'
    );
    const mergedDomCount = document.querySelectorAll('.wall-cell').length;
    const mergedEventFired = WebCC._mock.events.some(event =>
        event.name === 'CellsMerged'
    );
    WebCC._mock.callMethod('SelectCell', 'R3C3');
    const coveredSelection = WebCC.Properties.SelectedCell;

    WebCC._mock.callMethod('SplitSelected');
    const splitLayout = JSON.parse(WebCC.Properties.LayoutJson);
    const splitDomCount = document.querySelectorAll('.wall-cell').length;
    const splitAnchorFeed = splitLayout.cells.find(cell =>
        cell.row === 1 && cell.column === 1
    ).feedId;
    const splitEventFired = WebCC._mock.events.some(event =>
        event.name === 'CellsSplit'
    );

    WebCC._mock.setProperty('LayoutJson', JSON.stringify(mergedLayout));
    const restoredMergedDomCount = document.querySelectorAll('.wall-cell').length;

    const feedsBeforeMalformed = document.querySelectorAll('.feed-item').length;
    WebCC._mock.setProperty('AvailableFeedsJson', '{bad json');
    const afterMalformed = WebCC._mock.snapshot();

    WebCC._mock.setProperty('EditEnabled', false);
    const readOnly = {
        appClass: document.getElementById('datapathApp').classList.contains('read-only'),
        configDisabled: document.getElementById('rowsInput').disabled,
        feedDisabled: Array.from(document.querySelectorAll('.feed-item')).every(item => item.disabled),
        clearDisabled: document.getElementById('clearWallButton').disabled,
        feedCount: document.querySelectorAll('.feed-item').length
    };

    return {
        title: document.getElementById('wallTitle').textContent,
        cells: document.querySelectorAll('.wall-cell').length,
        assignedFeed: assignedLayout.cells.find(cell =>
            cell.row === 0 && cell.column === 1
        ).feedId,
        dirtyAfterAssignment: afterAssignment.properties.HasUnsavedChanges,
        selectedAfterAssignment: afterAssignment.properties.SelectedCell,
        assignmentEvent: afterAssignment.events.some(event => event.name === 'FeedAssigned'),
        layoutEvent: afterAssignment.events.some(event => event.name === 'LayoutChanged'),
        confirmationCount: confirmationMessages.length,
        shrinkConfirmationMentionsRemoval: confirmationMessages.slice(0, 2).every(message =>
            message.includes('remove 1 feed assignment')
        ),
        resetConfirmationShown: confirmationMessages.some(message =>
            message.includes('Discard all unsaved wall changes')
        ),
        cellsAfterCancelledShrink,
        shrunkRows: shrunkLayout.rows,
        shrunkColumns: shrunkLayout.columns,
        retainedFeedsAfterShrink: shrunkLayout.cells.map(cell => cell.feedId),
        dirtyAfterApply,
        dirtyBeforeReset,
        resetFeed,
        dirtyAfterReset,
        rejectedAssignedCount,
        rowsAfterInvalidDimension,
        mergedAnchor,
        mergeConfirmationCount: mergeConfirmations.length,
        mergeConfirmationMentionsAssignment: mergeConfirmations.every(message =>
            message.includes('remove 1 feed assignment')
        ),
        cancelledMergeDomCount,
        mergedCoveredCount: mergedCoveredCells.length,
        mergedDomCount,
        mergedEventFired,
        coveredSelection,
        splitDomCount,
        splitAnchorFeed,
        splitEventFired,
        restoredMergedDomCount,
        configurationErrors: afterMalformed.events.filter(event =>
            event.name === 'ConfigurationError'
        ).length,
        malformedStatus: afterMalformed.properties.StatusText,
        feedsBeforeMalformed,
        readOnly,
        declaredMethods: WebCC._mock.methods.slice().sort(),
        declaredProperties: Object.keys(WebCC.Properties).sort()
    };
})()`;

const profileDirectory = mkdtempSync(join(tmpdir(), 'datapath-cwc-'));
const server = await serveRepository();
const address = server.address();
const debugPort = 9222 + Math.floor(Math.random() * 1000);
const pageUrl =
    'http://127.0.0.1:' + address.port + '/Datapath/control/index.html?mock';
const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + profileDirectory,
    pageUrl
], {
    stdio: 'ignore'
});

let devTools;

try {
    const target = await findPageTarget(debugPort);
    devTools = await connectToDevTools(target);
    await devTools.command('Runtime.enable');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 400));

    const evaluation = await devTools.command('Runtime.evaluate', {
        expression: browserExpression,
        returnByValue: true,
        awaitPromise: true
    });

    if (evaluation.exceptionDetails) {
        throw new Error(JSON.stringify(evaluation.exceptionDetails));
    }

    const result = evaluation.result.value;
    assert.equal(result.assignedFeed, 'CAMERA_02');
    assert.equal(result.dirtyAfterAssignment, true);
    assert.equal(result.selectedAfterAssignment, 'R1C2');
    assert.equal(result.assignmentEvent, true);
    assert.equal(result.layoutEvent, true);
    assert.equal(result.cells, 13);
    assert.equal(result.confirmationCount, 3);
    assert.equal(result.shrinkConfirmationMentionsRemoval, true);
    assert.equal(result.resetConfirmationShown, true);
    assert.equal(result.cellsAfterCancelledShrink, 6);
    assert.equal(result.shrunkRows, 1);
    assert.equal(result.shrunkColumns, 2);
    assert.deepEqual(result.retainedFeedsAfterShrink, ['CAMERA_01', 'CAMERA_02']);
    assert.equal(result.dirtyAfterApply, false);
    assert.equal(result.dirtyBeforeReset, true);
    assert.equal(result.resetFeed, 'CAMERA_02');
    assert.equal(result.dirtyAfterReset, false);
    assert.equal(result.rejectedAssignedCount, 1);
    assert.equal(result.rowsAfterInvalidDimension, 2);
    assert.equal(result.mergedAnchor.rowSpan, 2);
    assert.equal(result.mergedAnchor.columnSpan, 2);
    assert.equal(result.mergedAnchor.feedId, 'SCADA_OVERVIEW');
    assert.equal(result.mergeConfirmationCount, 2);
    assert.equal(result.mergeConfirmationMentionsAssignment, true);
    assert.equal(result.cancelledMergeDomCount, 16);
    assert.equal(result.mergedCoveredCount, 3);
    assert.equal(result.mergedDomCount, 13);
    assert.equal(result.mergedEventFired, true);
    assert.equal(result.coveredSelection, 'R2C2');
    assert.equal(result.splitDomCount, 16);
    assert.equal(result.splitAnchorFeed, 'SCADA_OVERVIEW');
    assert.equal(result.splitEventFired, true);
    assert.equal(result.restoredMergedDomCount, 13);
    assert.ok(result.configurationErrors >= 3);
    assert.match(result.malformedStatus, /not valid JSON/);
    assert.equal(result.feedsBeforeMalformed, 4);
    assert.equal(result.readOnly.feedCount, 4);
    assert.equal(result.readOnly.appClass, true);
    assert.equal(result.readOnly.configDisabled, true);
    assert.equal(result.readOnly.feedDisabled, true);
    assert.equal(result.readOnly.clearDisabled, true);
    assert.deepEqual(
        result.declaredMethods,
        Object.keys(manifest.control.contracts.api.methods).sort()
    );
    assert.deepEqual(
        result.declaredProperties,
        Object.keys(manifest.control.contracts.api.properties).sort()
    );

    await devTools.command('Emulation.setDeviceMetricsOverride', {
        width: 360,
        height: 280,
        deviceScaleFactor: 1,
        mobile: false
    });
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    const responsiveEvaluation = await devTools.command('Runtime.evaluate', {
        expression: `({
            viewport: { width: window.innerWidth, height: window.innerHeight },
            actionRects: Array.from(document.querySelectorAll('.actions .button')).map(button => {
                const rect = button.getBoundingClientRect();
                return {
                    id: button.id,
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom
                };
            }),
            spanRects: Array.from(document.querySelectorAll('.span-toolbar input, .span-toolbar button')).map(control => {
                const rect = control.getBoundingClientRect();
                return {
                    id: control.id,
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom
                };
            })
        })`,
        returnByValue: true
    });
    const responsive = responsiveEvaluation.result.value;
    assert.equal(responsive.actionRects.length, 4);
    assert.equal(responsive.spanRects.length, 4);
    responsive.actionRects.concat(responsive.spanRects).forEach(rect => {
        assert.ok(rect.left >= 0, rect.id + ' extends past the left edge.');
        assert.ok(rect.right <= responsive.viewport.width, rect.id + ' extends past the right edge.');
        assert.ok(rect.top >= 0, rect.id + ' extends past the top edge.');
        assert.ok(rect.bottom <= responsive.viewport.height, rect.id + ' extends past the bottom edge.');
    });

    console.log(JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ minimumSize: responsive }, null, 2));
    console.log('Datapath headless mock smoke test passed.');
} finally {
    if (devTools) devTools.close();
    if (chrome.exitCode === null) {
        const chromeExited = new Promise(resolvePromise => {
            chrome.once('exit', resolvePromise);
        });
        chrome.kill();
        await chromeExited;
    }
    await closeServer(server);
    rmSync(profileDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
    });
}
