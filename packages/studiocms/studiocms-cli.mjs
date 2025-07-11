#!/usr/bin/env node

const currentVersion = process.versions.node;
const requiredMajorVersion = Number.parseInt(currentVersion.split('.')[0], 10);
const minimumMajorVersion = 20;

if (requiredMajorVersion < minimumMajorVersion) {
	console.error(`Node.js v${currentVersion} is out of date and unsupported!`);
	console.error(`Please use Node.js v${minimumMajorVersion} or higher.`);
	process.exit(1);
}

import('./dist/cli/index.js').then((mod) => mod);
