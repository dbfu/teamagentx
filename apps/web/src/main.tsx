import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './components/theme-provider'
import './i18n'  // i18n 配置
import './index.css'

// Electron 环境使用 HashRouter（兼容 file:// 协议），Web 环境使用 BrowserRouter
const isElectron = window.electronAPI?.isElectron ?? false
const Router = isElectron ? HashRouter : BrowserRouter

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Router>
    <ThemeProvider defaultTheme="system" storageKey="teamagentx-theme">
      <App />
    </ThemeProvider>
  </Router>
)