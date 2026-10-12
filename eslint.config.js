// The machine-checked half of the build rules (CLAUDE.md enforcement map). `tests/enforcement.test.ts` lints a
// deliberate violation of each ban, so a rule that stops firing fails the build.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const AUDIO = 'Zero audio (hard rule 2): the game must never take the iOS audio session.';
const PURE = 'The engine is pure and deterministic: no clock, random, locale, DOM or platform APIs.';
const MATH = 'Engine arithmetic is limited to sqrt, floor, ceil, trunc, min, max, abs and imul (GDD 6.3).';
const LITERAL = 'Engine formulas hold no number literal but 0, 1, 2 and 100; the rest come from data/balance.json.';

const MEDIA_GLOBALS = [
  'Audio',
  'AudioContext',
  'webkitAudioContext',
  'OfflineAudioContext',
  'AudioWorkletNode',
  'HTMLAudioElement',
  'HTMLVideoElement',
  'HTMLMediaElement',
  'MediaSource',
  'MediaRecorder',
  'MediaStream',
  'SpeechSynthesisUtterance',
  'speechSynthesis',
];

const mediaGlobals = MEDIA_GLOBALS.map((name) => ({ name, message: AUDIO }));

const mediaProperties = [
  ...['window', 'globalThis', 'self'].flatMap((object) =>
    MEDIA_GLOBALS.map((property) => ({ object, property, message: AUDIO })),
  ),
  { object: 'navigator', property: 'mediaDevices', message: AUDIO },
  { object: 'navigator', property: 'mediaSession', message: AUDIO },
];

// The bare tag name is banned as text wherever it appears, so it cannot reach createElement through a helper
// such as `el('audio')`, a template literal or a variable. Markup that contains the tag is banned too.
const mediaSyntax = [
  { selector: ':not(TSLiteralType) > Literal[value=/^\\s*(audio|video)\\s*$/i]', message: AUDIO },
  { selector: 'TemplateElement[value.raw=/^\\s*(audio|video)\\s*$/i]', message: AUDIO },
  { selector: 'Literal[value=/<\\s*(audio|video)[\\s>\\/]/i]', message: AUDIO },
  { selector: 'TemplateElement[value.raw=/<\\s*(audio|video)[\\s>\\/]/i]', message: AUDIO },
];

const namedExportsOnly = { selector: 'ExportDefaultDeclaration', message: 'Named exports only.' };

// A dynamic import() takes any path at run time, so no import rule can see where it leads.
const staticImportsOnly = { selector: 'ImportExpression', message: 'Static imports only: a dynamic import() cannot be checked against the module boundaries.' };

const commonSyntax = [...mediaSyntax, namedExportsOnly, staticImportsOnly];

const engineGlobals = [
  'Date',
  'performance',
  'Intl',
  'crypto',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'process',
].map((name) => ({ name, message: PURE }));

const engineSyntax = [
  ...commonSyntax,
  {
    selector: "MemberExpression[object.name='Math']:not([property.name=/^(sqrt|floor|ceil|trunc|min|max|abs|imul)$/])",
    message: MATH,
  },
  { selector: "MemberExpression[object.name='Math'][computed=true]", message: MATH },
  { selector: ":not(MemberExpression) > Identifier[name='Math']", message: MATH },
  { selector: "BinaryExpression[operator='**']", message: MATH },
  { selector: "AssignmentExpression[operator='**=']", message: MATH },
  {
    selector: 'MemberExpression[property.name=/^(toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleUpperCase|toLocaleLowerCase|localeCompare)$/]',
    message: PURE,
  },
  { selector: "MemberExpression[object.name='globalThis']", message: PURE },
];

const engineLiteral = {
  selector: 'Literal[raw=/^[0-9.]/]:not([value=0]):not([value=1]):not([value=2]):not([value=100])',
  message: LITERAL,
};

// Module boundaries (ARCHITECTURE section 2). Each regex is tested against the import's source text.
const folder = (names) => `(^|/)(${names.join('|')})(/|$)`;
const imports = (...patterns) => ['error', { patterns: patterns.map(([regex, message]) => ({ regex, message })) }];

