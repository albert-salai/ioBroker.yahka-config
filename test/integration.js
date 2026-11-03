const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
// the adapter stops itself with ADAPTER_REQUESTED_TERMINATION (11) until its next scheduled run
tests.integration(path.join(__dirname, '..'), { allowedExitCodes: [11] });
