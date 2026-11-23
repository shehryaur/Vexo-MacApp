/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeTest from "node:test";
import { setRunForTests } from "../src/exec.ts";
import {
  bandScan,
  bandStatus,
  bleScanScript,
  matchesVexoBand,
  peripheralsFromProfiler,
  peripheralsFromScan,
  summarizeBand,
} from "../src/band.ts";

const CONNECTED = {
  SPBluetoothDataType: [
    {
      device_connected: [
        {
          "Vexo Ring": {
            device_address: "AA-BB-CC-DD-EE-FF",
            device_services: "A8E90001-0000-1000-8000-00805F9B34FB",
          },
        },
      ],
      device_not_connected: [
        {
          "Magic Mouse": {
            device_address: "11-22-33-44-55-66",
          },
        },
      ],
    },
  ],
};

const NEARBY = {
  SPBluetoothDataType: [
    {
      "Vexo Band": {
        device_isconnected: "attrib_No",
        device_address: "01-02-03-04-05-06",
      },
    },
  ],
};

const SERVICE_ONLY = {
  SPBluetoothDataType: [
    {
      Headset: {
        device_isconnected: "attrib_Yes",
        device_address: "0A-0B-0C-0D-0E-0F",
        device_services: "something a8e90020 audio",
      },
    },
  ],
};

NodeTest.afterEach(() => {
  setRunForTests(null);
});

NodeTest.test("names and a8e9 UUIDs match, and other radios do not", () => {
  NodeAssert.equal(matchesVexoBand("Vexo Ring", []), true);
  NodeAssert.equal(matchesVexoBand("Headset", ["A8E90021-0000-1000-8000-00805F9B34FB"]), true);
  NodeAssert.equal(matchesVexoBand("Magic Mouse", ["180F"]), false);
  NodeAssert.equal(matchesVexoBand("", []), false);
});

NodeTest.test("profiler JSON keeps connected Vexo radios and drops unrelated devices", () => {
  const connected = summarizeBand(peripheralsFromProfiler(CONNECTED));
  NodeAssert.equal(connected.state, "connected");
  NodeAssert.equal(connected.matches.length, 1);
  NodeAssert.equal(connected.matches[0]?.name, "Vexo Ring");
  NodeAssert.equal(connected.matches[0]?.connected, true);
  NodeAssert.match(connected.detail, /Pairing is not implemented/);

  const nearby = summarizeBand(peripheralsFromProfiler(NEARBY));
  NodeAssert.equal(nearby.state, "not-found");
  NodeAssert.equal(nearby.matches[0]?.connected, false);
  NodeAssert.match(nearby.detail, /not connected/);

  const byUuid = summarizeBand(peripheralsFromProfiler(SERVICE_ONLY));
  NodeAssert.equal(byUuid.state, "connected");
  NodeAssert.equal(byUuid.matches[0]?.name, "Headset");
});

NodeTest.test("a scan report marks a connected match and ignores other names", () => {
  const parsed = peripheralsFromScan(
    `swift noise\n{"ok":true,"peripherals":[{"name":"Vexo","id":"abc","connected":false,"uuids":["A8E90020-0000-1000-8000-00805F9B34FB"]},{"name":"Keyboard","id":"k","connected":true,"uuids":[]}]}\n`,
  );
  NodeAssert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const status = summarizeBand(parsed.devices);
  NodeAssert.equal(status.state, "not-found");
  NodeAssert.equal(status.matches.length, 1);
  NodeAssert.equal(status.matches[0]?.name, "Vexo");

  const failed = peripheralsFromScan('{"ok":false,"reason":"powered_off"}\n');
  NodeAssert.deepEqual(failed, { ok: false, reason: "powered_off" });
});

NodeTest.test(
  "status reads system_profiler and does not claim a missing band is connected",
  { skip: process.platform !== "darwin" },
  async () => {
    setRunForTests(async (command, args) => {
      NodeAssert.equal(command, "/usr/sbin/system_profiler");
      NodeAssert.deepEqual(args, ["SPBluetoothDataType", "-json"]);
      return { code: 0, stdout: JSON.stringify(CONNECTED), stderr: "" };
    });
    const status = await bandStatus();
    NodeAssert.equal(status.state, "connected");
    NodeAssert.match(status.detail, /Pairing is not implemented/);
  },
);

NodeTest.test(
  "a failed live scan keeps a profiler connection and still refuses pairing",
  { skip: process.platform !== "darwin" },
  async () => {
    setRunForTests(async (command) => {
      if (command.endsWith("system_profiler")) {
        return { code: 0, stdout: JSON.stringify(CONNECTED), stderr: "" };
      }
      return { code: 1, stdout: '{"ok":false,"reason":"unauthorized"}\n', stderr: "" };
    });
    const status = await bandScan();
    NodeAssert.equal(status.state, "connected");
    NodeAssert.match(status.detail, /permission was denied/);
    NodeAssert.match(status.detail, /Pairing is not implemented/);
  },
);

NodeTest.test("the scan script uses public CoreBluetooth and does not connect", () => {
  const script = bleScanScript();
  NodeAssert.equal(NodeFS.existsSync(script), true);
  const text = NodeFS.readFileSync(script, "utf8");
  NodeAssert.match(text, /import CoreBluetooth/);
  NodeAssert.match(text, /scanForPeripherals/);
  NodeAssert.doesNotMatch(text, /\.connect\(/);
});
