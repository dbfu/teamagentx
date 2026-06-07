import ReactDOM from 'react-dom/client'
import App from './App'
import { initBaiduTongji } from './analytics'
import { LanguageProvider } from './i18n/context'
import './styles.css'

initBaiduTongji()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
)