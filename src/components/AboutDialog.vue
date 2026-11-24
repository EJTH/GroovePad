<script setup lang="ts">
import SettingsDialog from './SettingsDialog.vue'
import { isBeta } from '../appChannel'

defineProps<{ version: string }>()
defineEmits<{ close: [] }>()

const logo = `${import.meta.env.BASE_URL}${isBeta ? 'beta-' : ''}favicon.svg`
</script>

<template>
  <SettingsDialog title="About" @close="$emit('close')">
    <div class="about">
      <div class="about-brand">
        <img :src="logo" alt="GroovePad logo" width="64" height="64">
        <div class="brand">GroovePad<span>.io</span> <span class="brand-version">v{{ version }}</span></div>
      </div>
      <p>Copyright © 2026 <a href="https://soundcloud.com/don-et" target="_blank" rel="noopener noreferrer">DON:E</a> (Elias Toft Hansen)</p>
      <p>This software is free software, licensed under the GNU Affero General Public License v3.0
        (<a href="https://github.com/EJTH/GroovePad/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">AGPLv3</a>).
        You are free to redistribute and modify this software under the terms of the AGPLv3.</p>
      <p>This software is provided WITHOUT ANY WARRANTY.</p>
      <nav class="about-links" aria-label="About links">
        <a href="https://github.com/EJTH/GroovePad/blob/main/docs/getting-started.md" target="_blank" rel="noopener noreferrer">User Manual</a>
        <a href="https://github.com/EJTH/GroovePad" target="_blank" rel="noopener noreferrer">GitHub Repository</a>
        <a href="https://ko-fi.com/donelias" target="_blank" rel="noopener noreferrer">Support development on Ko-Fi</a>
      </nav>
      <nav class="social-links" aria-label="Social media">
        <a class="social-github" href="https://github.com/ejth" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
          <svg viewBox="0 0 19 19" aria-hidden="true">
            <path fill="currentColor" fill-rule="evenodd" d="M9.356 1.85C5.05 1.85 1.57 5.356 1.57 9.694a7.84 7.84 0 0 0 5.324 7.44c.387.079.528-.168.528-.376 0-.182-.013-.805-.013-1.454-2.165.467-2.616-.935-2.616-.935-.349-.91-.864-1.143-.864-1.143-.71-.48.051-.48.051-.48.787.051 1.2.805 1.2.805.695 1.194 1.817.857 2.268.649.064-.507.27-.857.49-1.052-1.728-.182-3.545-.857-3.545-3.87 0-.857.31-1.558.8-2.104-.078-.195-.349-1 .077-2.078 0 0 .657-.208 2.14.805a7.5 7.5 0 0 1 1.946-.26c.657 0 1.328.092 1.946.26 1.483-1.013 2.14-.805 2.14-.805.426 1.078.155 1.883.078 2.078.502.546.799 1.247.799 2.104 0 3.013-1.818 3.675-3.558 3.87.284.247.528.714.528 1.454 0 1.052-.012 1.896-.012 2.156 0 .208.142.455.528.377a7.84 7.84 0 0 0 5.324-7.441c.013-4.338-3.48-7.844-7.773-7.844" clip-rule="evenodd" />
          </svg>
        </a>
        <a class="social-soundcloud" href="https://soundcloud.com/don-et" target="_blank" rel="noopener noreferrer" aria-label="SoundCloud">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" aria-hidden="true">
            <path d="M2 12v3m2-5v7m2-9v9m2-7v7m2-9v9m2-10v10h7a3 3 0 0 0 0-6c-.4 0-.8.1-1.1.2A5 5 0 0 0 12 7z" />
          </svg>
        </a>
        <a class="social-youtube" href="https://www.youtube.com/@DONNYE_DK" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8ZM10 15.2V8.8l5.5 3.2z" />
          </svg>
        </a>
        <a class="social-instagram" href="https://www.instagram.com/eliasjth/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
          <svg viewBox="0 0 24 24" fill="none" stroke="url(#instagram-gradient)" stroke-width="1.8" aria-hidden="true">
            <defs>
              <linearGradient id="instagram-gradient" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
                <stop stop-color="#feda75" />
                <stop offset=".35" stop-color="#fa7e1e" />
                <stop offset=".65" stop-color="#d62976" />
                <stop offset="1" stop-color="#4f5bd5" />
              </linearGradient>
            </defs>
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="url(#instagram-gradient)" stroke="none" />
          </svg>
        </a>
      </nav>
    </div>
  </SettingsDialog>
</template>

<style scoped>
.about {
  line-height: 1.5;
}

.about-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.about-brand .brand {
  margin: 0;
}

.about a {
  color: var(--accent);
}

.about-links {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.social-links {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}

.social-links a {
  display: grid;
  flex: 1;
  min-width: 0;
  height: 64px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.social-links a:hover {
  background: #373832;
}

.social-links a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.social-links svg {
  width: 40px;
  height: 40px;
}

.about .social-github { color: #fff; }
.about .social-soundcloud { color: #f50; }
.about .social-youtube { color: #f00; }
</style>
