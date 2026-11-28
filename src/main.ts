// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createApp } from 'vue'
import { Context, setContext } from 'tone'
import './audio/toneLeakFix'
import './style.css'
import App from './App.vue'

// Tone disposes finished one-shot sources via requestIdleCallback without a timeout; on a busy main
// thread those callbacks never run and the sources pile up.
if (typeof window.requestIdleCallback === 'function') {
  const requestIdle = window.requestIdleCallback.bind(window)
  window.requestIdleCallback = (callback, options) => requestIdle(callback, { timeout: 100, ...options })
}

setContext(new Context({ latencyHint: 'balanced', lookAhead: 0.02 }))
createApp(App).mount('#app')
