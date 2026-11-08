import { packGrammar } from '../../scripts/grammar-pack.mjs'

await packGrammar(import.meta.dirname, 'code-grammar-kotlin', { dir: process.argv.includes('--dir') })
