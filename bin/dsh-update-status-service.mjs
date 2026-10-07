#!/usr/bin/env node
/** Explicit service-management entry point; never runs when DSH loads the plugin. */
import { main } from '../lib/service-cli.js'

void main(process.argv.slice(2)).then(code => { process.exitCode = code })
