import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'ru'
export type TranslationPair = readonly [english: string, russian: string]

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
  t: (value: string) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)
const STORAGE_KEY = 'zenith-control.locale'

function preserveWhitespace(source: string, translated: string): string {
  const leading = source.match(/^\s*/)?.[0] ?? ''
  const trailing = source.match(/\s*$/)?.[0] ?? ''
  return `${leading}${translated}${trailing}`
}

export function createTranslator(pairs: readonly TranslationPair[]) {
  const ordered = [...pairs].sort((a, b) => Math.max(b[0].length, b[1].length) - Math.max(a[0].length, a[1].length))
  const toEnglish = new Map(ordered.map(([english, russian]) => [russian, english]))
  const toRussian = new Map(ordered.map(([english, russian]) => [english, russian]))

  return (source: string, locale: Locale): string => {
    const clean = source.trim()
    if (!clean) return source
    const exact = locale === 'en' ? toEnglish.get(clean) : toRussian.get(clean)
    if (exact) return preserveWhitespace(source, exact)

    const containsCyrillic = /[А-Яа-яЁё]/.test(clean)
    if ((locale === 'en' && !containsCyrillic) || (locale === 'ru' && containsCyrillic)) return source

    let translated = clean
    const replacements = locale === 'en'
      ? ordered.map(([english, russian]) => [russian, english] as const)
      : ordered.map(([english, russian]) => [english, russian] as const)
    for (const [from, to] of replacements) {
      if (from.length >= 4 && translated.includes(from)) translated = translated.split(from).join(to)
    }
    return translated === clean ? source : preserveWhitespace(source, translated)
  }
}

export function LocaleProvider({ children, pairs }: { children: ReactNode; pairs: readonly TranslationPair[] }) {
  const [locale, setLocaleState] = useState<Locale>(() => localStorage.getItem(STORAGE_KEY) === 'ru' ? 'ru' : 'en')
  const translate = useMemo(() => createTranslator(pairs), [pairs])

  const setLocale = (next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next)
    setLocaleState(next)
  }

  useLayoutEffect(() => {
    document.documentElement.lang = locale
    const textSource = new WeakMap<Text, string>()
    const textApplied = new WeakMap<Text, string>()
    const attributeSource = new WeakMap<Element, Map<string, string>>()
    const attributeApplied = new WeakMap<Element, Map<string, string>>()
    const valueSource = new WeakMap<HTMLInputElement | HTMLTextAreaElement, string>()
    const valueApplied = new WeakMap<HTMLInputElement | HTMLTextAreaElement, string>()

    const localizeText = (node: Text) => {
      if (node.parentElement?.closest('[data-no-i18n], script, style')) return
      const current = node.data
      const lastApplied = textApplied.get(node)
      if (!textSource.has(node) || (lastApplied !== undefined && current !== lastApplied)) textSource.set(node, current)
      const next = translate(textSource.get(node) ?? current, locale)
      textApplied.set(node, next)
      if (current !== next) node.data = next
    }

    const localizeAttribute = (element: Element, attribute: string) => {
      if (element.closest('[data-no-i18n]')) return
      const current = element.getAttribute(attribute)
      if (current === null) return
      const sources = attributeSource.get(element) ?? new Map<string, string>()
      const applied = attributeApplied.get(element) ?? new Map<string, string>()
      if (!sources.has(attribute) || (applied.has(attribute) && current !== applied.get(attribute))) sources.set(attribute, current)
      const next = translate(sources.get(attribute) ?? current, locale)
      sources.set(attribute, sources.get(attribute) ?? current)
      applied.set(attribute, next)
      attributeSource.set(element, sources)
      attributeApplied.set(element, applied)
      if (current !== next) element.setAttribute(attribute, next)
    }

    const localizeValue = (element: HTMLInputElement | HTMLTextAreaElement) => {
      const current = element.value
      const lastApplied = valueApplied.get(element)
      if (!valueSource.has(element) || (lastApplied !== undefined && current !== lastApplied)) valueSource.set(element, current)
      const next = translate(valueSource.get(element) ?? current, locale)
      valueApplied.set(element, next)
      if (current !== next) element.value = next
    }

    const localizeTree = (root: Node) => {
      if (root instanceof Text) localizeText(root)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const textNodes: Text[] = []
      let text = walker.nextNode()
      while (text) { textNodes.push(text as Text); text = walker.nextNode() }
      for (const node of textNodes) localizeText(node)
      if (root instanceof Element) {
        for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) localizeAttribute(root, attribute)
        if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) localizeValue(root)
      }
      if (root instanceof Element || root instanceof Document) {
        for (const element of root.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
          for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) localizeAttribute(element, attribute)
        }
        for (const element of root.querySelectorAll('input, textarea')) localizeValue(element as HTMLInputElement | HTMLTextAreaElement)
      }
    }

    localizeTree(document.documentElement)
    document.title = translate(document.title, locale)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') localizeText(mutation.target as Text)
        if (mutation.type === 'attributes') localizeAttribute(mutation.target as Element, mutation.attributeName ?? '')
        for (const node of mutation.addedNodes) localizeTree(node)
      }
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder', 'alt'] })
    return () => observer.disconnect()
  }, [locale, translate])

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    toggleLocale: () => setLocale(locale === 'en' ? 'ru' : 'en'),
    t: (value: string) => translate(value, locale),
  }), [locale, translate])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useLocale must be used inside LocaleProvider')
  return context
}

export function LanguageSwitch() {
  const { locale, setLocale } = useLocale()
  return (
    <div className="language-switch" role="group" aria-label="Language / Язык" data-no-i18n>
      <button className={locale === 'en' ? 'is-active' : ''} type="button" onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>EN</button>
      <button className={locale === 'ru' ? 'is-active' : ''} type="button" onClick={() => setLocale('ru')} aria-pressed={locale === 'ru'}>RU</button>
    </div>
  )
}
