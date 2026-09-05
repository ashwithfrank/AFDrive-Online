"""
AFDrive Agent setup CLI.

A small, dependency-free-beyond-requests wizard for the parts of Agent
setup that don't belong inside the web routes: picking a storage
directory and pairing this device with AFDrive Online. Everything here
only touches local files and, for `pair`, one HTTPS call to the relay's
registration endpoint (see identity.py).

Usage:
    python setup_cli.py status          # show current local + online state
    python setup_cli.py pair <code>     # exchange a dashboard pairing code
                                         # for permanent device credentials
    python setup_cli.py unpair          # forget this device's online identity
                                         # (does NOT revoke it on the dashboard —
                                         #  do that from Online first if the
                                         #  device may still be reachable)
"""

import os
import sys

from config import Config
import identity


def cmd_status():
    print(f"Storage path:       {Config.STORAGE_PATH}")
    print(f"LAN bind address:   {Config.HOST}:{Config.PORT}")
    print(f"Online mode:        {'enabled' if Config.ONLINE_ENABLED else 'disabled'}")
    print(f"Relay URL:          {Config.RELAY_URL}")
    print(f"Public discoverable:{' yes' if Config.PUBLIC_DISCOVERABLE else ' no'}")

    ident = identity.load_identity()
    if ident:
        print(f"Device identity:    registered (device_id={ident['device_id']})")
    else:
        print("Device identity:    not yet registered")


def cmd_pair(code):
    try:
        device_id, _secret = identity.register_with_relay(code)
    except identity.RegistrationError as exc:
        print(f"Pairing failed: {exc}")
        sys.exit(1)
    print(f"Paired successfully. device_id = {device_id}")
    print("Set AFDRIVE_ONLINE_ENABLED=true and restart the Agent to go online.")


def cmd_unpair():
    if os.path.exists(Config.DEVICE_IDENTITY_PATH):
        os.remove(Config.DEVICE_IDENTITY_PATH)
        print("Local device identity removed.")
        print("If this device might still be reachable, also revoke it from "
              "the AFDrive Online dashboard so the old credential can't be reused.")
    else:
        print("This device was not registered.")


def main():
    args = sys.argv[1:]
    if not args or args[0] == "status":
        cmd_status()
    elif args[0] == "pair" and len(args) >= 2:
        cmd_pair(args[1])
    elif args[0] == "unpair":
        cmd_unpair()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
