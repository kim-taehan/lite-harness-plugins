// Kotlin 문법 팩 서비스 (0.2.0) — grammars.json 이 선언한 문법을 앱의 파일 개요에 올린다(공용 본체는 scripts/grammar-service.mjs).
import { grammarService } from '../../../scripts/grammar-service.mjs'
import grammars from '../grammars.json'

export default grammarService(grammars)
