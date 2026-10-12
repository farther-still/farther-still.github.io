// Proof that each ban in the enforcement map fires. Every case lints or compiles a deliberate violation; if a
// rule is ever loosened or mistyped in eslint.config.js or the engine's tsconfig, a case here fails.

import { join } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

const lint = async (file: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).map((message) => `${message.ruleId ?? 'parse'}: ${message.message}`);
};

const banned = async (file: string, code: string, word: string): Promise<void> => {
  const messages = await lint(file, code);
  expect(messages.some((message) => message.includes(word)), `${file}: ${code}\n  got: ${messages.join(' | ') || 'no messages'}`).toBe(true);
};

const allowed = async (file: string, code: string): Promise<void> => {
  expect(await lint(file, code), `${file}: ${code}`).toEqual([]);
};

describe('lint: zero audio, everywhere (hard rule 2)', () => {
  const cases = [
    'export const a = new Audio("x.mp3");',
    'export const a = new AudioContext();',
    'export const a = new webkitAudioContext();',
    'export const a = window.Audio;',
    'export const a = globalThis.AudioContext;',
    'export const a = document.createElement("audio");',
    'export const a = document.createElement("video");',
    'export const a = navigator.mediaSession;',
    'export const a = navigator.mediaDevices;',
    'export const a = "<audio src=x>";',
    'export const a = `<video autoplay>`;',
    'export const a = (x: unknown): boolean => x instanceof HTMLMediaElement;',
    'export const a = speechSynthesis;',
    // The forms the first verifier pass slipped through: the tag name reaching the DOM by a helper, a template
    // literal or a variable.
    "import { el } from './dom';\nexport const a = el('audio');",
    "import { el } from './dom';\nexport const a = el('video', { class: 'x' });",
    'export const a = document.createElement(`audio`);',
    "const tag = 'video';\nexport const a = document.createElement(tag);",
    "export const a = document.createElementNS('http://www.w3.org/1999/xhtml', 'AUDIO');",
  ];
  it.each(cases)('bans %s', async (code) => {
    await banned('src/ui/probe.ts', code, 'Zero audio');
    await banned('src/platform/probe.ts', code, 'Zero audio');
    await banned('src/engine/probe.ts', code, 'Zero audio');
  });

  it('allows ordinary DOM code', async () => {
    await allowed('src/ui/probe.ts', 'export const a = document.createElement("div");\nexport const b = "audio is banned";\n');
  });

  it('allows a type that names the media tags in order to exclude them', async () => {
    await allowed('src/ui/probe.ts', "export type Tag = Exclude<keyof HTMLElementTagNameMap, 'audio' | 'video'>;\n");
  });
});

describe('lint: the engine is pure and deterministic', () => {
  const cases: Array<[string, string]> = [
    ['export const a = Date.now();', 'pure'],
    ['export const a = new Date();', 'pure'],
    ['export const a = performance.now();', 'pure'],
    ['export const a = Math.random();', 'arithmetic'],
    ['export const a = Math.pow(2, 2);', 'arithmetic'],
    ['export const a = Math.exp(1);', 'arithmetic'],
    ['export const a = Math.log(2);', 'arithmetic'],
    ['export const a = Math.log10(2);', 'arithmetic'],
    ['export const a = Math.sin(1);', 'arithmetic'],
    ['export const a = Math.round(1);', 'arithmetic'],
    ['export const a = Math["pow"](2, 2);', 'arithmetic'],
    ['const { pow } = Math;\nexport const a = pow(2, 2);', 'arithmetic'],
    ['export const a = 2 ** 2;', 'arithmetic'],
    ['export let a = 2;\na **= 2;', 'arithmetic'],
    ['export const a = (1).toLocaleString();', 'pure'],
    ['export const a = "a".localeCompare("b");', 'pure'],
    ['export const a = new Intl.NumberFormat();', 'pure'],
    ['export const a = document.title;', 'pure'],
    ['export const a = window.innerWidth;', 'pure'],
    ['export const a = crypto.getRandomValues(new Uint32Array(1));', 'pure'],
    ['export const a = globalThis.Date;', 'pure'],
    ['export const a = setTimeout(() => 0, 0);', 'pure'],
  ];
  it.each(cases)('bans %s', async (code, word) => {
    await banned('src/engine/probe.ts', code, word);
    // The purity bans hold in the exempt files and in engine tests too; only the literal rule is lifted there.
    await banned('src/engine/rng.ts', code, word);
    await banned('src/engine/probe.test.ts', code, word);
    await banned('src/engine/probe.fixture.ts', code, word);
  });

  it('allows the eight Math members on the allowlist', async () => {
    await allowed(
      'src/engine/probe.ts',
      'export const a = Math.sqrt(2) + Math.floor(1) + Math.ceil(1) + Math.trunc(1) + Math.min(1, 2) + Math.max(1, 2) + Math.abs(1) + Math.imul(1, 2);\n',
    );
  });

  it('does not apply the engine bans outside the engine', async () => {
    await allowed('src/ui/probe.ts', 'export const a = Date.now() + Math.round(1.5) + 7;\n');
  });
});

