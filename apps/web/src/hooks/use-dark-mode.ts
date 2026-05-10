import { useState, useEffect } from 'react'

export function useDarkMode() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const isDarkClass = document.documentElement.classList.contains('dark')
    setIsDark(isDarkClass)
  }, [])

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark')
    setIsDark(!isDark)
  }

  return { isDark, toggleDarkMode }
}