import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import pkg from './package.json' with { type: 'json' };

const external = Object.keys(pkg.dependencies || {});

export default [
  // 1. ESM & CommonJS Build (dependencies external)
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.esm.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
    ],
    external,
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: './dist/types',
      }),
    ],
  },
  // 2. IIFE Build (all dependencies bundled)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.iife.js',
      format: 'iife',
      name: 'EditorXLogStream',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      json(),
      resolve({
        browser: true,
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
      terser(),
    ],
  },
];
