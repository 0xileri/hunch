// Shared assets for Hunch's separate live section pages.
import { readFileSync } from 'node:fs'

export const APP_JS = readFileSync(new URL('./app.js', import.meta.url), 'utf8')
export const APP_CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8')
