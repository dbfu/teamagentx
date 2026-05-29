import ReactDOM from 'react-dom/client'
import App from './App'
import { initBaiduTongji } from './analytics'
import './styles.css'

initBaiduTongji()

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
