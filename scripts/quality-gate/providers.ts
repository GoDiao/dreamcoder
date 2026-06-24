#!/usr/bin/env bun

import { formatProviderTargets, loadProviderIndex } from './providerTargets'

console.log(formatProviderTargets(loadProviderIndex()))
