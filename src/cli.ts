#!/usr/bin/env node

import fs from "fs";
import path from "path";
import program from "commander";
import config from "./config";
import pkg from "./pkg";
import bunchee from ".";

program
  .name("bunchee")
  .version(pkg.version, "-v, --version")
  .option("-w, --watch", "watch src files changes")
  .option("-o --output <file>", "specify output filename")
  .option("--format <format>", "specify output file format")
  .action(run);

program.parse(process.argv);

function run(entryFilePath: string) {
  const { format, output: file } = program;
  const outputConfig = {
    file,
    format,
    watch: !!program.watch,
  };
  if (typeof entryFilePath !== "string") {
    return help();
  }
  const entry = path.resolve(config.rootDir, entryFilePath);
  if (!fs.existsSync(entry)) {
    return help();
  }
  bunchee(entry, outputConfig)
    .catch(() => {
      process.exit(2);
    });
}

function help() {
  program.help();
}
