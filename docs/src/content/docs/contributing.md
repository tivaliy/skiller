---
title: Contributing & development
description: Build, test, and contribute to Skiller.
sidebar:
  order: 1
---

Skiller is an open-source VS Code extension on
[GitHub](https://github.com/tivaliy/skiller). Issues and pull requests are welcome. This page
covers how to build it locally, run the tests, and open a clean PR.

## Set up

Clone the repo and install dependencies:

```bash
git clone https://github.com/tivaliy/skiller.git
cd skiller
npm install
```

## Build

Skiller compiles with esbuild. Use `compile` for a one-off dev build, or `watch` to rebuild on
every change while you work:

```bash
npm run compile      # one-off dev build (esbuild)
npm run watch        # rebuild on change
```

## Run the extension

Press <kbd>F5</kbd> in VS Code to launch an **Extension Development Host** — a second VS Code window
with your local build of Skiller loaded. Open the Chat view there and talk to `@skiller` to try your
changes against real skills. The built-in example skills (`greeter`, `mind-reader`) are available
immediately; drop your own under `.skiller/skills/` in the host's workspace to iterate.

## Type-check

Two type-check scripts: one for the extension source, one that also includes the tests.

```bash
npm run typecheck       # tsc --noEmit (src)
npm run typecheck:test  # tsc --noEmit (src + tests)
```

## Test

Unit tests run on [Vitest](https://vitest.dev/):

```bash
npm run test        # run the suite once
npm run test:watch  # re-run on change
npm run test:ui     # Vitest UI
```

## Package

Build a `.vsix` you can install locally or attach to a release:

```bash
npm run package     # build a .vsix
```

Install the result into your main VS Code with `code --install-extension skiller-*.vsix`, or run
`npm run install-local` to package and install in one step.

## Opening a pull request

Before you open a PR:

1. Run `npm run typecheck:test` and `npm run test` — both must pass.
2. Keep changes focused and add tests for new behavior.
3. Follow the existing code style and patterns.

## License

Skiller is licensed under the [MIT License](https://github.com/tivaliy/skiller/blob/main/LICENSE).
