import { createApp } from 'vue'
import { getContext } from 'tone'
import './style.css'
import App from './App.vue'

getContext().lookAhead = 0.02
createApp(App).mount('#app')
