/// <reference types="vite/client" />

// CSS 模块类型声明
declare module '*.css' {
  const content: string
  export default content
}

// React Native WebView 通信接口
interface ReactNativeWebView {
  postMessage: (message: string) => void
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebView
  }
}

export {}