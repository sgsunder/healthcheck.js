#!/usr/bin/env node
// Copyright (c) 2018 Shyam Sunder
'use strict';
const os = require('os');
const exec = require('child_process').exec;
const prettyms = require('pretty-ms');

// -----------------------------------------------------------------------------
// DEFINE CORE FUNCTIONS
async function runProcess(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(stderr.trim());
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

async function listOfDrives() {
    let lsblk = JSON.parse(await runProcess('lsblk -J'));
    let tmpDriveList = [];
    for (let i = 0; i < lsblk.blockdevices.length; i++) {
        tmpDriveList.push('/dev/' + lsblk.blockdevices[i].name);
    }
    return tmpDriveList;
}

// -----------------------------------------------------------------------------
// DEFINE GATHERING FUNCTIONS
async function gatherUptime() {
    return prettyms(os.uptime()*1000, {verbose: true});
}

async function gatherOs() {
    let raw = await runProcess('source /etc/os-release ; echo $PRETTY_NAME');
    return raw.trim();
}

async function gatherLoad() {
    let loads = await os.loadavg();
    return {
        load1: parseInt(loads[0] * 100) / 100,
        load5: parseInt(loads[1] * 100) / 100,
        load15: parseInt(loads[2] * 100) / 100
    }
}

async function gatherRam() {
    let raw = await runProcess('free');
    let numbers = raw
        .split(os.EOL)[1]
        .split(':')[1]
        .split(' ')
        .filter(String)
        .map(x => parseInt(x));
    return parseInt(100 * numbers[1] / numbers[0]);
}

async function gatherZfsHealth() {
    let raw = await runProcess('zpool status -x');
    return raw === 'all pools are healthy';
}

async function gatherZfsSpace() {
    let raw = await runProcess('zfs list -Hp');
    let zfsSizes = raw.split(os.EOL)[0].split('\t');
    let usedBytes = parseInt(zfsSizes[1]);
    let availBytes = parseInt(zfsSizes[2]);
    return parseInt(100 * usedBytes / (usedBytes + availBytes));
}

async function gatherDriveTemps(drives) {
    let statuses = await Promise.all(
        drives.map(drive => runProcess('smartctl -A ' + drive))
    );
    let temps = statuses
        .map(raw => raw.split('\n'))
        .map(lines => lines.filter(line => /^ *194/.test(line)).shift())
        .filter(x => !!x)
        .map(line => line.split(' ').filter(x => !!x).pop())
        .map(data => parseInt(data));
    return {
        max: Math.max(...temps),
        avg: parseInt( temps.reduce((a,b) => a+b) / temps.length )
    }
}

async function gatherDriveStatus(drives) {
    let statuses = await Promise.all(
        drives.map(drive => runProcess('smartctl -H ' + drive))
    );
    return statuses.every(raw =>
        raw.includes('SMART overall-health self-assessment test result: PASSED'));
}

async function gatherDriveAll() {
    const drives = await listOfDrives();
    let arr = await Promise.all([
        gatherDriveTemps(drives),
        gatherDriveStatus(drives)
    ]);
    return {
        temp: arr[0],
        healthy: arr[1]
    }
}

async function gatherDockerFailed(drives) {
    let proc_failed = runProcess('docker ps -a '
        + '--filter "status=exited" '
        + '--filter "status=dead" '
        + '--format "{{.Names}}"');
    let proc_unhealthy = runProcess('docker ps -a '
        + '--filter "health=unhealthy" '
        + '--format "{{.Names}}"');
    let raw = await Promise.all([proc_failed, proc_unhealthy]);
    let ret = [];
    for (let item of raw.join(os.EOL).split(os.EOL).filter(str => str != '')) {
        if (!ret.includes(item)) ret.push(item);
    }
    return ret.sort();
}

// -----------------------------------------------------------------------------
// RUNNER FUNCTIONS
async function getAll() {
    let arr = await Promise.all([
        gatherUptime(),       // 0
        gatherOs(),           // 1
        gatherLoad(),         // 2
        gatherRam(),          // 3
        gatherZfsHealth(),    // 4
        gatherZfsSpace(),     // 5
        gatherDriveAll(),     // 6
        gatherDockerFailed(), // 7
    ]);

    return {
        uptime: arr[0],
        os: arr[1],
        load: arr[2],
        ram: arr[3],
        zfs: {
            healthy: arr[4],
            percent: arr[5]
        },
        drives: arr[6],
        docker: {
            failed: arr[7]
        }
    }
}

async function daemonize(s) {
    if (!s) {
        console.warn('Missing daemon socket parameter');
        helpMessage();
        process.exitCode = 2;
        return;
    }

    const fs = require('fs');
    const app = require('express')();

    app.get('/', async (req, res) => {
        try {
            res.send(await getAll());
        } catch (err) {
            res.status(500);
            res.send({ error: err });
            console.warn('> error occured, sending HTTP 500 response');
            console.warn(err);
        }
    });

    if (fs.existsSync(s)) {
        fs.unlinkSync(s);
    }

    const server = app.listen(s, () => {
        fs.chmodSync(s, 0o777);
        console.log('> started on', new Date());
        console.log('> listening on socket:', fs.realpathSync(s));
    });
}

async function printAsJson() {
    try {
        console.log(JSON.stringify(await getAll(), null, '\t'))
    } catch (err) {
        console.warn(err);
        process.exitCode = 1;
    }
}

async function printWithFormat() {
    // TODO: Properly Implement This
    printAsJson(); // placeholder
}

function helpMessage() {
    console.log('Usage:'
     + os.EOL + '  -d/--daemonize <socket>  Listen on specified Unix socket'
     + os.EOL + '  -j/--json                Print out current health as JSON and exit'
     + os.EOL + '  -h/--help                Print this help message'
     + os.EOL + '  <no option>              Pretty print current health and exit');
}

// -----------------------------------------------------------------------------
if (process.argv.length === 2) { // No arguments passed
    printWithFormat();
} else if (process.argv.includes('-d')) {
    let daemonSocket = process.argv[process.argv.indexOf('-d')+1];
    daemonize(daemonSocket);
} else if (process.argv.includes('--daemonize')) {
    let daemonSocket = process.argv[process.argv.indexOf('--daemonize')+1];
    daemonize(daemonSocket);
} else if (process.argv.includes('-j') || process.argv.includes('--json')) {
    printAsJson();
} else if (process.argv.includes('-h') || process.argv.includes('--help')) {
    helpMessage();
} else { // Catch unknown options
    console.warn('Unknown option: ' + process.argv[2]);
    helpMessage();
    process.exitCode = 2;
}
