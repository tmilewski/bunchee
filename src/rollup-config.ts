
import type { JsMinifyOptions } from "@swc/core"
import type { PackageMetadata, BuncheeRollupConfig, CliArgs, BundleOptions } from "./types";

import fs from "fs";
import { resolve, extname, dirname, basename } from "path";
import { swc } from 'rollup-plugin-swc3';
import commonjs from "@rollup/plugin-commonjs";
import shebang from "rollup-plugin-preserve-shebang";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import { InputOptions, OutputOptions, Plugin } from "rollup";
import config from "./config";
import { logger } from "./utils"

const { Module } = require("module");
const minifyOptions: JsMinifyOptions = {
  compress: {
    unused: true,
  },
  format: {
    comments: 'some',
    wrapFuncArgs: false,
    preserveAnnotations: true,
  },
  mangle: true
}

let hasLoggedTsWarning = false
function resolveTypescript() {
  let ts;
  const m = new Module("", null);
  m.paths = Module._nodeModulePaths(config.rootDir)
  try {
    ts = m.require("typescript");
  } catch (_) {
    if (!hasLoggedTsWarning) {
      hasLoggedTsWarning = true
      logger.warn("Could not load TypeScript compiler. Try `yarn add --dev typescript`")
    }
  }
  return ts;
}

function getDistPath(distPath: string) {
  return resolve(config.rootDir, distPath);
}

function createInputConfig(
  entry: string,
  pkg: PackageMetadata,
  options: BundleOptions,
): InputOptions {
  const externals = [pkg.peerDependencies, pkg.dependencies]
    .filter(<T>(n?: T): n is T => Boolean(n))
    .map((o: { [key: string]: string }): string[] => Object.keys(o))
    .reduce((a: string[], b: string[]) => a.concat(b), [] as string[]);

  const {useTypescript, target, minify = false} = options;
  // const typings: string | undefined = pkg.types || pkg.typings
  // const cwd: string = config.rootDir

  const plugins: (Plugin)[] = [
    nodeResolve({
      preferBuiltins: target === "node",
      extensions: [".mjs", ".js", ".json", ".node", ".jsx"],
    }),
    commonjs({
      include: /node_modules\//,
    }),
    json(),
    shebang(),
    swc({
      // All options are optional
      include: /\.(m|c)?[jt]sx?$/,
      exclude: 'node_modules',
      tsconfig: 'tsconfig.json',
      // And add your swc configuration here!
      // "filename" will be ignored since it is handled by rollup
      jsc: {
        externalHelpers: false,
        parser: {
          syntax: useTypescript ? 'typescript' : 'ecmascript',
          [useTypescript ? 'tsx': 'jsx']: true,
          privateMethod: true,
          classPrivateProperty: true,
          exportDefaultFrom: true,
        },
        ...(minify && { minify: minifyOptions })
      },
      sourceMaps: options.sourcemap,
      inlineSourcesContent: false,

    }),
  ].filter((n: (Plugin | false)): n is Plugin => Boolean(n));

  return {
    input: entry,
    external(id: string) {
      return externals.some(name => id === name || id.startsWith(name + "/"))
    },
    plugins,
    treeshake: {
      propertyReadSideEffects: false,
    },
    onwarn (warning, warn) {
      if (
        warning.code &&
        ['MIXED_EXPORTS', 'PREFER_NAMED_EXPORTS'].includes(warning.code)
      ) return;
      warn(warning);
    },
  };
}

function createOutputOptions(
  options: BundleOptions,
  pkg: PackageMetadata
): OutputOptions {
  const {format, useTypescript} = options;
  let tsCompilerOptions = {} as any;

  if (useTypescript) {
    const ts = resolveTypescript();
    const tsconfigPath = resolve(config.rootDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      const tsconfigJSON = ts.readConfigFile(tsconfigPath, ts.sys.readFile).config;
      tsCompilerOptions = ts.parseJsonConfigFileContent(
        tsconfigJSON,
        ts.sys,
        "./",
      ).options;
    }
  }

  const exportPaths = getExportPaths(pkg);

  // respect if tsconfig.json has `esModuleInterop` config;
  // add esmodule mark if cjs and esmodule are both generated;

  const useEsModuleMark = Boolean(tsCompilerOptions.esModuleInterop ||
    (
      exportPaths.main &&
      exportPaths.module
    )
  );

  const file = resolve(options.file as string)
  return {
    name: pkg.name,
    dir: dirname(file),
    entryFileNames: basename(file),
    format,
    exports: "named",
    esModule: useEsModuleMark && format !== "umd",
    freeze: false,
    strict: false,
    sourcemap: options.sourcemap,
  };
}

function findExport(field: any): string | null {
  if (!field) return null;
  if (typeof field === "string") return field;
  const value = field["."] || field["import"] || field["module"] || field["default"];
  return findExport(value);
}

function getExportPaths(pkg: PackageMetadata) {
  const paths: Record<'main' | 'module' | 'export', string | null> = {
    main: null,
    module: null,
    export: null,
  };
  if (pkg.main) {
    paths.main = pkg.main;
  }
  if (pkg.module) {
    paths.module = pkg.module;
  }
  if (pkg.exports) {
    if (typeof pkg.exports === "string") {
      paths.export = pkg.exports;
    } else {
      paths.main = paths.main || pkg.exports["require"] || pkg.exports["node"] || pkg.exports["default"];
      paths.module = paths.module || pkg.exports["module"];
      paths.export = findExport(pkg.exports);
    }
  }
  return paths;
}

function getExportDist(pkg: PackageMetadata) {
  const paths = getExportPaths(pkg);
  const dist: Array<{format: "cjs" | "esm", file: string}> = []
  if (paths.main) {
    dist.push({format: "cjs", file: getDistPath(paths.main)})
  }
  if (paths.module) {
    dist.push({format: "esm", file: getDistPath(paths.module)})
  }
  if (paths.export) {
    dist.push({format: "esm", file: getDistPath(paths.export)})
  }

  // default fallback to output `dist/index.js` in cjs format
  if (dist.length === 0) {
    dist.push({format: "cjs", file: getDistPath("dist/index.js")})
  }
  return dist
}

function createRollupConfig(
  entry: string,
  pkg: PackageMetadata,
  cliArgs: CliArgs,
): BuncheeRollupConfig {
  const { file, format } = cliArgs;
  const ext = extname(entry);
  const useTypescript: boolean = ext === ".ts" || ext === ".tsx";
  const options = {...cliArgs, useTypescript};
  const inputOptions = createInputConfig(entry, pkg, options);
  let outputConfigs = getExportDist(pkg)
    .map((exportDist) => {
      return createOutputOptions(
        {
          ...cliArgs,
          file: exportDist.file,
          format: exportDist.format,
          useTypescript,
        },
        pkg
      );
    });

  // CLI output option is always prioritized
  if (file) {
    outputConfigs = [
      createOutputOptions(
        {
          ...cliArgs,
          file,
          format,
          useTypescript,
        },
        pkg
      )
    ];
  }

  return {
    input: inputOptions,
    output: outputConfigs,
  };
}

export default createRollupConfig;
