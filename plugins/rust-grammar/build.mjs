import { packGrammar } from '../../scripts/grammar-pack.mjs'

await packGrammar(import.meta.dirname, 'code-grammar-rust', { dir: process.argv.includes('--dir') })
