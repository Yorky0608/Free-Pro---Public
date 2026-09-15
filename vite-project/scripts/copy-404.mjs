import { copyFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'

const indexFile = new URL('../dist/index.html', import.meta.url)
const notFoundFile = new URL('../dist/404.html', import.meta.url)

await access(indexFile, constants.F_OK)
await copyFile(indexFile, notFoundFile)
