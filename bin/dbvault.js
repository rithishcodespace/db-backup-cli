#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// check if build files exist
const distPath = path.join(__dirname, "../dist/src/index.js");
if (!fs.existsSync(distPath)) {
    console.error('ERROR: dbvault binary files not found. Please reinstall via: npm install -g dbvault');
    process.exit(1);
}

// run the compiled cli
process.env.DOTENV_CONFIG_QUIET = "true";
const cli = spawn(process.execPath, [distPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' },
});

cli.on('close', (code) => {
    process.exit(code ?? 0);
});

cli.on('error', (err) => {
    console.error("Failed to start CLI:", err);
    process.exit(1);
});
