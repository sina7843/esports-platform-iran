import { createApp } from 'vue';
import 'vazirmatn/Vazirmatn-font-face.css'; // local font files only, no CDN
import './styles/tokens.css';
import './styles/base.css';
import App from './App.vue';
import { createAppRouter } from './router';
import { applySettings } from './settings';

applySettings();
createApp(App).use(createAppRouter()).mount('#app');