const BOUNDARY = 'This import crosses a module boundary (ARCHITECTURE section 2).';
const ENGINE_ONLY = 'The engine imports nothing outside src/engine/: no data file, no other module (ARCHITECTURE section 2).';
const ENGINE_PACKAGES = 'The engine imports nothing outside itself, and no npm package.';
const ENGINE_TEST_PACKAGES = 'An engine test may import Vitest and nothing else from outside the engine.';

// The engine may not climb out of its own folder, whatever lies outside: data/, tests/, another module.
// Depth 0 is a file directly in src/engine/, which may not go up at all. Depth 1 is a file one folder down,
// such as math/, which may go up once. A path that goes up again after going down is refused at any depth.
const engineImports = (depth, test) =>
  imports(
    [test ? '^(?!\\.{1,2}/|vitest$)' : '^(?!\\.{1,2}/)', test ? ENGINE_TEST_PACKAGES : ENGINE_PACKAGES],
    [depth === 0 ? '^\\.\\./' : '^(\\.\\./){2,}', ENGINE_ONLY],
    ['^\\.{1,2}/.*\\.\\./', ENGINE_ONLY],
  );

export default tseslint.config(
  { ignores: ['dist/', 'dev-dist/', 'node_modules/', 'coverage/', 'reference/', 'public/', 'sim-out/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...mediaGlobals],
      'no-restricted-properties': ['error', ...mediaProperties],
      'no-restricted-syntax': ['error', ...commonSyntax],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The check scripts and their tests have to spell out the markup they look for. Nothing here ships; the
    // media globals stay banned, and `check:dist` scans the real build.
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', namedExportsOnly] },
  },
  {
    // The service worker's test loads the worker into a stand-in scope, which needs a dynamic import.
    files: ['src/platform/sw.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...mediaSyntax, namedExportsOnly] },
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...mediaGlobals, ...engineGlobals],
      'no-restricted-syntax': ['error', ...engineSyntax, engineLiteral],
      'no-restricted-imports': engineImports(0, false),
    },
  },
  {
    files: ['src/engine/*/**/*.ts'],
    rules: { 'no-restricted-imports': engineImports(1, false) },
  },
  {
    // The three places whose constants are structure, not balance (ARCHITECTURE 5.5).
    files: ['src/engine/math/**/*.ts', 'src/engine/rng.ts', 'src/engine/hash.ts'],
    rules: { 'no-restricted-syntax': ['error', ...engineSyntax] },
  },
  {
    // Engine tests, and the made-up world they share, may import Vitest and use any number; every purity ban
    // still applies to them.
    files: ['src/engine/**/*.test.ts', 'src/engine/**/*.fixture.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...engineSyntax],
      'no-restricted-imports': engineImports(0, true),
    },
  },
  {
    files: ['src/engine/*/**/*.test.ts', 'src/engine/*/**/*.fixture.ts'],
    rules: { 'no-restricted-imports': engineImports(1, true) },
  },
  {
    files: ['src/content/**/*.ts'],
    rules: { 'no-restricted-imports': imports([folder(['ui', 'save', 'platform', 'sim']), BOUNDARY]) },
  },
  {
    files: ['src/save/**/*.ts'],
    rules: { 'no-restricted-imports': imports([folder(['ui', 'sim', 'platform', 'content']), BOUNDARY]) },
  },
  {
    files: ['src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': imports(
        [folder(['engine', 'ui', 'sim', 'content']), BOUNDARY],
        ['(^|/)save(/(?!(db|constants)$).*)?$', 'The platform uses the save module for its database handle and store names only.'],
      ),
    },
  },
  {
    files: ['src/ui/**/*.ts', 'src/main.ts'],
    rules: { 'no-restricted-imports': imports([folder(['sim']), BOUNDARY]) },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: { 'no-restricted-imports': imports([folder(['ui', 'save', 'platform']), BOUNDARY]) },
  },
);
