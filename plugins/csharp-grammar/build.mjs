import { packGrammar } from '../../scripts/grammar-pack.mjs'

await packGrammar(import.meta.dirname, 'code-grammar-c-sharp', { dir: process.argv.includes('--dir') })
