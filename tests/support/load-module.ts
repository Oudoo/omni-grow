import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

// Run the real server modules with only their framework/network boundaries replaced. This keeps
// cookie and concurrency regressions deterministic without booting Next or changing a database.
export function loadModule(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}): Record<string, any> {
  const code = ts.transpileModule(readFileSync(resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const exports = {};
  const context = {
    exports,
    require: (name: string) => {
      if (!(name in imports)) throw new Error(`Unexpected test dependency: ${name}`);
      return imports[name];
    },
    console, Buffer, Headers, Request, Response, URL, TextEncoder, TextDecoder, Uint8Array,
    AbortSignal, ReadableStream, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: {} },
    ...globals
  };
  // Keep ordinary objects in this realm: iron-session deliberately rejects non-plain values.
  compileFunction(code, Object.keys(context), { filename: path })(...Object.values(context));
  return exports;
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
