#!/usr/bin/env node
// above - tells os to run this file with node.js (shebang)
// /bin/env - find node in this path

const {spawn} = require("child_process"); // to create new node processes
const path = require("path"); // to concatenate file paths
const fs = require("fs"); // to check whether a flie exits

// check if build files exits
const distPath = path.join(__dirname, "../dist/index.js");
if(!fs.existsSync(distPath)){
    console.error('ERROR: build not found, please run "npm run build" first.');
    process.exit(1);
}

// run the compiled cli
const cli = spawn('node',[distPath, ...process.argv.slice(2)], { // process.argv -> contains the user command via cli (eg: db-backup backup mysql), it slices last two arguments, so result is (node dist/index.js backup mysql), backup and mysql are the arguments passed to compiled code 
    stdio: 'inherit', // Shares terminal input/output.
});

cli.on('close', (code) => {
    process.exit(code);
})

cli.on('error', (err) => {
    console.log("Failed to start CLI:", err);
    process.exit(1);
})