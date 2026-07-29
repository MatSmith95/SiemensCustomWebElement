# WinCC Unified Custom Web Control Developer Guide

This folder explains how the custom web controls in this repository are put
together and how to create another one. It is written for a programmer who is
comfortable with basic HTML, CSS, and JavaScript but has not built a Siemens
WinCC Unified Custom Web Control before.

The most important idea is:

> A Custom Web Control is a small browser application plus a manifest. The
> manifest describes the interface visible in TIA Portal, and `WebCC` carries
> property changes, method calls, and events between WinCC Unified and the
> browser application.

## Recommended reading order

1. [Repository tour](01-repository-tour.md) explains every file and points to
   the best examples in this repository.
2. [How the parts connect](02-how-the-parts-connect.md) follows a control from
   TIA Portal, through `WebCC`, to the DOM and back.
3. [Manifest and contract reference](03-manifest-and-contract.md) explains the
   public interface exposed to WinCC Unified.
4. [Build a new control](04-build-a-new-control.md) is a worked, step-by-step
   implementation tutorial.
5. [Local development and testing](05-local-development-and-testing.md)
   explains the supplied WebCC mock and the checks to run before packaging.
6. [Packaging and importing](06-packaging-and-importing.md) shows how to create
   and verify a GUID-named Siemens import ZIP.
7. [Engineering patterns and troubleshooting](07-patterns-and-troubleshooting.md)
   covers the mistakes that are easiest to make and the patterns used by the
   more advanced controls.

## Fast mental model

```text
TIA Portal engineering
        |
        | reads manifest.json when the ZIP is imported
        v
WinCC Unified Runtime / Custom Web Control container
        |
        | injects values and calls through webcc.min.js
        v
WebCC.Properties + methods registered by WebCC.start(...)
        |
        v
control/code.js updates the HTML/SVG/canvas and CSS
        |
        | writes properties or fires events
        v
WinCC Unified tags, screen scripts, and event handlers
```

The same property, method, and event names must agree in two places:

- `manifest.json`, which is the engineering-time declaration; and
- the contract object passed to `WebCC.start(...)`, which is the runtime
  declaration.

If those two contracts drift apart, a control can look correct in an ordinary
browser but fail to communicate correctly in Unified Runtime.

## What “build” means in this repository

The controls use plain HTML, CSS, and JavaScript. There is no npm install,
bundler, TypeScript compiler, or generated application bundle. Development is
therefore:

1. edit the source files;
2. preview them in a browser using `webcc.mock.js`;
3. syntax-check and test them;
4. put the declared files into a ZIP whose name matches the manifest GUID;
5. import that ZIP into TIA Portal; and
6. perform a final test in Unified Runtime or on the target panel.

The local browser mock is deliberately not a replacement for the final
Unified test. It cannot prove that TIA import, tag binding, the real container
handshake, panel performance, or Runtime permissions behave correctly.
