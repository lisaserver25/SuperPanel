import React from 'react'
import ReactDOM from 'react-dom/client'
import { installSecurityShield } from './lib/security'
import App from './App'
import './index.css'

// Instalar escudo de seguridad antes de cualquier inicialización
installSecurityShield()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
