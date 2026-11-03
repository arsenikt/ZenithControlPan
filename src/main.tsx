import '@fontsource-variable/manrope'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LocaleProvider } from './i18n/LocaleContext'
import { translations } from './i18n/translations'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><LocaleProvider pairs={translations}><App /></LocaleProvider></StrictMode>)