describe('lint: engine number literals', () => {
  it.each(['3', '10', '0.5', '1e3', '0x10', '99', '101', '-3', '7n'])('bans the literal %s in an engine formula', async (literal) => {
    await banned('src/engine/formulas.ts', `export const a = ${literal};`, 'number literal');
  });

  it('allows 0, 1, 2 and 100', async () => {
    await allowed('src/engine/formulas.ts', 'export const a = 0 + 1 + 2 + 100 - 1;\nexport const b = "3 is fine in text";\n');
  });

  it('exempts math/, rng.ts, hash.ts, tests and test fixtures, whose constants are structure or made-up data', async () => {
    for (const file of ['src/engine/math/log10.ts', 'src/engine/rng.ts', 'src/engine/hash.ts', 'src/engine/probe.test.ts', 'src/engine/probe.fixture.ts']) {
      await allowed(file, 'export const a = 0x9e3779b9 + 15;\n');
    }
  });
});

describe('lint: module boundaries (ARCHITECTURE section 2)', () => {
  const crossings: Array<[string, string]> = [
    ['src/engine/probe.ts', 'zod'],
    ['src/engine/probe.ts', 'idb'],
    ['src/engine/probe.ts', 'vitest'],
    ['src/engine/probe.ts', '../save'],
    ['src/engine/probe.ts', '../ui/dom'],
    ['src/engine/probe.ts', '../content'],
    ['src/engine/probe.ts', '../platform/update'],
    // Out of the engine folder by any route: a data file read without its schema, a test helper, a sibling file.
    ['src/engine/probe.ts', '../../data/balance.json'],
    ['src/engine/probe.ts', '../../tests/helpers'],
    ['src/engine/probe.ts', '../../scripts/lib'],
    ['src/engine/probe.ts', '../env.d'],
    ['src/engine/probe.ts', '../main'],
    ['src/engine/probe.ts', './math/../../save/db'],
    ['src/engine/math/probe.ts', '../../save/db'],
    ['src/engine/math/probe.ts', '../../../data/balance.json'],
    ['src/engine/math/probe.test.ts', '../../save/db'],
    ['src/platform/probe.ts', '../save/migrations/index'],
    ['src/platform/probe.ts', '../save/migrations'],
    ['src/engine/probe.test.ts', 'node:fs'],
    ['src/engine/probe.test.ts', '../save'],
    // A fixture is test support, held to a test's rules: it may not reach out of the engine either.
    ['src/engine/probe.fixture.ts', '../save'],
    ['src/engine/probe.fixture.ts', '../../data/balance.json'],
    ['src/engine/probe.fixture.ts', '../content'],
    ['src/content/probe.ts', '../ui/dom'],
    ['src/content/probe.ts', '../save'],
    ['src/content/probe.ts', '../platform'],
    ['src/save/probe.ts', '../ui/dom'],
    ['src/save/probe.ts', '../sim/run'],
    ['src/save/probe.ts', '../platform'],
    ['src/platform/probe.ts', '../engine'],
    ['src/platform/probe.ts', '../ui/dom'],
    ['src/platform/probe.ts', '../save'],
    ['src/platform/probe.ts', '../save/writer'],
    ['src/platform/probe.ts', '../save/index'],
    ['src/ui/probe.ts', '../sim/run'],
    ['src/main.ts', './sim/run'],
    ['src/sim/probe.ts', '../ui/dom'],
    ['src/sim/probe.ts', '../save'],
    ['src/sim/probe.ts', '../platform'],
  ];
  it.each(crossings)('%s may not import %s', async (file, source) => {
    await banned(file, `import { x } from '${source}';\nexport const a = x;\n`, 'no-restricted-imports');
  });

  const permitted: Array<[string, string]> = [
    ['src/engine/probe.ts', './rng'],
    ['src/engine/math/probe.ts', '../hash'],
    ['src/engine/math/probe.ts', './tables'],
    ['src/engine/probe.ts', './math/log10'],
    ['src/engine/probe.test.ts', 'vitest'],
    ['src/engine/probe.test.ts', './sample.fixture'],
    ['src/engine/probe.fixture.ts', './formulas'],
    ['src/engine/math/probe.test.ts', '../rng'],
    ['src/content/probe.ts', '../engine'],
    ['src/content/probe.ts', 'zod'],
    ['src/save/probe.ts', '../engine'],
    ['src/save/probe.ts', 'idb'],
    ['src/platform/probe.ts', '../save/db'],
    ['src/platform/probe.ts', '../save/constants'],
    ['src/ui/probe.ts', '../platform'],
    ['src/ui/probe.ts', '../save'],
    ['src/sim/probe.ts', '../engine'],
    ['src/sim/probe.ts', '../content'],
  ];
  it.each(permitted)('%s may import %s', async (file, source) => {
    await allowed(file, `import { x } from '${source}';\nexport const a = x;\n`);
  });

  it.each(['src/engine/probe.ts', 'src/ui/probe.ts', 'src/save/probe.ts', 'src/platform/probe.ts', 'src/content/probe.ts', 'src/main.ts'])(
    '%s may not use a dynamic import, which no boundary rule can follow',
    async (file) => {
      await banned(file, "export const a = (): Promise<unknown> => import('./anything');\n", 'Static imports only');
    },
  );
});

