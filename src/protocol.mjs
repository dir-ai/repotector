// protocol.mjs — single source of truth for protocol + package identity.
// Everything (server info, passport, register lines, doorway blocks) reads
// these constants so the ids never drift (this replaces the 1.0.0-vs-1.1.0
// server/package mismatch and the missing protocol id).
import { readFileSync } from 'node:fs'

// The application-level protocol version, independent of the npm semver. All
// v2 mechanics (handshake payload, passport, register schema) speak this.
export const PROTOCOL_ID = 'REPOTECTOR/2'

// Package version, read once from package.json so serverInfo can never lie
// about what npm actually publishes.
let version = '0.0.0'
try {
  version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
} catch { /* keep fallback */ }
export const PKG_VERSION = version

export const SERVER_NAME = 'psx-repotector'

// Delivered in the MCP `initialize` response, BEFORE any tool is called — the
// cheapest possible handshake-first signal a conformant client can receive.
export const INIT_INSTRUCTIONS =
  `This repository is guarded by PSX Repotector (${PROTOCOL_ID}). ` +
  'Call the `handshake` tool FIRST, declaring who you are — you are logged into the visitor ' +
  'register and handed the ground rules, the live gate verdict, and the city-map. ' +
  'No deep tool answers before handshake. When you finish, call `depart` with a one-line summary.'
