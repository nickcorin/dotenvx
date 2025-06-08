/* istanbul ignore file */
const fsx = require("./../helpers/fsx");
const path = require("path");
const ignore = require("ignore");

const Ls = require("../services/ls");

const isFullyEncrypted = require("./../helpers/isFullyEncrypted");
const packageJson = require("./../helpers/packageJson");
const InstallPrecommitHook = require("./../helpers/installPrecommitHook");
const childProcess = require("child_process");
const MISSING_GITIGNORE = ".env.keys"; // by default only ignore .env.keys. all other .env* files COULD be included - as long as they are encrypted

class Precommit {
  constructor(directory = "./", options = {}) {
    // args
    this.directory = directory;
    // options
    this.install = options.install;
    this.excludeEnvFile = [
      "test/**",
      "tests/**",
      "spec/**",
      "specs/**",
      "pytest/**",
      "test_suite/**",
    ];
  }

  run() {
    if (this.install) {
      const { successMessage } = this._installPrecommitHook();
      return { successMessage, warnings: [] };
    }

    let count = 0;
    const warnings = [];
    let gitignore = MISSING_GITIGNORE;

    // 1. Check for .gitignore file.
    if (!fsx.existsSync(".gitignore")) {
      const warning = new Error(
        `[dotenvx@${packageJson.version}][precommit] .gitignore missing`,
      );
      warnings.push(warning);
    } else {
      gitignore = fsx.readFileX(".gitignore");
    }

    const ig = ignore().add(gitignore);
    let files = this._getDirectoryFiles();

    // Pre-filter the files if we're in a git repo.
    if (this._isInGitRepo()) {
      const committedFiles = this._getCommittedFiles();
      files = files.filter((file) => {
        return committedFiles.includes(file);
      });
    }

    files.forEach((_file) => {
      count += 1;
      const file = path.join(this.directory, _file);

      // 2. check .env* files against .gitignore file
      if (ig.ignores(file)) {
        if (file === ".env.example" || file === ".env.vault") {
          const warning = new Error(
            `[dotenvx@${packageJson.version}][precommit] ${file} (currently ignored but should not be)`,
          );
          warning.help = `[dotenvx@${packageJson.version}][precommit] ⮕  run [dotenvx ext gitignore --pattern !${file}]`;
          warnings.push(warning);
        }
        return;
      }

      if (file === ".env.example" || file === ".env.vault") {
        return;
      }

      const src = fsx.readFileX(file);
      const encrypted = isFullyEncrypted(src);

      if (encrypted) {
        // if contents are encrypted, skip it
        return;
      }

      let errorMsg = `[dotenvx@${packageJson.version}][precommit] ${file} not protected (encrypted or gitignored)`;
      let errorHelp = `[dotenvx@${packageJson.version}][precommit] ⮕  run [dotenvx encrypt -f ${file}] or [dotenvx ext gitignore --pattern ${file}]`;
      if (file.includes(".env.keys")) {
        errorMsg = `[dotenvx@${packageJson.version}][precommit] ${file} not protected (gitignored)`;
        errorHelp = `[dotenvx@${packageJson.version}][precommit] ⮕  run [dotenvx ext gitignore --pattern ${file}]`;
      }

      const error = new Error(errorMsg);
      error.help = errorHelp;
      throw error;
    });

    let successMessage = `[dotenvx@${packageJson.version}][precommit] .env files (${count}) protected (encrypted or gitignored)`;
    if (count === 0) {
      successMessage = `[dotenvx@${packageJson.version}][precommit] zero .env files`;
    }
    if (warnings.length > 0) {
      successMessage += ` with warnings (${warnings.length})`;
    }
    return {
      successMessage,
      warnings,
    };
  }

  _getCommittedFiles() {
    try {
      const dry_commit = childProcess
        .execSync("git commit -a --dry-run --porcelain")
        .toString();
      return dry_commit
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          switch (parts.length) {
            case 2:
              // 'A' status (added).
              // 'D' status (deleted).
              // 'M' status (modified).
              // 'R' status (renamed).
              // Format: `XY <file_path>`.
              return parts[1];
            case 3:
              // 'C' status (copied).
              // 'R' status (renamed).
              // Format: `XY <file_path> -> <new_file_path>`.
              return parts[3];
            default:
              throw new Error(
                `Unexpected format in git commit porcelain output: ${line}`,
              );
          }
        });
    } catch (err) {
      // Use all directory files as a fallback.
      return this._getDirectoryFiles(this.directory);
    }
  }

  _getDirectoryFiles(dir = this.directory) {
    const lsService = new Ls(dir, undefined, this.excludeEnvFile);
    return lsService.run();
  }

  _installPrecommitHook() {
    return new InstallPrecommitHook().run();
  }

  _isInGitRepo() {
    try {
      childProcess.execSync("git rev-parse --is-inside-work-tree", {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = Precommit;