describe('lint: conventions', () => {
  it('bans any', async () => {
    await banned('src/ui/probe.ts', 'export const a = (x: any): number => x;', 'no-explicit-any');
  });

  it('bans default exports', async () => {
    await banned('src/ui/probe.ts', 'const a = 1;\nexport default a;', 'Named exports only');
  });
});

describe('typecheck: the engine project has no DOM', () => {
  const compile = (code: string): string[] => {
    const configPath = join(ROOT, 'src/engine/tsconfig.json');
    const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    if (config === undefined) throw new Error('engine tsconfig could not be read');
    // TypeScript names files with forward slashes, on Windows too.
    const slashed = (name: string): string => name.replaceAll('\\', '/');
    const probe = slashed(join(ROOT, 'src/engine/__probe__.ts'));
    const isProbe = (name: string): boolean => slashed(name) === probe;
    const host = ts.createCompilerHost(config.options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.readFile = (name) => (isProbe(name) ? code : readFile(name));
    host.fileExists = (name) => isProbe(name) || fileExists(name);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) =>
      isProbe(name) ? ts.createSourceFile(name, code, languageVersion, true) : getSourceFile(name, languageVersion, ...rest);
    const program = ts.createProgram({ rootNames: [...config.fileNames, probe], options: config.options, host });
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  };

  it('compiles the engine as it stands', () => {
    expect(compile('export const a: number = 1;\n')).toEqual([]);
  });

  it.each([
    'export const a = document.title;',
    'export const a = window.innerWidth;',
    'export const a: HTMLElement | null = null;',
    'export const a = localStorage.getItem("x");',
    'export const a = navigator.userAgent;',
    'export const a = indexedDB;',
    'export const a = new TextEncoder();',
    'export const a = setTimeout(() => 0, 0);',
    'export const a = process.env;',
  ])('rejects %s', (code) => {
    const errors = compile(`${code}\n`);
    // The failure must be the missing name itself, not an unrelated error that would hide a regression.
    expect(errors.some((error) => /Cannot find name|Cannot find namespace/.test(error)), errors.join(' | ')).toBe(true);
  });
});
