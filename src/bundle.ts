import type { RollupWatcher, RollupWatchOptions, OutputOptions, RollupBuild } from "rollup"
import type { BuncheeRollupConfig, CliArgs } from "./types";

import { resolve } from "path";
import { watch as rollupWatch, rollup } from "rollup";
import createRollupConfig from "./rollup-config";
import { getPackageMeta } from "./utils";
import config from "./config";

function assignDefault(options: CliArgs, name: keyof CliArgs, defaultValue: any) {
  if (!(name in options) || options[name] == null) {
    options[name] = defaultValue
  }
}

function bundle(
  entry: string,
  { cwd, ...options } : CliArgs = {}
): Promise<any> {
  config.rootDir = resolve(process.cwd(), cwd || "");
  assignDefault(options, "format", "es")
  assignDefault(options, "sourcemap", true)

  // alias for 'es' in rollup
  if (options.format === "esm") {
    options.format = "es"
  }

  const npmPackage = getPackageMeta();
  const rollupConfig = createRollupConfig(
    entry,
    npmPackage,
    options,
  );

  if (options.watch) {
    return Promise.resolve(runWatch(rollupConfig));
  }
  return runBundle(rollupConfig);
}

function runWatch({ input, output }: BuncheeRollupConfig): RollupWatcher {
  const watchOptions: RollupWatchOptions[] = [{
    ...input,
    output: output,
    watch: {
      exclude: ["node_modules/**"],
    },
  }];
  const watcher = rollupWatch(watchOptions);
  watcher.on('event', event => {
    if (event.code === 'ERROR') {
      onError(event.error)
    }
  });
  return watcher;
}

function runBundle({ input, output }: BuncheeRollupConfig) {
  return rollup(input).then(
    (bundle: RollupBuild) => {
      const writeJobs = output.map((options: OutputOptions) =>
        bundle.write(options)
      );
      return Promise.all(writeJobs);
    },
    onError
  );
}

function onError(error: any) {
  if (!error) return
  // logging source code in format
  if (error.frame) {
    process.stdout.write(error.frame + "\n");
  }
  if (error.stack) {
    process.stdout.write(error.stack + "\n");
  }
  throw error;
}

export default bundle;
