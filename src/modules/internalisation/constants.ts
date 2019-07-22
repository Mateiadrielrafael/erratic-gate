import { supportedLanguage } from './types/supportedLanguages'
import { Translation } from './types/TranslationInterface'
import { EnglishTranslation } from './translations/english'
import { RomanianTranslation } from './translations/romanian'
import { DutchTranslation } from './translations/nederlands'

/**
 * Object with all translations
 */
export const translations: Record<supportedLanguage, Translation> = {
    english: EnglishTranslation,
    ['română']: RomanianTranslation,
    dutch: DutchTranslation
}

export const allSupportedLanguages: supportedLanguage[] = [
    'english',
    'română',
    'dutch'
]
