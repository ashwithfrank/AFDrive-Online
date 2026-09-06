"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../lib/proxyRegistry");

function fakeSocket(id) {
  let disconnected = false;
  return {
    id,
    disconnect() {
      disconnected = true;
    },
    get wasDisconnected() {
      return disconnected;
    },
  };
}

test("registerAgent tracks a connected agent by server id", () => {
  const socket = fakeSocket("sock-1");
  registry.registerAgent("server-a", "device-a", socket);

  assert.equal(registry.isAgentOnline("server-a"), true);
  assert.equal(registry.getAgentSocket("server-a"), socket);

  registry.unregisterAgent("server-a", "sock-1");
  assert.equal(registry.isAgentOnline("server-a"), false);
});

test("a second connection for the same device replaces the first", () => {
  const first = fakeSocket("sock-1");
  const second = fakeSocket("sock-2");

  registry.registerAgent("server-b", "device-b", first);
  registry.registerAgent("server-b", "device-b", second);

  assert.equal(first.wasDisconnected, true, "the stale socket should be forced closed");
  assert.equal(registry.getAgentSocket("server-b"), second);

  registry.unregisterAgent("server-b", "sock-2");
});

test("unregisterAgent is a no-op if the socket id doesn't match the current one", () => {
  const current = fakeSocket("sock-current");
  registry.registerAgent("server-c", "device-c", current);

  // Simulate a late disconnect event from an already-replaced socket.
  registry.unregisterAgent("server-c", "sock-stale");
  assert.equal(registry.isAgentOnline("server-c"), true);

  registry.unregisterAgent("server-c", "sock-current");
  assert.equal(registry.isAgentOnline("server-c"), false);
});

test("beginRequest/getRequest/endRequest correlate a request by id", () => {
  const fakeRes = {};
  const entry = registry.beginRequest("req-1", fakeRes, "server-d");

  assert.equal(registry.getRequest("req-1"), entry);
  assert.equal(entry.res, fakeRes);
  assert.equal(entry.serverId, "server-d");

  registry.endRequest("req-1");
  assert.equal(registry.getRequest("req-1"), null);
});
