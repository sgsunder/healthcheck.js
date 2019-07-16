Healthcheck.js
====

A simple Node.js-based health checking API

Can either run as a oneshot, which will print a JSON formatted string to
`stdout` detailing basic system info, or as a daemon, which looks for HTTP GET
requests on `/`.

The daemon can be started with `-d <unix socket path>`, which creates a Unix
socket and binds a listener to it.

### Required System Calls

The script will call the following binaries from the `PATH`:
- `lsblk -J`: To determine what drives are available
- `uptime -p`: To determine system uptime in a prettyprint format
- `lsb_release -d`: For system information
- `free`: For system memory information

For ZFS pool status, it will also call:
- `zpool status -x`
- `zfs list -Hp`

For drive status, it will call:
- `hddtemp -n ${DRIVE}`: To get drive temperatures
- `smartctl -H ${DRIVE}`: To get drive health

For docker status, it will call `docker ps -a` twice.
