import './ui/style.css';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root !== null) {
  // Pinch zoom is a gesture event on iOS; the viewport tag and `touch-action` cover the rest.
  document.addEventListener('gesturestart', (event) => event.preventDefault());
  void startApp(root, {
    buildId: __BUILD_ID__,
    contentVersion: __CONTENT_VERSION__,
    serviceWorker: import.meta.env.PROD,
    baseUrl: import.meta.env.BASE_URL,
  });
}
