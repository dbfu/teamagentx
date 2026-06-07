import { useState, useRef, useEffect } from 'react'

interface LanguageSelectProps {
  lang: 'zh' | 'en'
  setLang: (lang: 'zh' | 'en') => void
}

const LANG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

export function LanguageSelect({ lang, setLang }: LanguageSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentOption = LANG_OPTIONS.find(o => o.value === lang)!

  return (
    <div className="lang-select-custom" ref={ref}>
      <button
        type="button"
        className="lang-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="lang-select-label">{currentOption.label}</span>
        <svg
          className={`lang-select-arrow ${isOpen ? 'lang-select-arrow-up' : ''}`}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>

      {isOpen && (
        <div className="lang-select-dropdown" role="listbox">
          {LANG_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`lang-select-option ${option.value === lang ? 'lang-select-option-active' : ''}`}
              onClick={() => {
                setLang(option.value as 'zh' | 'en')
                setIsOpen(false)
              }}
              role="option"
              aria-selected={option.value === lang}
            >
              <span className="lang-select-label">{option.label}</span>
              {option.value === lang && (
                <svg
                  className="lang-select-check"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="#4F7BFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 6l3 3 5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}